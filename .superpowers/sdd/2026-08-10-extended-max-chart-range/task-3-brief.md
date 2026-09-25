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

**Global Constraints:**
- Yahoo v8 API: 1m max 7d, 5m/15m/60m max 60d, 1d supports 1y/5y/max (but .NS often returns only 2-5y on "max")
- Must deduplicate candles by timestamp when stitching chunks
- Preserve existing `/api/candles/{symbol}` endpoint behavior
- Frontend "ALL" range button already exists in HTML (line 489-491 in index.html)