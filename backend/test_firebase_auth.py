import sys
import os
import time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pytest
from fastapi.testclient import TestClient
from jose import jwt

from main import app
from db import init_db, get_db, SessionLocal
from models import User, PaperWallet

init_db()
client = TestClient(app)


def test_firebase_config_endpoint():
    res = client.get("/api/auth/firebase-config")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert "config" in data
    assert "apiKey" in data["config"]
    assert "projectId" in data["config"]


def test_firebase_login_with_email_token():
    unique_id = f"test_fb_{int(time.time() * 1000)}"
    payload = {
        "iss": "https://securetoken.google.com/quantveda-ai",
        "aud": "quantveda-ai",
        "auth_time": int(time.time()),
        "user_id": unique_id,
        "sub": unique_id,
        "email": f"{unique_id}@quantveda.com",
        "email_verified": True,
        "name": "Firebase Trader"
    }

    test_token = jwt.encode(payload, "quantveda-secure-jwt-secret-key-2026-prod", algorithm="HS256")

    login_res = client.post("/api/auth/firebase-login", json={
        "id_token": test_token
    })
    assert login_res.status_code == 200
    data = login_res.json()
    assert data["status"] == "success"
    assert data["is_new_user"] is True
    assert "token" in data
    assert data["user"]["email"] == f"{unique_id}@quantveda.com"
    assert data["user"]["name"] == "Firebase Trader"
    assert data["user"]["cash_balance"] == 100000.0

    login_res_2 = client.post("/api/auth/firebase-login", json={
        "id_token": test_token
    })
    assert login_res_2.status_code == 200
    data2 = login_res_2.json()
    assert data2["is_new_user"] is False
    assert data2["user"]["id"] == data["user"]["id"]


def test_firebase_login_with_phone_token():
    unique_phone = f"+9198765{int(time.time()) % 100000:05d}"
    unique_id = f"fb_phone_{int(time.time() * 1000)}"
    payload = {
        "iss": "https://securetoken.google.com/quantveda-ai",
        "aud": "quantveda-ai",
        "auth_time": int(time.time()),
        "user_id": unique_id,
        "sub": unique_id,
        "phone_number": unique_phone,
        "name": "Mobile Trader"
    }

    test_token = jwt.encode(payload, "quantveda-secure-jwt-secret-key-2026-prod", algorithm="HS256")

    login_res = client.post("/api/auth/firebase-login", json={
        "id_token": test_token
    })
    assert login_res.status_code == 200
    data = login_res.json()
    assert data["status"] == "success"
    assert data["user"]["phone"] == unique_phone
    assert data["user"]["cash_balance"] == 100000.0


def test_firebase_login_empty_token():
    res = client.post("/api/auth/firebase-login", json={"id_token": ""})
    assert res.status_code == 400
