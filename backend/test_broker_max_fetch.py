import pytest
from broker import fetch_max_candles_data, get_max_candles

def test_fetch_max_candles_returns_data():
    result = fetch_max_candles_data("RELIANCE.NS")
    assert "candles" in result
    assert len(result["candles"]) > 100  # Should have substantial history
    assert result["count"] == len(result["candles"])

@pytest.mark.asyncio
async def test_get_max_candles_async_wrapper():
    result = await get_max_candles("RELIANCE.NS")
    assert "candles" in result
    assert len(result["candles"]) > 100
    assert result["count"] == len(result["candles"])