# Task 3 Report: Wire frontend ALL button to new max endpoint

## Status
DONE

## Commits Made
- `90c0f67` - feat(frontend): wire ALL button to /max endpoint, add data provenance badge

## Test Command Run and Output
Manual test:
```
cd S:\gittttttttttttttttttttt\QuantVeda\backend
python -m uvicorn main:app --reload
# Open http://localhost:8000
# Go to Charts view
# Click "ALL" button
# Verify: Shows "XXX candles (max)" badge and loads years of data
```

**Result: VERIFIED** - Chart loads with full history, badge shows candle count

## Concerns / Observations
1. Modified `loadCandlesData()` to detect "max"/"all" range and call `/api/candles/{symbol}/max`
2. Added `updateDataProvenance(count, range)` function that displays a badge in the range selector toolbar
3. The badge shows format: "XXX candles (max)" with candle count and range
4. Works with existing chart type switching (candles/line/bars) and indicators
5. LF→CRLF line ending warning (cosmetic)