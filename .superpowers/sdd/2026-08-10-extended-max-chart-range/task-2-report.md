### Task 2 Report: Add /api/candles/{symbol}/max endpoint

**Status: DONE**

**Commits made:**
- `2bdc1a9` feat(api): add /api/candles/{symbol}/max endpoint for full history

**Test command run and output:**
```bash
cd S:\gittttttttttttttttttttt\QuantVeda; python -m pytest backend/test_max_endpoint.py::test_max_candles_endpoint -v
```
Result: **PASSED** (1 passed, 1 warning in 3.52s)

**Implementation details:**
1. Added `get_max_candles` to the import from `backend.broker` (line 11)
2. Added new endpoint `GET /api/candles/{symbol}/max` after `get_candles_endpoint` (around line 219)
3. Endpoint follows existing pattern: clean symbol, try/except with proper HTTPException handling
   - ValueError → 404
   - Generic Exception → 500
4. Returns `{status: "success", data: {...}}` format matching other endpoints

**Concerns/Observations:**
- Test depends on live Yahoo Finance API (RELIANCE.NS) - may be flaky if API is down
- Test asserts `len(data["data"]["candles"]) > 100` which assumes sufficient history exists for RELIANCE.NS
- Existing `get_candles_endpoint` uses 400 for ValueError, new endpoint uses 404 per requirements - this is intentional difference
- Line ending warnings (LF→CRLF) on commit are cosmetic, no functional impact