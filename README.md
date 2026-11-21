# QuantVeda

<div align="center">

**Institutional-Grade Market Analysis & Algorithmic Trading Terminal**

[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.111+-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-19.0-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.0-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com)
[![Vite](https://img.shields.io/badge/Vite-8.0-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev)

</div>

---

## Overview

**QuantVeda** is a high-performance market analysis and paper-trading terminal built specifically for Indian equities (NSE/BSE). It delivers an institutional-grade trading experience by unifying real-time candle charts, order book micro-tick simulation, quantitative scanning, options analytics, AI-assisted sentiment, and paper portfolio execution inside a unified architecture.

---

## Key Features

### 1. Interactive Trading Terminal
- **TradingView-Powered Charts:** Built with Lightweight Charts featuring fluid pan, zoom, crosshairs, and multi-chart layout capabilities.
- **Multiple Timeframes:** Supports `1m`, `5m`, `15m`, `1H`, `4H`, `1D`, `1W`, and `1M` resolutions with full history caching.
- **Visual Styles:** Candlestick, Hollow Candles, Line, Area, Bar, and Heikin-Ashi visualizations.
- **Technical Indicators:** Real-time calculation of EMA (9/21/50/200), SMA, Bollinger Bands, RSI, MACD, and Volume profiles.

### 2. Real-Time Market Feed & Exchange Synchronization
- **NSE/BSE Data Engine:** Live market quote retrieval and historical candle ingestion anchored to exchange baselines.
- **Live WebSocket Streams:** Low-latency socket connections (`/ws/price/{symbol}`) streaming continuous tick updates.
- **Micro-Tick Market Simulator:** During active exchange hours, simulates live order-book fluctuations quantized strictly to standard `0.05` NSE tick increments.
- **Market State Awareness:** Automatically detects market hours and freezes closing prices when exchanges are shut.

### 3. Quantitative & Scanner Engines
- **JEV Quantitative Engine:** Jevons Extreme Value volatility modeling, breakout detection, and dynamic percentile anomaly scoring.
- **Universal Market Scanner:** Scans across custom universes (NIFTY 50, NIFTY Bank, NIFTY IT, Midcaps, Smallcaps) with custom filtering rules.
- **Options Analytics Engine:** Black-Scholes Greeks (Delta, Gamma, Theta, Vega), implied volatility (IV) calculations, and option chain analytics.
- **AI Sentiment Analysis:** LangChain + OpenAI sentiment pipeline extracting signals from financial news, accompanied by deterministic fallback mode when API keys are not provided.

### 4. Paper Trading & Portfolio Management
- **Simulated Wallet:** ₹100,000 virtual balance with real-time balance tracking, margin calculation, and instant top-ups.
- **Execution Engine:** Place Market, Limit, and Stop-Loss orders with simulated slippage and execution confirmation.
- **Portfolio Tracking:** Real-time P&L, realized vs. unrealized gains, average cost basis, positions breakdown, and full audit logs.

### 5. Multi-Channel Authentication & Security
- **Google 1-Click Sign-In:** Seamless OAuth integration via Firebase.
- **Phone OTP & Email Login:** Secure password hashing (bcrypt), verification codes, and JWT session handling.
- **Session Management:** Bank-grade token handling with automatic session expiry safeguards.

---

## Repository Structure

```text
QuantVeda/
├── backend/                    # FastAPI backend service
│   ├── main.py                 # FastAPI application, routing, static SPA mounting & WebSockets
│   ├── broker.py               # Yahoo Finance market data adapter & candle processors
│   ├── auth.py                 # Firebase, OTP, Email/Password auth & JWT handlers
│   ├── scanner_engine.py       # Universe configuration & rule evaluation engine
│   ├── jev_engine.py           # JEV quantitative analysis & volatility breakdown
│   ├── options_engine.py       # Black-Scholes options pricing and Greeks
│   ├── ai_agent.py             # LangChain / OpenAI sentiment analysis with fallback
│   ├── db.py                   # SQLAlchemy engine, session management & seeders
│   ├── models.py               # Database schemas (Users, Orders, Holdings, Watchlists)
│   ├── migrate_to_postgres.py  # Production migration utility (SQLite -> PostgreSQL)
│   ├── requirements.txt        # Python backend dependencies
│   └── test_*.py               # Automated pytest test suites
├── web/                        # React SPA source code (Vite + TypeScript)
│   ├── src/
│   │   ├── components/         # Reusable UI components (Topbar, Sidenav, Modals, Charts)
│   │   ├── views/              # Main application views (Dashboard, Charts, Scanner, Portfolio)
│   │   ├── pages/              # Routing pages (AuthPage, TerminalPage)
│   │   ├── lib/                # API client, Firebase helpers, mock utilities
│   │   └── index.css           # Modern cyber-financial design system styles
│   ├── package.json            # Frontend package configuration
│   └── vite.config.ts          # Vite build configuration (outputs to ../frontend)
├── frontend/                   # Compiled production frontend assets served by FastAPI
├── docs/                       # Project specifications and architecture documentation
├── open.bat                    # One-click Windows setup and launch script
└── README.md                   # Project documentation
```

---

## Tech Stack

| Layer | Technologies |
|---|---|
| **Backend** | Python 3.10+, FastAPI, Uvicorn, SQLAlchemy, WebSockets, Pydantic |
| **Frontend** | React 19, TypeScript, Vite, Tailwind CSS 4, Lightweight Charts, Recharts, Lucide |
| **Data & Analytics** | yfinance, NumPy, SciPy, Pandas, LangChain |
| **Database** | SQLite (development default) / PostgreSQL (production ready) |
| **Auth** | Firebase Auth, JWT, PBKDF2/Bcrypt |

---

## Getting Started

### Prerequisites
- **Python 3.10+**
- **Node.js 18+** (only required if modifying and rebuilding the React frontend)
- **Git**

---

### Windows (Quick Start)

Double-click `open.bat` in the root folder, or execute:

```cmd
open.bat
```

This automated script will:
1. Verify Python installation.
2. Initialize and activate a virtual environment (`.venv`).
3. Install backend dependencies.
4. Prepare your `.env` configuration.
5. Launch the Uvicorn server and automatically open your default browser.

---

### Manual Setup (Cross-Platform)

#### 1. Clone the repository
```bash
git clone https://github.com/harshil2012/QuantVeda.git
cd QuantVeda
```

#### 2. Configure Python Virtual Environment
```bash
# Create virtual environment
python -m venv .venv

# Activate virtual environment
# Windows (cmd/PowerShell):
.venv\Scripts\activate
# Linux/macOS:
source .venv/bin/activate

# Install dependencies
pip install -r backend/requirements.txt
```

#### 3. Environment Variables
Create a `.env` file in the root directory (or copy from `.env.example`):
```env
# Optional: OpenAI API Key for live AI news sentiment
# If omitted, QuantVeda operates in deterministic algorithmic fallback mode
OPENAI_API_KEY=your_openai_api_key_here

# Database URL (defaults to SQLite if unset)
DATABASE_URL=sqlite:///./quantveda.db
```

#### 4. Build Frontend (Optional)
The pre-compiled frontend is already included in `frontend/`. If you modify code in `web/`:
```bash
cd web
npm install
npm run build
cd ..
```

#### 5. Launch the Application
```bash
python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Open your browser:
- **Terminal UI:** [http://127.0.0.1:8000/](http://127.0.0.1:8000/)
- **Live Terminal Direct:** [http://127.0.0.1:8000/terminal](http://127.0.0.1:8000/terminal)
- **Interactive Swagger Docs:** [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)

---

## API Reference Overview

| Domain | Method | Endpoint | Description |
|---|---|---|---|
| **Market Data** | `GET` | `/api/search?q={query}` | Symbol autocomplete for Indian equities |
| | `GET` | `/api/quote/{symbol}` | Current market quote, day range & 52w stats |
| | `GET` | `/api/candles/{symbol}` | Historical OHLCV candle records |
| | `GET` | `/api/candles/{symbol}/max` | Full maximum available candle history |
| **Realtime** | `WS` | `/ws/price/{symbol}` | WebSocket stream for live price and tick data |
| **Paper Trading**| `GET` | `/api/wallet` | Get paper wallet balance and statistics |
| | `POST`| `/api/wallet/topup` | Add virtual funds to wallet |
| | `GET` | `/api/orders` | List open and completed orders |
| | `POST`| `/api/orders` | Place Market, Limit, or Stop-Loss order |
| | `GET` | `/api/portfolio` | Full portfolio summary, holdings & aggregate P&L |
| **Scanner** | `GET` | `/api/scanner/universes` | List available stock universes |
| | `POST`| `/api/scanner/run` | Execute custom rule scanning |
| **JEV Engine** | `GET` | `/api/jev/analyze/{symbol}` | Extreme value and volatility breakdown |
| **AI / Sentiment**| `GET` | `/api/analyze/{symbol}` | Comprehensive AI sentiment & technical score |
| | `GET` | `/api/predictions/scorecard`| Historical prediction accuracy metrics |
| **Auth** | `POST`| `/api/auth/register` | Register new account with email/phone |
| | `POST`| `/api/auth/login` | Authenticate with credentials and receive JWT |
| | `POST`| `/api/auth/firebase-login` | Verify Firebase ID token |

---

## Running Test Suites

Execute test suites using `pytest`:

```bash
pytest backend/ -v
```

---

## License & Disclaimer

This project is created for **research, algorithmic simulation, and paper trading purposes only**. It does not constitute financial advice. All trades placed within the terminal utilize virtual paper funds.
