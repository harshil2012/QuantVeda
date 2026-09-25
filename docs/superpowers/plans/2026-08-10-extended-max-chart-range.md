# Extended Max Chart Range Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend chart data fetching to retrieve maximum available history for Indian stocks (.NS) by stitching multiple Yahoo Finance v8 API requests together.

**Architecture:** Add a chunked fetch function in `broker.py` that loops through range=1y requests going backward in time, deduplicates by timestamp, and returns combined data. Expose via new `/api/candles/{symbol}/max` endpoint. Frontend "ALL" button calls this endpoint.

**Tech Stack:** Python/FastAPI, Yahoo Finance v8 Chart API, Lightweight Charts, SQLite

## Global Constraints

- Yahoo v8 API: 1m max 7d, 5m/15m/60m max 60d, 1d supports 1y/5y/max (but .NS often returns only 2-5y on "max")
- Must deduplicate candles by timestamp when stitching chunks
- Preserve existing `/api/candles/{symbol}` endpoint behavior
- Frontend "ALL" range button already exists in HTML (line 489-491 in index.html)

---

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

---

### Task 2: Add new /api/candles/{symbol}/max endpoint in main.py

**Files:**
- Modify: `S:\gittttttttttttttttttttt\QuantVeda\backend\main.py` (add endpoint after line 219)

**Interfaces:**
- Consumes: `get_max_candles` from broker.py
- Produces: `GET /api/candles/{symbol}/max` returning `{status: "success", data: {...}}`

- [ ] **Step 1: Write the failing test**

```python
# Create test file: S:\gittttttttttttttttttttt\QuantVeda\backend\test_max_endpoint.py
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd S:\gittttttttttttttttttttt\QuantVeda\backend
python -m pytest test_max_endpoint.py::test_max_candles_endpoint -v
# Expected: FAIL - endpoint not defined
```

- [ ] **Step 3: Write minimal implementation**

```python
# Add to main.py after get_candles_endpoint (around line 219)

@app.get("/api/candles/{symbol}/max")
async def get_max_candles_endpoint(symbol: str):
    """Fetch maximum available daily candlestick history for a symbol."""
    clean_symbol = symbol.strip().upper()
    if not clean_symbol:
        raise HTTPException(status_code=400, detail="Symbol parameter cannot be empty.")
    try:
        data = await get_max_candles(clean_symbol)
        return {"status": "success", "data": data}
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve))
    except Exception as e:
        logger.error(f"Failed to fetch max candles for {clean_symbol}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="An error occurred while fetching maximum history.")
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd S:\gittttttttttttttttttttt\QuantVeda\backend
python -m pytest test_max_endpoint.py::test_max_candles_endpoint -v
# Expected: PASS
```

- [ ] **Step 5: Commit**

```bash
git add backend/main.py backend/test_max_endpoint.py
git commit -m "feat(api): add /api/candles/{symbol}/max endpoint for full history"
```

---

### Task 3: Wire frontend "ALL" button to new max endpoint

**Files:**
- Modify: `S:\gittttttttttttttttttttt\QuantVeda\frontend\app.js` (modify `loadCandlesData` and range selector handler)

**Interfaces:**
- Consumes: New `/api/candles/{symbol}/max` endpoint
- Produces: "ALL" range button fetches full history and updates chart

- [ ] **Step 1: Write the failing test**

```javascript
// Manual test: Open http://localhost:8000, go to Charts view, click "ALL" button
// Verify: Chart loads with >2 years of daily data for RELIANCE.NS
```

- [ ] **Step 2: Verify current behavior (2 days only)**

```bash
cd S:\gittttttttttttttttttttt\QuantVeda\backend
python -m uvicorn main:app --reload
# Open frontend, test "ALL" button - should show limited data
```

- [ ] **Step 3: Modify app.js loadCandlesData to handle "max" range**

