# SDD ledger — plan: docs/superpowers/plans/2026-08-10-extended-max-chart-range.md

Task 1: complete (commits 225d7fb..0d523e1, 1334afb, review clean)

- 225d7fb: feat(broker): add chunked max history fetch for .NS symbols
- 0d523e1: fix(broker): fix import, range order, meta capture; add test coverage
- 1334afb: fix(broker): use period1/period2 for daily max history, skip monthly 'max' range

Fix rounds (all addressed):
- Critical: requests.utils.quote import added (broker.py:5)
- Important: range order changed to ["max", "5y", "2y", "1y"] → replaced with period1/period2 yearly chunks
- Important: meta captured from first successful chunk (broker.py:503-505)
- Important: Yahoo 'range=max' returns monthly data → fixed by using period1/period2 for daily data
- Minor: test coverage added for deduplication, meta, symbol fallback, error handling
- Minor: _test_mode parameter for testable fallback skipping

Task 2: complete (commits 0d523e1..2bdc1a9, review clean)

- 2bdc1a9: feat(api): add /api/candles/{symbol}/max endpoint for full history

Minor issues noted (non-blocking):
- LF→CRLF line ending changes in main.py (cosmetic)
- Test file missing newline at EOF
- Integration test depends on live Yahoo API (RELIANCE.NS)

Task 3: complete (commits 2bdc1a9..90c0f67, review clean)

- 90c0f67: feat(frontend): wire ALL button to /max endpoint, add data provenance badge

Verified:
- isDaily logic includes 'max'/'all' ranges (app.js:923)
- Backend /max returns {candles, count, range} matching frontend expectations
- chart-range-selector element exists in HTML (index.html:483)

Task 4: complete (commits 90c0f67..1334afb, review clean)

All tests pass (10/10):
- backend/test_broker_max_fetch.py: 9/9 tests pass
- backend/test_max_endpoint.py: 1/1 tests pass

Manual verification:
- fetch_max_candles_data("RELIANCE.NS") returns 4933 daily candles (2006-2025)
- /api/candles/RELIANCE.NS/max endpoint returns full daily history
- Frontend "ALL" button calls /max endpoint and shows provenance badge
- Average timestamp diff: 1.4 days (daily data, accounting for weekends/holidays)

---

**Implementation Summary:**
- **broker.py**: Added `fetch_max_candles_data()` using period1/period2 yearly chunks (20 years) for true daily data, avoiding Yahoo's monthly 'max' range. Includes async wrapper `get_max_candles()`, testable `_test_mode` parameter, and symbol fallback (.NS/.BO).
- **main.py**: Added `GET /api/candles/{symbol}/max` endpoint with proper error handling.
- **app.js**: Wired "ALL" range button to call /max endpoint, added data provenance badge showing candle count.
- **Tests**: Comprehensive coverage for deduplication, metadata capture, symbol fallback, error handling.