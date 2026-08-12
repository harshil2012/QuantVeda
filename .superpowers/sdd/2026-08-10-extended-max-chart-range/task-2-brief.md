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

**Global Constraints:**
- Yahoo v8 API: 1m max 7d, 5m/15m/60m max 60d, 1d supports 1y/5y/max (but .NS often returns only 2-5y on "max")
- Must deduplicate candles by timestamp when stitching chunks
- Preserve existing `/api/candles/{symbol}` endpoint behavior
- Frontend "ALL" range button already exists in HTML (line 489-491 in index.html)