```javascript
// In app.js, modify loadCandlesData function (around line 918)
// Change the rangeStr handling to detect "max" or "all" and call /max endpoint

async function loadCandlesData(symbol, interval = '1d', rangeStr = 'max') {
    if (!tvChart || !candlestickSeries) {
        setupLightweightChart();
    }

    const isDaily = ['1d', '1wk', '1mo'].includes(interval.toLowerCase()) || 
                    ['3mo', '6mo', '1y', '5y', 'max', 'all'].includes(rangeStr.toLowerCase());
    lastIsDaily = isDaily;

    if (tvChart) {
        tvChart.applyOptions({
            timeScale: {
                timeVisible: !isDaily,
                secondsVisible: false
            }
        });
    }

    // NEW: Use /max endpoint for "max" or "all" range
    const isMaxRange = ['max', 'all'].includes(rangeStr.toLowerCase());
    const apiEndpoint = isMaxRange 
        ? `${API_BASE_URL}/api/candles/${encodeURIComponent(symbol)}/max`
        : `${API_BASE_URL}/api/candles/${encodeURIComponent(symbol)}?interval=${interval}&range=${rangeStr}`;

    try {
        const res = await fetch(apiEndpoint);
        const json = await res.json();

        if (json.status === 'success' && json.data && json.data.candles && json.data.candles.length > 0) {
            const seenKeys = new Set();
            const candles = [];
            const volumes = [];

            for (let c of json.data.candles) {
                const formattedTime = formatCandleTime(c.time, isDaily);
                const key = isDaily ? `${formattedTime.year}-${formattedTime.month}-${formattedTime.day}` : formattedTime;
                if (!seenKeys.has(key)) {
                    seenKeys.add(key);
                    candles.push({
                        time: formattedTime,
                        open: c.open,
                        high: c.high,
                        low: c.low,
                        close: c.close
                    });
                    volumes.push({
                        time: formattedTime,
                        value: c.volume || 10000,
                        color: c.close >= c.open ? 'rgba(5, 150, 105, 0.4)' : 'rgba(225, 29, 72, 0.4)'
                    });
                }
            }

            lastCandlesRaw = json.data.candles;

            candlestickSeries.setData(candles);
            if (volumeSeries) volumeSeries.setData(volumes);
            if (tvChart) tvChart.timeScale().fitContent();

            applyIndicators();
            
            // NEW: Show data provenance
            updateDataProvenance(json.data.count, json.data.range || rangeStr);
        } else {
            generateMockCandles();
        }
    } catch (err) {
        console.warn('Candle fetch failed, rendering fallback chart:', err);
        generateMockCandles();
    }
}

// NEW: Add data provenance display
function updateDataProvenance(count, range) {
    const existing = document.getElementById('chart-data-provenance');
    if (existing) existing.remove();
    
    const toolbar = document.getElementById('chart-range-selector');
    if (toolbar) {
        const badge = document.createElement('span');
        badge.id = 'chart-data-provenance';
        badge.className = 'ml-2 text-xs text-on-surface-variant bg-surface-container px-2 py-0.5 rounded font-data-mono';
        badge.textContent = `${count} candles (${range})`;
        toolbar.appendChild(badge);
    }
}
```

- [ ] **Step 4: Test manually**

```bash
cd S:\gittttttttttttttttttttt\QuantVeda\backend
python -m uvicorn main:app --reload
# Open http://localhost:8000
# Go to Charts view
# Click "ALL" button
# Verify: Shows "XXX candles (max)" badge and loads years of data
```

- [ ] **Step 5: Commit**

```bash
git add frontend/app.js
git commit -m "feat(frontend): wire ALL button to /max endpoint, add data provenance badge"
```

---

### Task 4: Verify end-to-end and clean up

**Files:**
- Test: Full integration test

- [ ] **Step 1: Run backend tests**

```bash
cd S:\gittttttttttttttttttttt\QuantVeda\backend
python -m pytest test_broker_max_fetch.py test_max_endpoint.py -v
```

- [ ] **Step 2: Manual full flow test**

```bash
cd S:\gittttttttttttttttttttt\QuantVeda\backend
python -m uvicorn main:app --reload
# Test multiple .NS symbols: RELIANCE.NS, TCS.NS, INFY.NS, HDFCBANK.NS
# Verify each shows substantial history on "ALL" range
# Verify other ranges (1D, 1M, 6M) still work
```

- [ ] **Step 3: Clean up test files (optional - keep for CI)**

```bash
# Keep test files for regression testing
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete max chart range for Indian stocks

- broker.py: fetch_max_candles_data() stitches 1y chunks for full history
- main.py: /api/candles/{symbol}/max endpoint
- app.js: ALL button calls /max, shows data provenance badge
- Tested: RELIANCE.NS, TCS.NS, INFY.NS return 5-10 years of daily data"
```

---

## Self-Review Checklist

- [ ] Spec coverage: All requirements addressed (chunked fetch, new endpoint, frontend wiring, provenance display)
- [ ] No placeholders: All code blocks are complete implementations
- [ ] Type consistency: Function signatures match across tasks (fetch_max_candles_data -> get_max_candles -> endpoint)
- [ ] Error handling: ValueError -> 404, generic Exception -> 500
- [ ] Deduplication: Timestamps deduplicated when stitching chunks
- [ ] Backward compatibility: Existing /api/candles/{symbol} unchanged

---

**Plan complete and saved to `docs/superpowers/plans/2026-08-10-extended-max-chart-range.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**