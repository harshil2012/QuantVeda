import pytest
import time
from unittest.mock import patch, Mock
from broker import fetch_max_candles_data, get_max_candles, fetch_candles_data, _fetch_yahoo_chart_data


def test_fetch_max_candles_returns_data():
    result = fetch_max_candles_data("RELIANCE.NS")
    assert "candles" in result
    assert len(result["candles"]) > 100
    assert result["count"] == len(result["candles"])


@pytest.mark.asyncio
async def test_get_max_candles_async_wrapper():
    result = await get_max_candles("RELIANCE.NS")
    assert "candles" in result
    assert len(result["candles"]) > 100
    assert result["count"] == len(result["candles"])


def test_fetch_max_candles_deduplication():
    """Test that duplicate timestamps are deduplicated when stitching yearly chunks."""
    fixed_now = 1700000000
    
    # Chunk 1: year_offset=0 (most recent year)
    chunk1 = {
        "chart": {"result": [{
            "meta": {"currency": "INR", "exchangeName": "NSE", "symbol": "RELIANCE.NS"},
            "timestamp": [fixed_now - 100, fixed_now - 200, fixed_now - 300],
            "indicators": {"quote": [{
                "open": [100.0, 101.0, 102.0],
                "high": [101.0, 102.0, 103.0],
                "low": [99.0, 100.0, 101.0],
                "close": [100.5, 101.5, 102.5],
                "volume": [1000, 1000, 1000]
            }]}
        }]}
    }
    
    # Chunk 2: year_offset=1 (previous year) - overlaps with chunk1
    chunk2 = {
        "chart": {"result": [{
            "meta": {"currency": "INR", "exchangeName": "NSE", "symbol": "RELIANCE.NS"},
            "timestamp": [fixed_now - 200, fixed_now - 300, fixed_now - 400],  # Overlapping timestamps
            "indicators": {"quote": [{
                "open": [101.0, 102.0, 103.0],
                "high": [102.0, 103.0, 104.0],
                "low": [100.0, 101.0, 102.0],
                "close": [101.5, 102.5, 103.5],
                "volume": [1000, 1000, 1000]
            }]}
        }]}
    }
    
    # Empty chunk to stop early (year_offset=2)
    empty_chunk = {"chart": {"result": []}}
    
    with patch('requests.get') as mock_get, patch('time.time', return_value=fixed_now):
        mock_get.side_effect = [
            Mock(status_code=200, json=lambda: chunk1),
            Mock(status_code=200, json=lambda: chunk2),
            Mock(status_code=200, json=lambda: empty_chunk),
        ]
        # Use max_years_back=3 and _test_mode=True to skip fallback
        result = fetch_max_candles_data("RELIANCE.NS", max_years_back=3, _test_mode=True)
    
    timestamps = [c["time"] for c in result["candles"]]
    assert len(timestamps) == len(set(timestamps)), "Duplicate timestamps should be deduplicated"
    assert timestamps == sorted(timestamps), "Candles should be sorted by time"


def test_fetch_max_candles_meta_from_first_chunk():
    """Test that metadata is captured from first successful chunk, not last."""
    fixed_now = 1700000000
    
    # First chunk (year_offset=0 for RELIANCE.NS) - succeeds with INR
    chunk1 = Mock(status_code=200, json=lambda: {
        "chart": {"result": [{
            "meta": {"currency": "INR", "exchangeName": "NSE", "symbol": "RELIANCE.NS"},
            "timestamp": [fixed_now - 100],
            "indicators": {"quote": [{
                "open": [100.0], "high": [101.0], "low": [99.0], "close": [100.5], "volume": [1000]
            }]}
        }]}}
    )
    
    # Second chunk (year_offset=1 for RELIANCE.NS) - succeeds with USD (should be ignored for meta)
    chunk2 = Mock(status_code=200, json=lambda: {
        "chart": {"result": [{
            "meta": {"currency": "USD", "exchangeName": "NASDAQ", "symbol": "RELIANCE"},
            "timestamp": [fixed_now - 200],
            "indicators": {"quote": [{
                "open": [200.0], "high": [201.0], "low": [199.0], "close": [200.5], "volume": [1000]
            }]}
        }]}}
    )
    
    # Empty chunk to stop (year_offset=2)
    empty_chunk = Mock(status_code=200, json=lambda: {"chart": {"result": []}})
    
    with patch('requests.get') as mock_get, patch('time.time', return_value=fixed_now):
        mock_get.side_effect = [chunk1, chunk2, empty_chunk]
        # Use max_years_back=3 and _test_mode=True to skip fallback
        result = fetch_max_candles_data("RELIANCE.NS", max_years_back=3, _test_mode=True)
    
    assert result["currency"] == "INR", "Currency should be from first successful chunk"
    assert result["exchange"] == "NSE", "Exchange should be from first successful chunk"


