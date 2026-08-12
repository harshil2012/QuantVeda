### Task 1: Add chunked max fetch function in broker.py

**Files:**
- Modify: `S:\gittttttttttttttttttttt\QuantVeda\backend\broker.py` (add new function after line 468)

**Interfaces:**
- Consumes: `fetch_candles_data()` logic, `HEADERS`, `get_currency_symbol()`, `check_is_market_open()`
- Produces: `fetch_max_candles_data(symbol: str) -> dict` returning same structure as `fetch_candles_data` but with full history

- [ ] **Step 1: Write the failing test**

```python
# Create test file: S:\gittttttttttttttttttttt\QuantVeda\backend\test_broker_max_fetch.py
import pytest
from broker import fetch_max_candles_data

@pytest.mark.asyncio
async def test_fetch_max_candles_returns_data():
    result = await fetch_max_candles_data("RELIANCE.NS")
    assert result["status"] == "success"
    assert "candles" in result["data"]
    assert len(result["data"]["candles"]) > 100  # Should have substantial history
    assert result["data"]["count"] == len(result["data"]["candles"])
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd S:\gittttttttttttttttttttt\QuantVeda\backend
python -m pytest test_broker_max_fetch.py::test_fetch_max_candles_returns_data -v
# Expected: FAIL - function not defined
```

- [ ] **Step 3: Write minimal implementation**

```python
# Add to broker.py after fetch_candles_data function (around line 468)

def fetch_max_candles_data(symbol: str) -> dict:
    """
    Fetches maximum available daily candlestick history by stitching multiple
    1-year range requests from Yahoo Finance v8 API.
    """
    import math
    sym_clean = symbol.strip().upper()
    
    # Try symbols with .NS/.BO suffixes
    symbols_to_test = [sym_clean]
    if not sym_clean.endswith('.NS') and not sym_clean.endswith('.BO') and not sym_clean.startswith('^'):
        symbols_to_test.append(f"{sym_clean}.NS")
        symbols_to_test.append(f"{sym_clean}.BO")
    
    all_candles = []
    seen_timestamps = set()
    
    # Fetch in 1-year chunks going backward
    # Yahoo supports range=1y with interval=1d reliably
    ranges_to_try = ["1y", "2y", "5y", "max"]
    
    for s_test in symbols_to_test:
        for rng in ranges_to_try:
            url = f"https://query1.finance.yahoo.com/v8/finance/chart/{requests.utils.quote(s_test)}?range={rng}&interval=1d"
            try:
                r = requests.get(url, headers=HEADERS, timeout=10)
                if r.status_code == 200:
                    data = r.json()
                    chart_res = data.get('chart', {}).get('result', [])
                    if chart_res:
                        res = chart_res[0]
                        meta = res.get('meta', {})
                        timestamps = res.get('timestamp', [])
                        indicators = res.get('indicators', {}).get('quote', [{}])[0]
                        
                        opens = indicators.get('open', [])
                        highs = indicators.get('high', [])
                        lows = indicators.get('low', [])
                        closes = indicators.get('close', [])
                        volumes = indicators.get('volume', [])
                        
                        chunk_candles = []
                        for i in range(len(timestamps)):
                            t = timestamps[i]
                            o = opens[i] if i < len(opens) else None
                            h = highs[i] if i < len(highs) else None
                            l = lows[i] if i < len(lows) else None
                            c = closes[i] if i < len(closes) else None
                            v = volumes[i] if i < len(volumes) else 0
                            
                            if t is not None and o is not None and h is not None and l is not None and c is not None:
                                if not (math.isnan(o) or math.isnan(h) or math.isnan(l) or math.isnan(c)):
                                    # Deduplicate by timestamp
                                    if t not in seen_timestamps:
                                        seen_timestamps.add(t)
                                        chunk_candles.append({
                                            "time": t,
                                            "open": round(float(o), 2),
                                            "high": round(float(h), 2),
                                            "low": round(float(l), 2),
                                            "close": round(float(c), 2),
                                            "volume": int(v or 0)
                                        })
                        
                        if chunk_candles:
                            all_candles.extend(chunk_candles)
                            # If we got substantial data, this symbol works
                            if len(all_candles) > 50:
                                break
            except Exception as e:
                logger.warning(f"Max fetch chunk failed for {s_test} range={rng}: {e}")
        
        if len(all_candles) > 50:
            break
    
    if not all_candles:
        raise ValueError(f"Could not retrieve any candle history for '{sym_clean}'")
    
    # Sort by time ascending
    all_candles.sort(key=lambda x: x["time"])
    
    # Get metadata from last successful response
    currency_code = meta.get('currency', 'USD')
    exchange_name = meta.get('exchangeName', 'NSE')
    currency_sym = get_currency_symbol(currency_code, exchange_name)
    symbol_canonical = meta.get('symbol', sym_clean)
    
    is_open, status_str = check_is_market_open(exchange_name, meta.get('marketState'))
    
    return {
        "symbol": symbol_canonical,
        "interval": "1d",
        "range": "max",
        "currency": currency_code,
        "currency_symbol": currency_sym,
        "exchange": exchange_name,
        "count": len(all_candles),
        "candles": all_candles
    }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd S:\gittttttttttttttttttttt\QuantVeda\backend
python -m pytest test_broker_max_fetch.py::test_fetch_max_candles_returns_data -v
# Expected: PASS
```

- [ ] **Step 5: Add async wrapper and commit**

```python
# Add after fetch_max_candles_data function
async def get_max_candles(symbol: str) -> dict:
    """Asynchronously fetches max candlestick data off main thread."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, fetch_max_candles_data, symbol)
```

```bash
git add backend/broker.py backend/test_broker_max_fetch.py
git commit -m "feat(broker): add chunked max history fetch for .NS symbols"
```

**Global Constraints:**
- Yahoo v8 API: 1m max 7d, 5m/15m/60m max 60d, 1d supports 1y/5y/max (but .NS often returns only 2-5y on "max")
- Must deduplicate candles by timestamp when stitching chunks
- Preserve existing `/api/candles/{symbol}` endpoint behavior
- Frontend "ALL" range button already exists in HTML (line 489-491 in index.html)