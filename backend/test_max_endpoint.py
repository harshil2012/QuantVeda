import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_max_candles_endpoint():
    response = client.get("/api/candles/RELIANCE.NS/max")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert "candles" in data["data"]
    assert len(data["data"]["candles"]) > 100