def test_fetch_max_candles_symbol_fallback():
    """Test that .NS and .BO suffixes are tried when base symbol fails."""
    fixed_now = 1700000000
    
    mock_fail = Mock(status_code=404)
    
    # RELIANCE.NS succeeds on first year chunk with >50 candles
    timestamps = list(range(fixed_now - 100, fixed_now - 100 + 60))
    mock_success = Mock(status_code=200, json=lambda: {
        "chart": {"result": [{
            "meta": {"currency": "INR", "exchangeName": "NSE", "symbol": "RELIANCE.NS"},
            "timestamp": timestamps,
            "indicators": {"quote": [{
                "open": [100.0] * 60,
                "high": [101.0] * 60,
                "low": [99.0] * 60,
                "close": [100.5] * 60,
                "volume": [1000] * 60
            }]}
        }]}}
    )
    
    # Empty chunk to stop
    empty_chunk = Mock(status_code=200, json=lambda: {"chart": {"result": []}})
    
    # Function tries: RELIANCE (year_offset=0,1,2 fail = 3 calls), 
    # then RELIANCE.NS (year_offset=0 succeeds with >50 candles = 1 call, then breaks)
    # Provide 6 responses to avoid mock exhaustion warnings
    side_effect = [mock_fail, mock_fail, mock_fail, mock_success, empty_chunk, empty_chunk]
    
    with patch('requests.get') as mock_get, patch('time.time', return_value=fixed_now):
        mock_get.side_effect = side_effect
        # Use max_years_back=3 and _test_mode=True to skip fallback
        result = fetch_max_candles_data("RELIANCE", max_years_back=3, _test_mode=True)
    
    assert result["symbol"] == "RELIANCE.NS"
    assert result["currency"] == "INR"
    assert result["exchange"] == "NSE"
    assert len(result["candles"]) > 50
    # At least 4 calls made (3 fails + 1 success), exact count depends on break logic
    assert mock_get.call_count >= 4


def test_fetch_max_candles_error_handling():
    """Test that ValueError is raised when all symbol attempts fail."""
    mock_fail = Mock(status_code=404)
    
    with patch('requests.get') as mock_get, patch('time.time', return_value=1700000000):
        mock_get.return_value = mock_fail
        with pytest.raises(ValueError, match="Could not retrieve any candle history"):
            fetch_max_candles_data("INVALID_SYMBOL", max_years_back=2, _test_mode=True)


def test_fetch_candles_data_symbol_fallback():
    """Test that fetch_candles_data tries .NS and .BO suffixes."""
    mock_fail = Mock(status_code=404)
    mock_success = Mock(status_code=200, json=lambda: {
        "chart": {"result": [{
            "meta": {"currency": "INR", "exchangeName": "NSE", "symbol": "TCS.NS"},
            "timestamp": [1000],
            "indicators": {"quote": [{
                "open": [3000.0], "high": [3010.0], "low": [2990.0], "close": [3005.0], "volume": [5000]
            }]}
        }]}})
    
    with patch('requests.get') as mock_get:
        mock_get.side_effect = [mock_fail, mock_fail, mock_success]
        result = fetch_candles_data("TCS")
    
    assert result["symbol"] == "TCS"
    assert mock_get.call_count >= 3


def test_fetch_candles_data_error_handling():
    """Test that ValueError is raised when all attempts fail."""
    mock_fail = Mock(status_code=404)
    
    with patch('requests.get') as mock_get:
        mock_get.return_value = mock_fail
        with pytest.raises(ValueError, match="Could not retrieve candle history"):
            fetch_candles_data("INVALID")


def test_fetch_yahoo_chart_data_error_handling():
    """Test that _fetch_yahoo_chart_data raises ValueError on failure."""
    mock_fail = Mock(status_code=404)
    
    with patch('requests.get') as mock_get:
        mock_get.return_value = mock_fail
        with pytest.raises(ValueError, match="Could not retrieve live price data"):
            _fetch_yahoo_chart_data("INVALID")