import pytest
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
    """Test that duplicate timestamps are deduplicated when stitching chunks."""
    mock_responses = [
        {
            "chart": {"result": [{
                "meta": {"currency": "INR", "exchangeName": "NSE", "symbol": "RELIANCE.NS"},
                "timestamp": [1000, 1001, 1002],
                "indicators": {"quote": [{
                    "open": [100.0, 101.0, 102.0],
                    "high": [101.0, 102.0, 103.0],
                    "low": [99.0, 100.0, 101.0],
                    "close": [100.5, 101.5, 102.5],
                    "volume": [1000, 1000, 1000]
                }]}
            }]}
        },
        {
            "chart": {"result": [{
                "meta": {"currency": "INR", "exchangeName": "NSE", "symbol": "RELIANCE.NS"},
                "timestamp": [1001, 1002, 1003],
                "indicators": {"quote": [{
                    "open": [101.0, 102.0, 103.0],
                    "high": [102.0, 103.0, 104.0],
                    "low": [100.0, 101.0, 102.0],
                    "close": [101.5, 102.5, 103.5],
                    "volume": [1000, 1000, 1000]
                }]}
            }]}
        }
    ]
    
    with patch('requests.get') as mock_get:
        mock_get.side_effect = [Mock(status_code=200, json=lambda: r) for r in mock_responses]
        result = fetch_max_candles_data("RELIANCE")
    
    timestamps = [c["time"] for c in result["candles"]]
    assert len(timestamps) == len(set(timestamps)), "Duplicate timestamps should be deduplicated"
    assert timestamps == sorted(timestamps), "Candles should be sorted by time"


def test_fetch_max_candles_meta_from_first_chunk():
    """Test that metadata is captured from first successful chunk, not last."""
    # Create mock responses for all expected calls
    # The function tries: RELIANCE (max,5y,2y,1y), RELIANCE.NS (max,5y,2y,1y), RELIANCE.BO (max,5y,2y,1y)
    # We want the first call (RELIANCE with max) to succeed with INR meta, then others with USD
    mock_responses = []
    
    # First call: RELIANCE with max - succeeds with INR
    mock_responses.append(Mock(status_code=200, json=lambda: {
        "chart": {"result": [{
            "meta": {"currency": "INR", "exchangeName": "NSE", "symbol": "RELIANCE.NS"},
            "timestamp": [1000],
            "indicators": {"quote": [{
                "open": [100.0], "high": [101.0], "low": [99.0], "close": [100.5], "volume": [1000]
            }]}
        }]}}
    ))
    
    # Remaining calls: all succeed with USD (but should be ignored for meta)
    for _ in range(11):
        mock_responses.append(Mock(status_code=200, json=lambda: {
            "chart": {"result": [{
                "meta": {"currency": "USD", "exchangeName": "NASDAQ", "symbol": "RELIANCE"},
                "timestamp": [1001],
                "indicators": {"quote": [{
                    "open": [200.0], "high": [201.0], "low": [199.0], "close": [200.5], "volume": [1000]
                }]}
            }]}}
        ))
    
    with patch('requests.get') as mock_get:
        mock_get.side_effect = mock_responses
        result = fetch_max_candles_data("RELIANCE")
    
    assert result["currency"] == "INR", "Currency should be from first successful chunk"
    assert result["exchange"] == "NSE", "Exchange should be from first successful chunk"


def test_fetch_max_candles_symbol_fallback():
    """Test that .NS and .BO suffixes are tried when base symbol fails."""
    mock_fail = Mock(status_code=404)
    # Return enough candles to trigger early exit (>50)
    timestamps = list(range(1000, 1060))
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
        }]}})
    
    # Function tries: RELIANCE (4 ranges, all fail), RELIANCE.NS (max succeeds with >50 candles)
    # So we need 4 fails + 1 success = 5 calls before breaking
    side_effect = [mock_fail] * 4 + [mock_success]
    
    with patch('requests.get') as mock_get:
        mock_get.side_effect = side_effect
        result = fetch_max_candles_data("RELIANCE")
    
    assert result["symbol"] == "RELIANCE.NS"
    # Should have tried RELIANCE with 4 ranges, then RELIANCE.NS with max (succeeds)
    assert mock_get.call_count == 5


def test_fetch_max_candles_error_handling():
    """Test that ValueError is raised when all symbol attempts fail."""
    mock_fail = Mock(status_code=404)
    
    with patch('requests.get') as mock_get:
        mock_get.return_value = mock_fail
        with pytest.raises(ValueError, match="Could not retrieve any candle history"):
            fetch_max_candles_data("INVALID_SYMBOL")


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