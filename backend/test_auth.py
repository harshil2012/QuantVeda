import sys
import os
os.environ["TESTING"] = "1"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pytest
from fastapi.testclient import TestClient

from main import app
from db import get_db, init_db
from models import Base, User, OTPRequest, PaperWallet
from auth import (
    normalize_email,
    normalize_phone,
    generate_otp,
    hash_otp,
    create_access_token,
    decode_access_token,
)

init_db()
client = TestClient(app)


def test_email_validation():
    assert normalize_email("trader@example.com") == "trader@example.com"
    assert normalize_email("  USER.Test+1@domain.co.in ") == "user.test+1@domain.co.in"

    with pytest.raises(Exception):
        normalize_email("notanemail")

    with pytest.raises(Exception):
        normalize_email("")


def test_phone_normalization():
    # 10-digit Indian numbers auto-prefix +91
    assert normalize_phone("9876543210") == "+919876543210"
    # Leading zero in 11 digits
    assert normalize_phone("09876543210") == "+919876543210"
    # Standard international format
    assert normalize_phone("+14155552671") == "+14155552671"
    assert normalize_phone("+91 98765-43210") == "+919876543210"

    with pytest.raises(Exception):
        normalize_phone("123")


def test_otp_generation_and_hashing():
    otp = generate_otp()
    assert len(otp) == 6
    assert otp.isdigit()

    h1 = hash_otp("trader@example.com", otp)
    h2 = hash_otp("trader@example.com", otp)
    assert h1 == h2
    assert len(h1) == 64  # SHA-256


import time

def test_send_and_verify_email_otp():
    test_email = f"test_{int(time.time() * 1000)}@quantveda.com"

    # 1. Send OTP
    send_res = client.post("/api/auth/send-otp", json={
        "identifier": test_email,
        "channel": "email"
    })
    assert send_res.status_code == 200
    data = send_res.json()
    assert data["status"] == "success"
    assert data["channel"] == "email"
    assert "identifier" in data
    dev_otp = data.get("dev_otp")

    # 2. Rate limiting test: immediate second request should return 429
    rate_res = client.post("/api/auth/send-otp", json={
        "identifier": test_email,
        "channel": "email"
    })
    assert rate_res.status_code == 429

    # 3. Verify OTP with incorrect code
    wrong_res = client.post("/api/auth/verify-otp", json={
        "identifier": test_email,
        "otp": "000000"
    })
    assert wrong_res.status_code == 400

    # 4. Verify OTP with valid code (if dev_otp available)
    if dev_otp:
        verify_res = client.post("/api/auth/verify-otp", json={
            "identifier": test_email,
            "otp": dev_otp
        })
        assert verify_res.status_code == 200
        auth_data = verify_res.json()
        assert auth_data["status"] == "success"
        assert "token" in auth_data
        token = auth_data["token"]
        user = auth_data["user"]
        assert user["email"] == test_email
        assert user["cash_balance"] == 100000.0

        # 5. Call protected /api/auth/me
        headers = {"Authorization": f"Bearer {token}"}
        me_res = client.get("/api/auth/me", headers=headers)
        assert me_res.status_code == 200
        me_data = me_res.json()
        assert me_data["user"]["email"] == test_email
        assert me_data["wallet"]["cash_balance"] == 100000.0

        # 6. Call wallet endpoint with auth token
        wallet_res = client.get("/api/wallet", headers=headers)
        assert wallet_res.status_code == 200
        assert wallet_res.json()["data"]["cash_balance"] == 100000.0


def test_send_and_verify_phone_otp():
    test_phone = f"98{int(time.time() * 1000) % 100000000:08d}"

    # 1. Send OTP
    send_res = client.post("/api/auth/send-otp", json={
        "identifier": test_phone,
        "channel": "phone"
    })
    assert send_res.status_code == 200
    data = send_res.json()
    assert data["status"] == "success"
    assert data["channel"] == "phone"
    dev_otp = data.get("dev_otp")

    # 2. Verify with valid OTP code
    if dev_otp:
        verify_res = client.post("/api/auth/verify-otp", json={
            "identifier": f"+91{test_phone}",
            "otp": dev_otp
        })
        assert verify_res.status_code == 200
        auth_data = verify_res.json()
        assert auth_data["status"] == "success"
        token = auth_data["token"]
        assert auth_data["user"]["phone"] == f"+91{test_phone}"

        # Check me
        me_res = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert me_res.status_code == 200
        assert me_res.json()["user"]["phone"] == f"+91{test_phone}"
