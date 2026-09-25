# QuantVeda AI

QuantVeda AI is a full-stack market analysis and paper-trading platform focused on Indian equities.  
It combines live quotes, interactive charts, watchlists, a rule-based scanner, portfolio simulation, and AI-assisted sentiment analysis in a single FastAPI app.

## Features

- **Live market data** (quotes, historical candles, max-history candles)
- **Interactive charting UI** with multiple intervals, chart types, and overlays
- **Search & discovery** with Indian market-first symbol handling
- **Watchlists and wishlist targets** with live quote updates
- **Paper trading engine** (wallet, market/limit orders, holdings, portfolio P&L)
- **Scanner engine** with universes, presets, and custom rule configs
- **Prediction tracking** with resolve/scorecard endpoints
- **AI sentiment analysis** with OpenAI + deterministic fallback mode
- **WebSocket price stream** for near-real-time updates

## Repository Structure

```text
QuantVeda/
├── backend/
│   ├── main.py              # FastAPI app + API routes + frontend serving
│   ├── broker.py            # Market data + candles + quote utilities
│   ├── scanner_engine.py    # Universe and scanner rule evaluation
│   ├── ai_agent.py          # AI sentiment pipeline and fallback logic
│   ├── db.py                # SQLite setup and session management
│   ├── models.py            # SQLAlchemy models
│   └── test_*.py            # API/data tests
├── frontend/
│   ├── index.html           # Trading terminal UI
│   └── app.js               # Client-side controllers/state
└── docs/
```

## Tech Stack

- **Backend:** FastAPI, SQLAlchemy, Uvicorn
- **Data:** yfinance + Yahoo Finance endpoints
- **AI:** LangChain + OpenAI (optional, with safe fallback)
- **Frontend:** Vanilla JS, Tailwind CDN, Lightweight Charts
- **Database:** SQLite (`quantveda.db`)

## Quick Start

### 1) Prerequisites

- Python 3.10+
- pip

### 2) Install dependencies

```bash
cd /home/runner/work/QuantVeda/QuantVeda
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
```

### 3) Optional environment variables

Create a `.env` file in `/home/runner/work/QuantVeda/QuantVeda`:

```env
OPENAI_API_KEY=your-openai-api-key
```

If `OPENAI_API_KEY` is missing, sentiment analysis still works using deterministic mock fallback logic.

### 4) Run the app

```bash
cd /home/runner/work/QuantVeda/QuantVeda
uvicorn backend.main:app --reload
```

Open:

- App UI: `http://127.0.0.1:8000/`
- API docs: `http://127.0.0.1:8000/docs`

## Key API Areas

- **Market Data**
  - `GET /api/search?q=...`
  - `GET /api/quote/{symbol}`
  - `GET /api/candles/{symbol}`
  - `GET /api/candles/{symbol}/max`
- **Watchlists / Wishlist**
  - `GET/POST/DELETE /api/watchlists...`
  - `GET/POST/DELETE /api/wishlist...`
- **Paper Trading**
  - `GET /api/wallet`
  - `POST /api/wallet/topup`
  - `POST /api/orders`
  - `GET /api/orders`
  - `GET /api/holdings`
  - `GET /api/portfolio`
- **Scanner**
  - `GET /api/scanner/universes`
  - `POST /api/scanner/run`
  - `POST/GET/DELETE /api/scanner/configs...`
- **AI / Prediction**
  - `GET /api/analyze/{symbol}`
  - `POST /api/ai/sentiment`
  - `POST /api/predictions/resolve`
  - `GET /api/predictions/scorecard`
- **Realtime**
  - `WS /ws/price/{symbol}`

## Running Tests

```bash
cd /home/runner/work/QuantVeda/QuantVeda/backend
pytest -q
```

## Notes

- This project is intended for **paper trading and research workflows**.
- Market data availability depends on external provider responses.
- Wallet and order data are stored locally in SQLite.
