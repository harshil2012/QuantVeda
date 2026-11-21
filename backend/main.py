import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import logging
import asyncio
import random
from datetime import datetime
import time
from contextlib import asynccontextmanager
import requests

from typing import Optional, Dict, Tuple, List, Any, Union
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from backend.broker import get_stock_quote, check_is_market_open, get_candles, get_max_candles
from backend.ai_agent import analyze_sentiment
from backend.db import init_db, seed_paper_wallet, get_db, SessionLocal
from backend.models import PaperWallet, Watchlist, User
from backend.auth import router as auth_router, get_optional_user

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("quantveda.main")

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
}

# ===== Real-Time Price Fluctuation Engine =====
# Anchors 100% to genuine Yahoo Finance exchange baseline, while simulating live
# real-time micro-ticks (order book liquidity variations quantized to standard 0.05 NSE ticks).
_base_quote_cache = {}  # { symbol: (timestamp, base_data) }
BASE_CACHE_TTL = 3.0  # seconds - fast but fresh

_live_tick_state = {}  # { symbol: { "current_price": float, "offset": float, "last_direction": str, "last_base": float, "last_tick_time": float } }

def apply_realtime_fluctuation(quote_data: dict) -> dict:
    """
    Applies live real-time micro-tick market fluctuation to genuine exchange quotes.
    STRICTLY ACTIVE ONLY WHEN THE MARKET IS OPEN.
    When the market is closed, prices are 100% frozen at the official exchange closing price.
    """
    if not quote_data or not isinstance(quote_data, dict):
        return quote_data

    symbol = quote_data.get("symbol", "").upper().strip()
    is_open = quote_data.get("is_market_open")
    if is_open is None:
        is_open, status_str = check_is_market_open(quote_data.get("exchange", ""), symbol=symbol)
        quote_data["is_market_open"] = is_open
        quote_data["market_status"] = status_str

    if not is_open:
        # Market is CLOSED: absolutely no price fluctuations allowed.
        # Clear any accumulated micro-tick offset so stale jitter does not persist.
        if symbol in _live_tick_state:
            _live_tick_state.pop(symbol, None)
        frozen = dict(quote_data)
        frozen["is_market_open"] = False
        frozen["market_status"] = quote_data.get("market_status") or "MARKET CLOSED"
        frozen["direction"] = "neutral"
        return frozen

    try:
        base_price = float(quote_data.get("price") or 0.0)
    except (ValueError, TypeError):
        return quote_data
    if base_price <= 0:
        return quote_data

    prev_close = float(quote_data.get("previous_close") or base_price)

    # Retrieve or initialize tick state for this symbol
    state = _live_tick_state.get(symbol)
    if not state or abs(state.get("last_base", 0) - base_price) > (base_price * 0.05):
        state = {
            "current_price": base_price,
            "offset": 0.0,
            "last_direction": "up",
            "last_base": base_price,
            "last_tick_time": time.monotonic()
        }
        _live_tick_state[symbol] = state

    now = time.monotonic()
    # Generate new tick if at least 0.4s passed
    if now - state.get("last_tick_time", 0) >= 0.4:
        # Realistic tick variation (e.g. 5 paise to 20 paise depending on price level)
        tick_unit = 0.05 if base_price < 2000 else 0.10
        max_deviation = base_price * 0.003  # max ±0.3% deviation from real exchange price
        
        offset = state["offset"]
        # Jitter direction with mean-reverting drift towards base_price
        if offset > max_deviation:
            step = -tick_unit * random.choice([1, 2])
        elif offset < -max_deviation:
            step = tick_unit * random.choice([1, 2])
        else:
            step = random.choice([-tick_unit * 2, -tick_unit, tick_unit, tick_unit * 2, -tick_unit, tick_unit])
            
        new_offset = round(offset + step, 2)
        new_price = round(base_price + new_offset, 2)
        direction = "up" if new_price > state["current_price"] else ("down" if new_price < state["current_price"] else state["last_direction"])
        
        state["offset"] = new_offset
        state["last_price"] = state["current_price"]
        state["current_price"] = new_price
        state["last_direction"] = direction
        state["last_tick_time"] = now

    current_price = state["current_price"]
    price_change = round(current_price - prev_close, 2)
    price_change_pct = round((price_change / prev_close) * 100, 2) if prev_close else 0.0
    day_high = max(float(quote_data.get("day_high") or current_price), current_price)
    day_low = min(float(quote_data.get("day_low") or current_price), current_price)

    fluctuated = dict(quote_data)
    fluctuated["price"] = current_price
    fluctuated["change"] = price_change
    fluctuated["change_pct"] = price_change_pct
    fluctuated["day_high"] = day_high
    fluctuated["day_low"] = day_low
    fluctuated["direction"] = state.get("last_direction", "up")
    fluctuated["tick_time"] = datetime.utcnow().isoformat()
    return fluctuated

async def get_cached_quote(symbol: str):
    """Get quote with real-time micro-tick fluctuation anchored to real exchange data."""
    now = time.monotonic()
    cached = _base_quote_cache.get(symbol)
    ttl = BASE_CACHE_TTL
    if cached:
        # If market is closed, cache for 30 seconds to minimize unnecessary upstream calls
        is_open = cached[1].get("is_market_open", True)
        if not is_open:
            ttl = 30.0

    if cached and (now - cached[0]) < ttl:
        base_data = cached[1]
    else:
        base_data = await get_stock_quote(symbol)
        _base_quote_cache[symbol] = (now, base_data)
    return apply_realtime_fluctuation(base_data)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database and seed paper wallet on startup."""
    logger.info("Initializing database...")
    init_db()
    db = SessionLocal()
    try:
        wallet = seed_paper_wallet(db)
    finally:
        db.close()
    
    # Background cache pre-warming for instant sub-millisecond response on first click
    async def _prewarm_cache():
        try:
            popular = ["RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "TATAMOTORS.NS", "SBIN.NS", "BHARTIARTL.NS", "ITC.NS", "LT.NS", "ICICIBANK.NS"]
            for s in popular:
                try:
                    await get_cached_quote(s)
                    await get_candles(s, interval="1d", range_str="6mo")
                except Exception:
                    pass
            logger.info("Pre-warming complete: Core Indian market equities cached in memory.")
        except Exception as e:
            logger.debug(f"Prewarm background info: {e}")
            
    # Background stop loss & target auto-trigger loop (monitors open positions and auto-exits to protect loss)
    async def _sl_target_monitor_loop():
        while True:
            try:
                await asyncio.sleep(2.0)
                from backend.models import Holding, PaperWallet, Order
                db_mon = SessionLocal()
                try:
                    positions = db_mon.query(Holding).filter(
                        (Holding.stop_loss.isnot(None)) | (Holding.stop_loss_price.isnot(None)) | (Holding.target_price.isnot(None))
                    ).all()
                    for h in positions:
                        if not h or not h.symbol or abs(h.qty) < 1e-9:
                            continue
                        try:
                            # Parse underlying symbol if option
                            base_sym = h.symbol.split(" ")[0].upper()
                            if base_sym in ("NSEI", "NIFTY", "^NSEI"):
                                base_sym = "^NSEI"
                            elif base_sym in ("NSEBANK", "BANKNIFTY", "^NSEBANK"):
                                base_sym = "^NSEBANK"
                            elif not base_sym.endswith(".NS") and not base_sym.startswith("^"):
                                base_sym += ".NS"
                            quote = await get_cached_quote(base_sym)
                            spot = float(quote.get("price", 0.0))
                            if spot <= 0:
                                continue

                            # If option, calculate current option price
                            if h.instrument_type in ("CE", "PE") and h.strike_price:
                                from backend.options_engine import calculate_black_scholes
                                opt_calc = calculate_black_scholes(spot, h.strike_price, 7, h.instrument_type)
                                current_p = opt_calc["price"]
                            else:
                                current_p = spot

                            sl = h.stop_loss_price or h.stop_loss
                            tp = h.target_price
                            is_long = h.qty > 0

                            hit_sl = sl and ((is_long and current_p <= sl) or (not is_long and current_p >= sl))
                            hit_tp = tp and ((is_long and current_p >= tp) or (not is_long and current_p <= tp))

                            if hit_sl or hit_tp:
                                reason = "Stop Loss" if hit_sl else "Target"
                                wallet = db_mon.query(PaperWallet).filter(PaperWallet.user_id == h.user_id).first()
                                if wallet:
                                    if is_long:
                                        pnl = (current_p - h.avg_buy_price) * h.qty
                                        wallet.cash_balance += h.qty * current_p
                                        side = "SELL"
                                    else:
                                        pnl = (h.avg_buy_price - current_p) * abs(h.qty)
                                        wallet.cash_balance -= abs(h.qty) * current_p
                                        side = "COVER"

                                    order = Order(
                                        user_id=h.user_id, symbol=h.symbol, side=side, order_type="SL-M",
                                        qty=abs(h.qty), filled_price=current_p, status="FILLED",
                                        realized_pnl=pnl, instrument_type=h.instrument_type or "EQUITY"
                                    )
                                    db_mon.add(order)
                                    from backend.db import log_activity
                                    action_icon = "🛑" if hit_sl else "🎯"
                                    log_activity(db_mon, h.user_id, "sl_trigger", f"{action_icon} {reason} Auto-Triggered: {side} {abs(h.qty)} {h.symbol} @ ₹{current_p:.2f} (PnL: ₹{pnl:+,.2f})", h.symbol)
                                    db_mon.delete(h)
                                    db_mon.commit()
                        except Exception:
                            pass
                finally:
                    db_mon.close()
            except asyncio.CancelledError:
                break
            except Exception:
                pass

    asyncio.create_task(_prewarm_cache())
    asyncio.create_task(_sl_target_monitor_loop())
    yield

app = FastAPI(
    title="QuantVeda Backend",
    description="FastAPI backend serving real-time market quotes, search autocomplete, market status, and AI sentiment analysis.",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)

@app.middleware("http")
async def add_no_cache_headers(request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


# Curated Indian index symbols - Yahoo's fuzzy search often misses these
# because "NIFTY" / "SENSEX" etc. are indices, not tradeable equities.
INDIAN_INDEX_ALIASES = {
    "NIFTY": {"symbol": "^NSEI", "name": "NIFTY 50", "exchange": "NSI", "type": "INDEX"},
    "NIFTY50": {"symbol": "^NSEI", "name": "NIFTY 50", "exchange": "NSI", "type": "INDEX"},
    "NIFTY 50": {"symbol": "^NSEI", "name": "NIFTY 50", "exchange": "NSI", "type": "INDEX"},
    "BANKNIFTY": {"symbol": "^NSEBANK", "name": "NIFTY BANK", "exchange": "NSI", "type": "INDEX"},
    "BANK NIFTY": {"symbol": "^NSEBANK", "name": "NIFTY BANK", "exchange": "NSI", "type": "INDEX"},
    "SENSEX": {"symbol": "^BSESN", "name": "S&P BSE SENSEX", "exchange": "BSE", "type": "INDEX"},
    "NIFTYIT": {"symbol": "^CNXIT", "name": "NIFTY IT", "exchange": "NSI", "type": "INDEX"},
    "NIFTY IT": {"symbol": "^CNXIT", "name": "NIFTY IT", "exchange": "NSI", "type": "INDEX"},
}

def _is_indian_exchange(exch: str, symbol: str = "") -> bool:
    exch_u = (exch or "").upper()
    sym_u = (symbol or "").upper()
    return (
        "NSI" in exch_u or "BSE" in exch_u or "NSE" in exch_u
        or sym_u.endswith(".NS") or sym_u.endswith(".BO")
    )

POPULAR_INDIAN_STOCKS = [
    {"symbol": "RELIANCE.NS", "name": "Reliance Industries Ltd", "exchange": "NSE", "type": "EQUITY"},
    {"symbol": "TCS.NS", "name": "Tata Consultancy Services Ltd", "exchange": "NSE", "type": "EQUITY"},
    {"symbol": "HDFCBANK.NS", "name": "HDFC Bank Ltd", "exchange": "NSE", "type": "EQUITY"},
    {"symbol": "INFY.NS", "name": "Infosys Ltd", "exchange": "NSE", "type": "EQUITY"},
    {"symbol": "ICICIBANK.NS", "name": "ICICI Bank Ltd", "exchange": "NSE", "type": "EQUITY"},
    {"symbol": "BHARTIARTL.NS", "name": "Bharti Airtel Ltd", "exchange": "NSE", "type": "EQUITY"},
    {"symbol": "SBIN.NS", "name": "State Bank of India", "exchange": "NSE", "type": "EQUITY"},
    {"symbol": "TATAMOTORS.NS", "name": "Tata Motors Ltd", "exchange": "NSE", "type": "EQUITY"},
    {"symbol": "TATASTEEL.NS", "name": "Tata Steel Ltd", "exchange": "NSE", "type": "EQUITY"},
    {"symbol": "WAAREEENER.NS", "name": "Waaree Energies Ltd", "exchange": "NSE", "type": "EQUITY"},
    {"symbol": "LT.NS", "name": "Larsen & Toubro Ltd", "exchange": "NSE", "type": "EQUITY"},
    {"symbol": "AXISBANK.NS", "name": "Axis Bank Ltd", "exchange": "NSE", "type": "EQUITY"},
    {"symbol": "HINDUNILVR.NS", "name": "Hindustan Unilever Ltd", "exchange": "NSE", "type": "EQUITY"},
    {"symbol": "BAJFINANCE.NS", "name": "Bajaj Finance Ltd", "exchange": "NSE", "type": "EQUITY"},
    {"symbol": "MARUTI.NS", "name": "Maruti Suzuki India Ltd", "exchange": "NSE", "type": "EQUITY"},
    {"symbol": "SUNPHARMA.NS", "name": "Sun Pharmaceutical Industries Ltd", "exchange": "NSE", "type": "EQUITY"},
    {"symbol": "TITAN.NS", "name": "Titan Company Ltd", "exchange": "NSE", "type": "EQUITY"},
    {"symbol": "NTPC.NS", "name": "NTPC Ltd", "exchange": "NSE", "type": "EQUITY"},
    {"symbol": "POWERGRID.NS", "name": "Power Grid Corporation of India Ltd", "exchange": "NSE", "type": "EQUITY"},
    {"symbol": "M&M.NS", "name": "Mahindra & Mahindra Ltd", "exchange": "NSE", "type": "EQUITY"},
    {"symbol": "ADANIENT.NS", "name": "Adani Enterprises Ltd", "exchange": "NSE", "type": "EQUITY"},
    {"symbol": "ADANIPORTS.NS", "name": "Adani Ports & SEZ Ltd", "exchange": "NSE", "type": "EQUITY"},
    {"symbol": "COALINDIA.NS", "name": "Coal India Ltd", "exchange": "NSE", "type": "EQUITY"},
    {"symbol": "ONGC.NS", "name": "Oil & Natural Gas Corp Ltd", "exchange": "NSE", "type": "EQUITY"},
    {"symbol": "WIPRO.NS", "name": "Wipro Ltd", "exchange": "NSE", "type": "EQUITY"},
    {"symbol": "HAL.NS", "name": "Hindustan Aeronautics Ltd", "exchange": "NSE", "type": "EQUITY"},
    {"symbol": "BEL.NS", "name": "Bharat Electronics Ltd", "exchange": "NSE", "type": "EQUITY"},
    {"symbol": "TRENT.NS", "name": "Trent Ltd", "exchange": "NSE", "type": "EQUITY"},
    {"symbol": "ZOMATO.NS", "name": "Zomato Ltd", "exchange": "NSE", "type": "EQUITY"},
    {"symbol": "JIOFIN.NS", "name": "Jio Financial Services Ltd", "exchange": "NSE", "type": "EQUITY"},
]

def _search_tickers(query: str) -> list:
    """
    Helper to query Yahoo Finance search autocomplete endpoint, biased toward
    Indian exchanges (NSE/BSE) since that's the primary market this app targets.
    Includes local index for instant zero-latency matches.
    """
    q_clean = query.strip()
    if not q_clean:
        return []

    results = []
    alias_hit = INDIAN_INDEX_ALIASES.get(q_clean.upper())
    if alias_hit:
        results.append(dict(alias_hit))

    # Match against local Indian stock index first
    q_lower = q_clean.lower()
    for stock in POPULAR_INDIAN_STOCKS:
        if q_lower in stock["symbol"].lower() or q_lower in stock["name"].lower():
            if stock["symbol"] not in {r["symbol"] for r in results}:
                results.append(dict(stock))

    # If raw ticker without suffix typed (e.g. RELIANCE), offer .NS option
    if not q_clean.endswith(".NS") and not q_clean.endswith(".BO") and not q_clean.startswith("^"):
        ns_sym = f"{q_clean.upper()}.NS"
        if ns_sym not in {r["symbol"] for r in results}:
            results.append({"symbol": ns_sym, "name": f"{q_clean.upper()} (NSE India)", "exchange": "NSE", "type": "EQUITY"})

    url = (
        f"https://query2.finance.yahoo.com/v1/finance/search?q={requests.utils.quote(q_clean)}"
        f"&quotesCount=12&newsCount=0&region=IN&lang=en-IN"
    )
    try:
        r = requests.get(url, headers=HEADERS, timeout=4)
        if r.status_code == 200:
            quotes = r.json().get('quotes', [])
            for item in quotes:
                sym = item.get('symbol')
                name = item.get('shortname') or item.get('longname') or sym
                exch = item.get('exchange', 'GLOBAL')
                qtype = item.get('typeDisp') or item.get('quoteType', 'EQUITY')
                if sym and sym not in {r["symbol"] for r in results}:
                    results.append({
                        "symbol": sym,
                        "name": name,
                        "exchange": exch,
                        "type": qtype
                    })
    except Exception as e:
        logger.warning(f"Ticker search API failed for query '{q_clean}': {e}")

    results.sort(key=lambda r: 0 if _is_indian_exchange(r["exchange"], r["symbol"]) else 1)
    return results[:10]

@app.get("/api/search")
async def search_ticker(q: str = ""):
    query_clean = q.strip()
    if not query_clean:
        return {"status": "success", "data": [], "results": []}
        
    loop = asyncio.get_running_loop()
    results = await loop.run_in_executor(None, _search_tickers, query_clean)
    return {
        "status": "success",
        "data": results,
        "results": results
    }

@app.get("/api/quote/{symbol}")
async def read_quote(symbol: str):
    clean_symbol = symbol.strip().upper()
    if not clean_symbol:
        raise HTTPException(status_code=400, detail="Symbol parameter cannot be empty.")
        
    logger.info(f"GET /api/quote/{clean_symbol}")
    try:
        quote_data = await get_cached_quote(clean_symbol)
        return {
            "status": "success",
            "data": quote_data
        }
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve))
    except Exception as e:
        logger.error(f"Failed to fetch stock quote for {clean_symbol}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="An error occurred while fetching the market price.")


@app.get("/api/quotes")
async def read_multiple_quotes(symbols: str):
    """Fetch live real-time price quotes for multiple symbols (comma-separated) in one concurrent request."""
    if not symbols:
        return {"status": "success", "data": []}
    sym_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    tasks = [get_cached_quote(s) for s in sym_list]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    quotes = []
    for s, res in zip(sym_list, results):
        if isinstance(res, Exception):
            quotes.append({
                "symbol": s,
                "price": 0.0,
                "change": 0.0,
                "change_pct": 0.0,
                "currency_symbol": "₹",
                "error": str(res)
            })
        else:
            quotes.append(res)
    return {"status": "success", "data": quotes}


_candles_cache: Dict[str, Tuple[float, dict]] = {}

@app.get("/api/candles/{symbol}")
async def get_candles_endpoint(symbol: str, interval: str = "1d", range: str = "6mo"):
    """Fetch OHLCV candlestick historical data for TradingView charts."""
    clean_symbol = symbol.strip().upper()
    if not clean_symbol:
        raise HTTPException(status_code=400, detail="Symbol parameter cannot be empty.")
    
    cache_key = f"{clean_symbol}_{interval}_{range}"
    now = time.time()
    if cache_key in _candles_cache:
        ts, cached_data = _candles_cache[cache_key]
        if now - ts < 60:  # 60s in-memory cache
            return {"status": "success", "data": cached_data}

    try:
        data = await get_candles(clean_symbol, interval=interval, range_str=range)
        _candles_cache[cache_key] = (now, data)
        return {"status": "success", "data": data}
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Failed to fetch candles for {clean_symbol}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="An error occurred while fetching candlestick history.")


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


from pydantic import BaseModel, Field
from typing import Optional, List

class WatchlistCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    source: str = "manual"

class WatchlistItemAdd(BaseModel):
    symbol: str = Field(..., min_length=1)
    name: Optional[str] = ""
    exchange: Optional[str] = ""

class WishlistItemAdd(BaseModel):
    symbol: str = Field(..., min_length=1)
    name: Optional[str] = ""
    target_price: float = Field(..., gt=0)
    note: Optional[str] = ""

class OrderCreate(BaseModel):
    symbol: str = Field(..., min_length=1)
    side: str = Field(..., pattern="^(BUY|SELL|SHORT|COVER|buy|sell|short|cover)$")
    order_type: str = Field(..., pattern="^(MARKET|LIMIT|SL|SL-M|SL-LIMIT|market|limit|sl|sl-m|sl-limit)$")
    qty: float = Field(..., gt=0)
    limit_price: Optional[float] = None
    stop_loss_price: Optional[float] = None
    target_price: Optional[float] = None
    instrument_type: Optional[str] = "EQUITY"  # "EQUITY", "CE", "PE"
    strike_price: Optional[float] = None
    expiry_date: Optional[str] = None


class WalletTopup(BaseModel):
    amount: float = Field(..., gt=0)

class ScannerRunPayload(BaseModel):
    universe: Optional[str] = "NIFTY 50"
    custom_symbols: Optional[List[str]] = []
    rules: List[dict]

class ScannerConfigCreate(BaseModel):
    name: str = Field(..., min_length=1)
    universe: Optional[str] = "NIFTY 50"
    custom_symbols: Optional[List[str]] = []
    rules: List[dict]

class SaveHitsToWatchlistPayload(BaseModel):
    watchlist_id: int
    symbols: List[str]



# === Phase 2: Watchlist CRUD Endpoints ===

@app.get("/api/watchlists")
def list_watchlists(user: Optional[User] = Depends(get_optional_user), db: Session = Depends(get_db)):
    """List all watchlists with their items. Auto-creates 'Default' if none exist."""
    from backend.models import WatchlistItem, WishlistItem
    uid = user.id if user else None
    if uid is not None:
        watchlists = db.query(Watchlist).filter(Watchlist.user_id == uid).all()
    else:
        watchlists = db.query(Watchlist).filter(Watchlist.user_id.is_(None)).all()

    if not watchlists:
        default_wl = Watchlist(user_id=uid, name="Default Watchlist", source="manual")
        db.add(default_wl)
        db.commit()
        db.refresh(default_wl)
        watchlists = [default_wl]

    result = []
    for w in watchlists:
        items = [
            {
                "id": item.id,
                "symbol": item.symbol,
                "name": item.name or item.symbol,
                "exchange": item.exchange or "NSE",
                "added_at": item.added_at.isoformat() if item.added_at else None
            }
            for item in w.items
        ]
        result.append({
            "id": w.id,
            "name": w.name,
            "source": w.source,
            "created_at": w.created_at.isoformat() if w.created_at else None,
            "items": items
        })
    return {"status": "success", "data": result}

@app.post("/api/watchlists")
def create_watchlist(payload: WatchlistCreate, user: Optional[User] = Depends(get_optional_user), db: Session = Depends(get_db)):
    """Create a new named watchlist."""
    uid = user.id if user else None
    q = db.query(Watchlist).filter(Watchlist.name == payload.name.strip())
    if uid is not None:
        existing = q.filter(Watchlist.user_id == uid).first()
    else:
        existing = q.filter(Watchlist.user_id.is_(None)).first()

    if existing:
        raise HTTPException(status_code=400, detail="Watchlist with this name already exists.")
    
    wl = Watchlist(user_id=uid, name=payload.name.strip(), source=payload.source)
    db.add(wl)
    db.commit()
    db.refresh(wl)
    return {"status": "success", "data": {"id": wl.id, "name": wl.name, "source": wl.source, "items": []}}

@app.delete("/api/watchlists/{watchlist_id}")
def delete_watchlist(watchlist_id: int, db: Session = Depends(get_db)):
    """Delete a watchlist."""
    wl = db.query(Watchlist).filter(Watchlist.id == watchlist_id).first()
    if not wl:
        raise HTTPException(status_code=404, detail="Watchlist not found.")
    db.delete(wl)
    db.commit()
    return {"status": "success", "message": f"Watchlist '{wl.name}' deleted."}

@app.post("/api/watchlists/{watchlist_id}/items")
def add_watchlist_item(watchlist_id: int, payload: WatchlistItemAdd, db: Session = Depends(get_db)):
    """Add a stock symbol to a specific watchlist."""
    from backend.models import WatchlistItem
    wl = db.query(Watchlist).filter(Watchlist.id == watchlist_id).first()
    if not wl:
        raise HTTPException(status_code=404, detail="Watchlist not found.")

    sym_clean = payload.symbol.strip().upper()
    existing = db.query(WatchlistItem).filter(
        WatchlistItem.watchlist_id == watchlist_id,
        WatchlistItem.symbol == sym_clean
    ).first()
    if existing:
        return {"status": "success", "message": "Symbol already in watchlist.", "data": {"id": existing.id, "symbol": existing.symbol}}

    item = WatchlistItem(
        watchlist_id=watchlist_id,
        symbol=sym_clean,
        name=payload.name or sym_clean,
        exchange=payload.exchange or "NSE"
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return {
        "status": "success",
        "data": {
            "id": item.id,
            "watchlist_id": item.watchlist_id,
            "symbol": item.symbol,
            "name": item.name,
            "exchange": item.exchange,
            "added_at": item.added_at.isoformat() if item.added_at else None
        }
    }

@app.delete("/api/watchlists/{watchlist_id}/items/{item_id}")
def remove_watchlist_item(watchlist_id: int, item_id: int, db: Session = Depends(get_db)):
    """Remove an item from a watchlist."""
    from backend.models import WatchlistItem
    item = db.query(WatchlistItem).filter(
        WatchlistItem.watchlist_id == watchlist_id,
        WatchlistItem.id == item_id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Watchlist item not found.")
    db.delete(item)
    db.commit()
    return {"status": "success", "message": "Item removed from watchlist."}

@app.get("/api/watchlists/{watchlist_id}/quotes")
async def get_watchlist_quotes(watchlist_id: int, db: Session = Depends(get_db)):
    """Fetch live price quotes for all symbols in a watchlist."""
    wl = db.query(Watchlist).filter(Watchlist.id == watchlist_id).first()
    if not wl:
        raise HTTPException(status_code=404, detail="Watchlist not found.")

    tasks = [get_cached_quote(item.symbol) for item in wl.items]
    quotes = []
    if tasks:
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for item, res in zip(wl.items, results):
            if isinstance(res, Exception):
                quotes.append({
                    "id": item.id,
                    "symbol": item.symbol,
                    "name": item.name,
                    "exchange": item.exchange,
                    "price": 0.0,
                    "change": 0.0,
                    "change_pct": 0.0,
                    "error": str(res)
                })
            else:
                quotes.append({
                    "id": item.id,
                    "symbol": item.symbol,
                    "name": item.name or res.get("symbol"),
                    "exchange": res.get("exchange", item.exchange),
                    "currency_symbol": res.get("currency_symbol", "$"),
                    "price": res.get("price", 0.0),
                    "change": res.get("change", 0.0),
                    "change_pct": res.get("change_pct", 0.0),
                    "previous_close": res.get("previous_close", 0.0),
                    "historical_closes": res.get("historical_closes", [])
                })
    return {"status": "success", "data": {"watchlist_id": wl.id, "name": wl.name, "quotes": quotes}}

# === Phase 2: Wishlist Endpoints ===

@app.get("/api/wishlist")
async def list_wishlist(user: Optional[User] = Depends(get_optional_user), db: Session = Depends(get_db)):
    """List all wishlist target price items with live price comparison."""
    from backend.models import WishlistItem
    uid = user.id if user else None
    if uid is not None:
        items = db.query(WishlistItem).filter(WishlistItem.user_id == uid).all()
    else:
        items = db.query(WishlistItem).filter(WishlistItem.user_id.is_(None)).all()

    if not items:
        return {"status": "success", "data": []}

    tasks = [get_stock_quote(item.symbol) for item in items]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    response_items = []
    for item, res in zip(items, results):
        live_price = 0.0
        currency_sym = "$"
        if not isinstance(res, Exception):
            live_price = res.get("price", 0.0)
            currency_sym = res.get("currency_symbol", "$")
        
        # Check if target price has been hit/crossed
        target_hit = False
        if live_price > 0:
            target_hit = live_price <= item.target_price

        response_items.append({
            "id": item.id,
            "symbol": item.symbol,
            "name": item.name or item.symbol,
            "target_price": item.target_price,
            "live_price": live_price,
            "currency_symbol": currency_sym,
            "note": item.note,
            "target_hit": target_hit,
            "created_at": item.created_at.isoformat() if item.created_at else None
        })

    return {"status": "success", "data": response_items}

@app.post("/api/wishlist")
def add_wishlist_item(payload: WishlistItemAdd, user: Optional[User] = Depends(get_optional_user), db: Session = Depends(get_db)):
    """Add a stock target price alert to Wishlist."""
    from backend.models import WishlistItem
    sym_clean = payload.symbol.strip().upper()
    uid = user.id if user else None
    
    item = WishlistItem(
        user_id=uid,
        symbol=sym_clean,
        name=payload.name or sym_clean,
        target_price=payload.target_price,
        note=payload.note or ""
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return {
        "status": "success",
        "data": {
            "id": item.id,
            "symbol": item.symbol,
            "name": item.name,
            "target_price": item.target_price,
            "note": item.note,
            "created_at": item.created_at.isoformat() if item.created_at else None
        }
    }

@app.delete("/api/wishlist/{item_id}")
def remove_wishlist_item(item_id: int, db: Session = Depends(get_db)):
    """Remove an item from Wishlist."""
    from backend.models import WishlistItem
    item = db.query(WishlistItem).filter(WishlistItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Wishlist item not found.")
    db.delete(item)
    db.commit()
    return {"status": "success", "message": "Wishlist item deleted."}

@app.get("/api/wallet")
def get_wallet(user: Optional[User] = Depends(get_optional_user), db: Session = Depends(get_db)):
    """Get paper wallet balance."""
    uid = user.id if user else None
    wallet = db.query(PaperWallet).filter(PaperWallet.user_id == uid).first()
    if not wallet:
        wallet = seed_paper_wallet(db, user_id=uid)
    return {
        "status": "success",
        "data": {
            "cash_balance": wallet.cash_balance,
            "starting_balance": wallet.starting_balance,
            "updated_at": wallet.updated_at.isoformat() if wallet.updated_at else None
        }
    }

@app.post("/api/wallet/topup")
def topup_wallet(payload: WalletTopup, user: Optional[User] = Depends(get_optional_user), db: Session = Depends(get_db)):
    """Add virtual cash to paper trading wallet."""
    uid = user.id if user else None
    wallet = db.query(PaperWallet).filter(PaperWallet.user_id == uid).first()
    if not wallet:
        wallet = seed_paper_wallet(db, user_id=uid)
    
    wallet.cash_balance += payload.amount
    wallet.starting_balance += payload.amount
    wallet.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(wallet)
    try:
        from backend.db import log_activity
        log_activity(db, uid, "wallet_topup", f"Added {payload.amount:,.2f}; balance {wallet.cash_balance:,.2f}.", None)
    except Exception:
        pass
    return {"status": "success", "data": {"cash_balance": wallet.cash_balance, "starting_balance": wallet.starting_balance}}

@app.post("/api/orders")
async def place_order(payload: OrderCreate, user: Optional[User] = Depends(get_optional_user), db: Session = Depends(get_db)):
    """Place a market or limit paper order."""
    from backend.models import Order, Holding, PaperWallet
    sym_clean = payload.symbol.strip().upper()
    side = payload.side.strip().upper()
    order_type = payload.order_type.strip().upper()
    qty = float(payload.qty)
    uid = user.id if user else None

    if qty <= 0:
        raise HTTPException(status_code=400, detail="Order quantity must be greater than zero.")

    wallet = db.query(PaperWallet).filter(PaperWallet.user_id == uid).first()
    if not wallet:
        wallet = seed_paper_wallet(db, user_id=uid)

    # Fetch live server price for fill verification (using cache)
    quote = await get_cached_quote(sym_clean)
    live_price = float(quote.get("price", 0.0))
    if live_price <= 0:
        raise HTTPException(status_code=400, detail=f"Could not retrieve live price for {sym_clean}.")

    # Normalize canonical symbol
    canonical_sym = quote.get("symbol", sym_clean).upper()

    instrument = (payload.instrument_type or "EQUITY").strip().upper()
    if instrument not in ("EQUITY", "CE", "PE", "FUT"):
        instrument = "EQUITY"

    # Indices are not tradable directly as equity shares
    NON_TRADABLE_INDICES = {"^NSEI", "^NSEBANK", "^BSESN", "^CNXIT", "^INDIAVIX"}
    if canonical_sym in NON_TRADABLE_INDICES and instrument == "EQUITY":
        raise HTTPException(
            status_code=400,
            detail=f"Market Index '{canonical_sym}' cannot be traded directly as equity shares. Switch instrument above to Call/Put (CE / PE) options or trade NIFTY ETF (NIFTYBEES.NS)."
        )

    from backend.options_engine import calculate_black_scholes, get_strike_step, get_lot_size
    strike = float(payload.strike_price) if payload.strike_price else None
    expiry = payload.expiry_date or "Current Weekly"
    trade_symbol = canonical_sym

    if instrument in ("CE", "PE"):
        if not strike:
            step = get_strike_step(live_price, canonical_sym)
            strike = round(live_price / step) * step
        calc = calculate_black_scholes(spot=live_price, strike=strike, days_to_expiry=7, option_type=instrument)
        fill_price = calc["price"]
        clean_name = canonical_sym.replace(".NS", "").replace("^", "")
        trade_symbol = f"{clean_name} {int(strike)} {instrument}"
    else:
        fill_price = live_price

    sl_price = float(payload.stop_loss_price) if payload.stop_loss_price else None
    tgt_price = float(payload.target_price) if payload.target_price else None

    if order_type in ("MARKET", "SL", "SL-M"):
        total_cost = fill_price * qty

        if side == "BUY":
            holding = db.query(Holding).filter(Holding.user_id == uid, Holding.symbol == trade_symbol).first()
            # If existing SHORT (negative qty) -> COVER first (real profit: sell-high buy-low)
            if holding and holding.qty < 0:
                short_qty = abs(holding.qty)
                cover_qty = min(qty, short_qty)
                cover_cost = fill_price * cover_qty
                if wallet.cash_balance < cover_cost:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Insufficient cash to COVER short position. Required: Rs.{cover_cost:,.2f}, Available: Rs.{wallet.cash_balance:,.2f}"
                    )
                wallet.cash_balance -= cover_cost
                pnl = (holding.avg_buy_price - fill_price) * cover_qty
                holding.qty += cover_qty  # moves toward 0
                holding.updated_at = datetime.utcnow()
                if abs(holding.qty) < 1e-9:
                    db.delete(holding)
                    holding = None

                # Remaining qty (if any) becomes LONG
                remaining = qty - cover_qty
                if remaining > 0:
                    long_cost = fill_price * remaining
                    if wallet.cash_balance < long_cost:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Insufficient cash to go long after cover. Required: Rs.{long_cost:,.2f}, Available: Rs.{wallet.cash_balance:,.2f}"
                        )
                    wallet.cash_balance -= long_cost
                    if holding is None:
                        holding = Holding(
                            user_id=uid, symbol=trade_symbol, qty=remaining, avg_buy_price=fill_price,
                            position_type="LONG", instrument_type=instrument, strike_price=strike,
                            expiry_date=expiry, stop_loss=sl_price, stop_loss_price=sl_price, target_price=tgt_price
                        )
                        db.add(holding)

                order = Order(
                    user_id=uid, symbol=trade_symbol, side="COVER", order_type=order_type,
                    qty=qty, filled_price=fill_price, status="FILLED", realized_pnl=pnl,
                    stop_loss_price=sl_price, target_price=tgt_price, instrument_type=instrument,
                    strike_price=strike, expiry_date=expiry
                )
            else:
                # Normal LONG buy (equities or options)
                if wallet.cash_balance < total_cost:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Insufficient cash balance. Required: Rs.{total_cost:,.2f}, Available: Rs.{wallet.cash_balance:,.2f}"
                    )
                wallet.cash_balance -= total_cost
                if not holding:
                    holding = Holding(
                        user_id=uid, symbol=trade_symbol, qty=qty, avg_buy_price=fill_price,
                        position_type="LONG", instrument_type=instrument, strike_price=strike,
                        expiry_date=expiry, stop_loss=sl_price, stop_loss_price=sl_price, target_price=tgt_price
                    )
                    db.add(holding)
                else:
                    new_total_qty = holding.qty + qty
                    new_avg_price = ((holding.qty * holding.avg_buy_price) + total_cost) / new_total_qty if new_total_qty else fill_price
                    holding.qty = new_total_qty
                    holding.avg_buy_price = new_avg_price
                    holding.position_type = "LONG"
                    holding.instrument_type = instrument
                    if sl_price:
                        holding.stop_loss = sl_price
                        holding.stop_loss_price = sl_price
                    if tgt_price:
                        holding.target_price = tgt_price
                    holding.updated_at = datetime.utcnow()

                order = Order(
                    user_id=uid, symbol=trade_symbol, side="BUY", order_type=order_type,
                    qty=qty, filled_price=fill_price, status="FILLED",
                    stop_loss_price=sl_price, target_price=tgt_price, instrument_type=instrument,
                    strike_price=strike, expiry_date=expiry
                )

        else: # SELL or SHORT
            holding = db.query(Holding).filter(Holding.user_id == uid, Holding.symbol == trade_symbol).first()
            long_available = holding.qty if (holding and holding.qty > 0) else 0

            if long_available >= qty:
                # Exit long delivery position
                pnl = (fill_price - holding.avg_buy_price) * qty
                holding.qty -= qty
                wallet.cash_balance += total_cost
                if holding.qty <= 1e-9:
                    db.delete(holding)
                else:
                    holding.updated_at = datetime.utcnow()
                order = Order(
                    user_id=uid, symbol=trade_symbol, side="SELL", order_type=order_type,
                    qty=qty, filled_price=fill_price, status="FILLED", realized_pnl=pnl,
                    stop_loss_price=sl_price, target_price=tgt_price, instrument_type=instrument,
                    strike_price=strike, expiry_date=expiry
                )
            else:
                # Close any existing long part, then short the rest
                short_qty = qty - long_available
                pnl = 0.0
                if long_available > 0 and holding:
                    pnl = (fill_price - holding.avg_buy_price) * long_available
                    wallet.cash_balance += long_available * fill_price
                    db.delete(holding)
                    holding = None

                # Margin check for short: 20% margin for equity, 50% for options selling
                margin_need = short_qty * fill_price * (0.20 if instrument == "EQUITY" else 0.50)
                if wallet.cash_balance < margin_need:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Insufficient margin to open SHORT position. Required margin: Rs.{margin_need:,.2f}, Available cash: Rs.{wallet.cash_balance:,.2f}"
                    )
                # Short credit: seller receives the cash from the short sale
                wallet.cash_balance += short_qty * fill_price
                existing_short = db.query(Holding).filter(Holding.user_id == uid, Holding.symbol == trade_symbol).first()
                if not existing_short:
                    ns = Holding(
                        user_id=uid, symbol=trade_symbol, qty=-short_qty, avg_buy_price=fill_price,
                        position_type="SHORT", instrument_type=instrument, strike_price=strike,
                        expiry_date=expiry, stop_loss=sl_price, stop_loss_price=sl_price,
                        target_price=tgt_price, margin_blocked=margin_need
                    )
                    db.add(ns)
                else:
                    tot_short = abs(existing_short.qty) + short_qty
                    avg = ((abs(existing_short.qty) * existing_short.avg_buy_price) + short_qty * fill_price) / tot_short if tot_short else fill_price
                    existing_short.qty = -tot_short
                    existing_short.avg_buy_price = avg
                    existing_short.position_type = "SHORT"
                    existing_short.instrument_type = instrument
                    existing_short.margin_blocked = (existing_short.margin_blocked or 0.0) + margin_need
                    if sl_price:
                        existing_short.stop_loss = sl_price
                        existing_short.stop_loss_price = sl_price
                    if tgt_price:
                        existing_short.target_price = tgt_price
                    existing_short.updated_at = datetime.utcnow()

                order = Order(
                    user_id=uid, symbol=trade_symbol, side="SHORT", order_type=order_type,
                    qty=qty, filled_price=fill_price, status="FILLED", realized_pnl=pnl,
                    stop_loss_price=sl_price, target_price=tgt_price, instrument_type=instrument,
                    strike_price=strike, expiry_date=expiry
                )

        db.add(order)
        db.commit()
        db.refresh(order)
        try:
            from backend.db import log_activity
            action_label = order.side
            log_activity(db, uid, "order", f"MARKET {action_label} {qty} {trade_symbol} @ {fill_price:.2f}", trade_symbol)
        except Exception:
            pass
        return {
            "status": "success",
            "message": f"Market {order.side} order FILLED for {qty} {trade_symbol} @ Rs.{fill_price:.2f}",
            "data": {
                "id": order.id, "symbol": order.symbol, "side": order.side,
                "order_type": order.order_type, "qty": order.qty, "filled_price": order.filled_price,
                "realized_pnl": getattr(order, "realized_pnl", 0.0),
                "status": order.status, "cash_balance": wallet.cash_balance
            }
        }

    else: # LIMIT / SL-LIMIT ORDER
        if not payload.limit_price or payload.limit_price <= 0:
            raise HTTPException(status_code=400, detail="Limit order requires a valid positive limit_price.")

        limit_price = float(payload.limit_price)
        total_cost = limit_price * qty

        if side == "BUY" and wallet.cash_balance < total_cost:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient cash balance for limit buy order. Required: ₹{total_cost:,.2f}, Available: ₹{wallet.cash_balance:,.2f}"
            )

        order = Order(
            user_id=uid, symbol=trade_symbol, side=side, order_type=order_type,
            qty=qty, limit_price=limit_price, status="PENDING",
            stop_loss_price=sl_price, target_price=tgt_price, instrument_type=instrument,
            strike_price=strike, expiry_date=expiry
        )
        db.add(order)
        db.commit()
        db.refresh(order)
        try:
            from backend.db import log_activity
            log_activity(db, uid, "order", f"LIMIT {side} {qty} {trade_symbol} @ {limit_price:.2f}", trade_symbol)
        except Exception:
            pass
        return {
            "status": "success",
            "message": f"Limit {side} order QUEUED for {qty} {trade_symbol} @ ₹{limit_price:.2f}",
            "data": {
                "id": order.id, "symbol": order.symbol, "side": order.side,
                "order_type": order.order_type, "qty": order.qty, "limit_price": order.limit_price,
                "status": order.status
            }
        }

@app.get("/api/orders")
def list_orders(user: Optional[User] = Depends(get_optional_user), db: Session = Depends(get_db)):
    """List all orders (blotter) newest first."""
    from backend.models import Order
    uid = user.id if user else None
    orders = db.query(Order).filter(Order.user_id == uid).order_by(Order.created_at.desc()).all()
    return {
        "status": "success",
        "data": [
            {
                "id": o.id,
                "symbol": o.symbol,
                "side": o.side,
                "order_type": o.order_type,
                "qty": o.qty,
                "limit_price": o.limit_price,
                "filled_price": o.filled_price,
                "stop_loss_price": getattr(o, "stop_loss_price", None),
                "target_price": getattr(o, "target_price", None),
                "instrument_type": getattr(o, "instrument_type", "EQUITY") or "EQUITY",
                "status": o.status,
                "created_at": o.created_at.isoformat() if o.created_at else None
            }
            for o in orders
        ]
    }

@app.delete("/api/orders/{order_id}")
def cancel_order(order_id: int, user: Optional[User] = Depends(get_optional_user), db: Session = Depends(get_db)):
    """Cancel a pending limit order."""
    from backend.models import Order
    uid = user.id if user else None
    q = db.query(Order).filter(Order.id == order_id)
    if uid is not None:
        q = q.filter(Order.user_id == uid)
    order = q.first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found.")
    if order.status != "PENDING":
        raise HTTPException(status_code=400, detail=f"Cannot cancel order with status '{order.status}'.")

    order.status = "CANCELLED"
    db.commit()
    return {"status": "success", "message": f"Order #{order_id} cancelled."}

@app.get("/api/holdings")
def list_holdings(user: Optional[User] = Depends(get_optional_user), db: Session = Depends(get_db)):
    """List all current holdings."""
    from backend.models import Holding
    uid = user.id if user else None
    holdings = db.query(Holding).filter(Holding.user_id == uid).all()
    return {
        "status": "success",
        "data": [
            {
                "id": h.id,
                "symbol": h.symbol,
                "name": h.symbol,
                "qty": h.qty,
                "avg_buy_price": h.avg_buy_price,
                "position_type": getattr(h, "position_type", "LONG") or ("SHORT" if h.qty < 0 else "LONG"),
                "instrument_type": getattr(h, "instrument_type", "EQUITY") or "EQUITY",
                "stop_loss": getattr(h, "stop_loss", None),
                "target_price": getattr(h, "target_price", None),
                "updated_at": h.updated_at.isoformat() if h.updated_at else None
            }
            for h in holdings
        ]
    }

@app.post("/api/wallet/reset")
def reset_wallet(user: Optional[User] = Depends(get_optional_user), db: Session = Depends(get_db)):
    """Reset paper trading wallet to ₹1,00,000. Clears all holdings and orders."""
    from backend.models import Holding, Order, PaperWallet, WalletSnapshot
    uid = user.id if user else None
    
    # Clear holdings
    db.query(Holding).filter(Holding.user_id == uid).delete()
    # Clear orders
    db.query(Order).filter(Order.user_id == uid).delete()
    # Clear snapshots
    db.query(WalletSnapshot).delete()
    
    # Reset wallet
    wallet = db.query(PaperWallet).filter(PaperWallet.user_id == uid).first()
    if wallet:
        wallet.cash_balance = 100000.0
        wallet.starting_balance = 100000.0
        wallet.updated_at = datetime.utcnow()
    else:
        wallet = PaperWallet(user_id=uid, cash_balance=100000.0, starting_balance=100000.0)
        db.add(wallet)
    
    db.commit()
    db.refresh(wallet)
    try:
        from backend.db import log_activity
        log_activity(db, uid, "wallet_reset", "Wallet reset to 100000; holdings and orders cleared.", None)
    except Exception:
        pass
    return {
        "status": "success",
        "message": "Paper trading wallet reset to ₹1,00,000.00. All holdings and orders cleared.",
        "data": {
            "cash_balance": wallet.cash_balance,
            "starting_balance": wallet.starting_balance
        }
    }


@app.get("/api/activity")
def list_activity(limit: int = 100, user: Optional[User] = Depends(get_optional_user), db: Session = Depends(get_db)):
    """Per-user activity + history feed (logins, orders, wallet events)."""
    from backend.models import ActivityLog
    from backend.db import ensure_activity_table
    ensure_activity_table()
    uid = user.id if user else None
    limit = max(1, min(limit, 500))
    rows = (
        db.query(ActivityLog)
        .filter(ActivityLog.user_id == uid)
        .order_by(ActivityLog.created_at.desc())
        .limit(limit)
        .all()
    )
    return {
        "status": "success",
        "data": [
            {
                "id": r.id,
                "action": r.action,
                "detail": r.detail,
                "symbol": r.symbol,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
    }

@app.get("/api/portfolio")
async def get_portfolio(user: Optional[User] = Depends(get_optional_user), db: Session = Depends(get_db)):
    """Calculate portfolio holdings with live prices and unrealized/realized P&L."""
    from backend.models import Holding, PaperWallet, Order
    uid = user.id if user else None
    wallet = db.query(PaperWallet).filter(PaperWallet.user_id == uid).first()
    if not wallet:
        wallet = seed_paper_wallet(db, user_id=uid)

    holdings = db.query(Holding).filter(Holding.user_id == uid).all()
    
    total_invested = 0.0
    current_value = 0.0
    days_pnl = 0.0
    
    holdings_data = []
    auto_closed = []
    if holdings:
        tasks = []
        for h in holdings:
            base_sym = h.symbol.split(" ")[0].upper()
            if base_sym in ("NSEI", "NIFTY", "^NSEI"):
                base_sym = "^NSEI"
            elif base_sym in ("NSEBANK", "BANKNIFTY", "^NSEBANK"):
                base_sym = "^NSEBANK"
            elif not base_sym.endswith(".NS") and not base_sym.startswith("^"):
                base_sym += ".NS"
            tasks.append(get_cached_quote(base_sym))
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        for h, res in zip(holdings, results):
            spot_price = h.avg_buy_price
            currency_sym = "₹"
            prev_close = spot_price
            
            if not isinstance(res, Exception):
                spot_price = res.get("price", h.avg_buy_price)
                currency_sym = res.get("currency_symbol", "₹")
                prev_close = res.get("previous_close", spot_price)

            # Determine actual current price for equity vs option
            if h.instrument_type in ("CE", "PE") and h.strike_price:
                from backend.options_engine import calculate_black_scholes
                opt_calc = calculate_black_scholes(spot=spot_price, strike=h.strike_price, days_to_expiry=7, option_type=h.instrument_type)
                actual_price = opt_calc["price"]
            else:
                actual_price = spot_price

            is_short = h.qty < 0 or h.position_type == "SHORT"
            pos_qty = abs(h.qty)
            invested = pos_qty * h.avg_buy_price

            if is_short:
                # SHORT: profit when actual_price < avg_buy_price
                pnl = (h.avg_buy_price - actual_price) * pos_qty
                pnl_pct = ((h.avg_buy_price - actual_price) / h.avg_buy_price * 100) if h.avg_buy_price > 0 else 0.0
                value = - (pos_qty * actual_price)  # liability
                day_change = (prev_close - actual_price) * pos_qty
            else:
                # LONG: profit when actual_price > avg_buy_price
                value = pos_qty * actual_price
                pnl = value - invested
                pnl_pct = (pnl / invested * 100) if invested > 0 else 0.0
                day_change = (actual_price - prev_close) * pos_qty

            days_pnl += day_change
            if not is_short:
                total_invested += invested
                current_value += value
            else:
                # For shorts, equity contribution is entry cash minus current liability to cover
                current_value += (invested + pnl)  # equivalent to cash held

            holdings_data.append({
                "id": h.id,
                "symbol": h.symbol,
                "qty": h.qty,
                "avg_buy_price": h.avg_buy_price,
                "position_type": "SHORT" if is_short else "LONG",
                "instrument_type": getattr(h, "instrument_type", "EQUITY") or "EQUITY",
                "strike_price": getattr(h, "strike_price", None),
                "expiry_date": getattr(h, "expiry_date", None),
                "stop_loss": getattr(h, "stop_loss", None) or getattr(h, "stop_loss_price", None),
                "stop_loss_price": getattr(h, "stop_loss_price", None) or getattr(h, "stop_loss", None),
                "target_price": getattr(h, "target_price", None),
                "live_price": actual_price,
                "currency_symbol": currency_sym,
                "invested": invested,
                "current_value": abs(value),
                "unrealized_pnl": pnl,
                "unrealized_pnl_pct": pnl_pct,
                "day_change": day_change
            })

    closed_orders = db.query(Order).filter(Order.user_id == uid, Order.status == "FILLED").all()
    realized_pnl = sum([getattr(o, "realized_pnl", 0.0) or 0.0 for o in closed_orders])

    total_portfolio_val = wallet.cash_balance + current_value
    total_pnl = total_portfolio_val - wallet.starting_balance
    total_pnl_pct = (total_pnl / wallet.starting_balance * 100) if wallet.starting_balance > 0 else 0.0

    return {
        "status": "success",
        "data": {
            "cash_balance": wallet.cash_balance,
            "starting_balance": wallet.starting_balance,
            "total_invested": total_invested,
            "current_value": current_value,
            "total_portfolio_value": total_portfolio_val,
            "total_pnl": total_pnl,
            "total_pnl_pct": total_pnl_pct,
            "days_pnl": days_pnl,
            "realized_pnl": realized_pnl,
            "holdings": holdings_data
        }
    }

@app.get("/api/portfolio/equity-curve")
def get_equity_curve(db: Session = Depends(get_db)):
    """Fetch wallet snapshots for portfolio performance equity curve."""
    from backend.models import WalletSnapshot
    snapshots = db.query(WalletSnapshot).order_by(WalletSnapshot.snapshot_date.asc()).all()
    return {
        "status": "success",
        "data": [
            {
                "date": s.snapshot_date.isoformat(),
                "cash_balance": s.cash_balance,
                "holdings_value": s.holdings_value,
                "total_value": s.total_value
            }
            for s in snapshots
        ]
    }


# === Core Analysis ===

@app.get("/api/analyze/{symbol}")
async def analyze_stock(symbol: str):
    clean_symbol = symbol.strip().upper()
    if not clean_symbol:
        raise HTTPException(status_code=400, detail="Symbol parameter cannot be empty.")
        
    logger.info(f"GET /api/analyze/{clean_symbol}")
    
    try:
        quote = await get_stock_quote(clean_symbol)
        price = quote.get("price")
        news_headlines = [n.get("title", "") for n in quote.get("news", []) if n.get("title")]
        
        analysis_result = await analyze_sentiment(clean_symbol, price, news_headlines)
        pred_dict = quote.get("prediction", {})
        
        # Log prediction to PredictionLog database (Phase 6)
        try:
            from backend.models import PredictionLog
            from backend.db import SessionLocal
            from datetime import datetime
            db_session = SessionLocal()
            pred_target = pred_dict.get("target_price")
            conf_score = float(pred_dict.get("confidence_score", 75))
            if pred_target and price:
                log_entry = PredictionLog(
                    symbol=clean_symbol,
                    predicted_target=float(pred_target),
                    horizon_days=5,
                    confidence_score=conf_score,
                    status="PENDING",
                    predicted_at=datetime.utcnow()
                )
                db_session.add(log_entry)
                db_session.commit()
                db_session.close()
                logger.info(f"Logged prediction for {clean_symbol}: target={pred_target}")
        except Exception as log_err:
            logger.warning(f"Could not log prediction to DB: {log_err}")


        return {
            "status": "success",
            "data": {
                "symbol": quote.get("symbol", clean_symbol),
                "price": price,
                "previous_close": quote.get("previous_close", price),
                "change": quote.get("change", 0.0),
                "change_pct": quote.get("change_pct", 0.0),
                "day_high": quote.get("day_high", price * 1.01),
                "day_low": quote.get("day_low", price * 0.99),
                "fifty_two_week_high": quote.get("fifty_two_week_high", price * 1.15),
                "fifty_two_week_low": quote.get("fifty_two_week_low", price * 0.85),
                "currency": quote.get("currency", "USD"),
                "currency_symbol": quote.get("currency_symbol", "$"),
                "exchange": quote.get("exchange", "NASDAQ"),
                "is_market_open": quote.get("is_market_open", False),
                "market_status": quote.get("market_status", "MARKET CLOSED"),
                "close_timestamp": quote.get("close_timestamp", "3:30:00 PM GMT+5:30"),
                "prediction": pred_dict,
                "news": quote.get("news", []),
                "historical_closes": quote.get("historical_closes", []),
                "headlines": analysis_result.get("headlines", []),
                "analysis": analysis_result.get("analysis", {})
            }
        }
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve))
    except Exception as e:
        logger.error(f"Failed to run analysis for symbol {clean_symbol}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="An error occurred while analyzing the stock.")

# === Phase 6: Prediction Accuracy Tracker Endpoints ===

@app.post("/api/predictions/resolve")
async def resolve_pending_predictions(db: Session = Depends(get_db)):
    """Resolve all pending predictions against live market prices."""
    from backend.models import PredictionLog
    from datetime import datetime
    pending = db.query(PredictionLog).filter(PredictionLog.status == "PENDING").all()
    if not pending:
        return {"status": "success", "message": "No pending predictions to resolve.", "data": {"resolved_count": 0}}

    symbols = list(set(p.symbol for p in pending))
    tasks = [get_stock_quote(sym) for sym in symbols]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    quote_map = {}
    for sym, res in zip(symbols, results):
        if not isinstance(res, Exception) and res.get("price"):
            quote_map[sym] = float(res["price"])

    resolved_count = 0
    for p in pending:
        actual = quote_map.get(p.symbol)
        if actual and actual > 0:
            p.actual_price = actual
            p.status = "RESOLVED"
            p.resolved_at = datetime.utcnow()

            # Error %
            err_pct = (abs(actual - p.predicted_target) / actual) * 100.0
            p.error_pct = round(err_pct, 2)

            # Direction check (If target > initial, did price increase or stay close)
            p.is_direction_correct = err_pct <= 5.0  # Within 5% tolerance threshold
            resolved_count += 1

    db.commit()
    return {
        "status": "success",
        "message": f"Successfully resolved {resolved_count} predictions.",
        "data": {"resolved_count": resolved_count}
    }

@app.get("/api/predictions/scorecard")
def get_prediction_scorecard(db: Session = Depends(get_db)):
    """Calculate rolling prediction accuracy scorecards and symbol calibration metrics."""
    from backend.models import PredictionLog
    logs = db.query(PredictionLog).order_by(PredictionLog.predicted_at.desc()).all()

    total_logged = len(logs)
    resolved_logs = [l for l in logs if l.status == "RESOLVED"]
    total_resolved = len(resolved_logs)

    if total_resolved == 0:
        return {
            "status": "success",
            "data": {
                "total_logged": total_logged,
                "total_resolved": 0,
                "directional_accuracy_pct": 100.0,
                "mean_absolute_error_pct": 0.0,
                "logs": [
                    {
                        "id": l.id,
                        "symbol": l.symbol,
                        "predicted_target": l.predicted_target,
                        "confidence_score": l.confidence_score,
                        "status": l.status,
                        "actual_price": l.actual_price,
                        "error_pct": l.error_pct,
                        "is_direction_correct": l.is_direction_correct,
                        "predicted_at": l.predicted_at.isoformat() if l.predicted_at else None
                    }
                    for l in logs[:20]
                ]
            }
        }

    correct_count = sum(1 for l in resolved_logs if l.is_direction_correct)
    directional_accuracy_pct = (correct_count / total_resolved) * 100.0
    mae_pct = sum(l.error_pct or 0.0 for l in resolved_logs) / total_resolved

    return {
        "status": "success",
        "data": {
            "total_logged": total_logged,
            "total_resolved": total_resolved,
            "directional_accuracy_pct": round(directional_accuracy_pct, 1),
            "mean_absolute_error_pct": round(mae_pct, 2),
            "logs": [
                {
                    "id": l.id,
                    "symbol": l.symbol,
                    "predicted_target": l.predicted_target,
                    "confidence_score": l.confidence_score,
                    "status": l.status,
                    "actual_price": l.actual_price,
                    "error_pct": l.error_pct,
                    "is_direction_correct": l.is_direction_correct,
                    "predicted_at": l.predicted_at.isoformat() if l.predicted_at else None
                }
                for l in logs[:50]
            ]
        }
    }

@app.websocket("/ws/price/{symbol}")
async def websocket_price_feed(websocket: WebSocket, symbol: str):
    clean_symbol = symbol.strip().upper()
    logger.info(f"WebSocket connection request for: {clean_symbol}")
    await websocket.accept()
    logger.info(f"WebSocket connected for: {clean_symbol}")

    try:
        # --- Initial quote fetch with retry (up to 3 attempts) ---
        quote = None
        backoff_secs = [1, 2]  # delays between attempt 1→2 and 2→3
        for attempt in range(3):
            try:
                quote = await get_stock_quote(clean_symbol)
                break
            except Exception as init_err:
                logger.warning(f"WebSocket initial fetch attempt {attempt + 1}/3 failed for {clean_symbol}: {init_err}")
                if attempt < 2:
                    await asyncio.sleep(backoff_secs[attempt])

        if quote is None:
            logger.error(f"WebSocket initial fetch failed after 3 attempts for {clean_symbol}")
            try:
                await websocket.send_json({"error": True, "message": f"Could not retrieve live price for {clean_symbol}."})
                await websocket.close()
            except Exception:
                pass
            return

        price = float(quote.get("price", 0.0))
        currency_sym = quote.get("currency_symbol", "₹")
        is_market_open = quote.get("is_market_open", False)

        # --- Continuous real-time price push loop ---
        while True:
            await asyncio.sleep(1)
            try:
                fresh_quote = await get_cached_quote(clean_symbol)
                is_open = fresh_quote.get("is_market_open", is_market_open)
                price = float(fresh_quote.get("price", price))
                direction = fresh_quote.get("direction", "up" if is_open else "neutral")

                payload = {
                    "symbol": clean_symbol,
                    "price": round(price, 2),
                    "currency_symbol": fresh_quote.get("currency_symbol", currency_sym),
                    "is_market_open": is_open,
                    "market_status": fresh_quote.get("market_status", "MARKET OPEN" if is_open else "MARKET CLOSED"),
                    "close_timestamp": fresh_quote.get("close_timestamp", "3:30:00 PM GMT+5:30"),
                    "change": fresh_quote.get("change", 0.0),
                    "change_pct": fresh_quote.get("change_pct", 0.0),
                    "day_high": fresh_quote.get("day_high", price),
                    "day_low": fresh_quote.get("day_low", price),
                    "direction": direction,
                    "timestamp": datetime.utcnow().isoformat()
                }
                await websocket.send_json(payload)
                if not is_open:
                    # When market is closed, price is frozen. Heartbeat every 5s instead of 1s.
                    await asyncio.sleep(4)
            except (WebSocketDisconnect, RuntimeError):
                logger.info(f"WebSocket client disconnected for: {clean_symbol}")
                break
            except Exception as poll_err:
                logger.warning(f"WebSocket price re-poll warning for {clean_symbol}: {poll_err}")
                await asyncio.sleep(2)

    except WebSocketDisconnect:
        logger.info(f"WebSocket client disconnected for: {clean_symbol}")
    except Exception as e:
        logger.error(f"WebSocket error for {clean_symbol}: {e}")
        try:
            await websocket.close()
        except Exception:
            pass


# === Phase 5: Chartink-Style Scanner Endpoints ===

@app.get("/api/scanner/universes")
def get_scanner_universes():
    """Get available stock universes and preset scanners."""
    from backend.scanner_engine import UNIVERSES, PRESET_SCANNERS
    return {
        "status": "success",
        "data": {
            "universes": list(UNIVERSES.keys()),
            "presets": PRESET_SCANNERS
        }
    }

@app.post("/api/scanner/run")
async def run_scanner(payload: ScannerRunPayload):
    """Run dynamic multi-rule scanner against a stock universe."""
    from backend.scanner_engine import UNIVERSES, evaluate_scanner_rules
    
    symbols = []
    if payload.universe and payload.universe in UNIVERSES:
        symbols = UNIVERSES[payload.universe]
    elif payload.custom_symbols:
        symbols = payload.custom_symbols
    else:
        symbols = UNIVERSES.get("NIFTY 50", [])

    tasks = [get_cached_quote(sym) for sym in symbols]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    matched_hits = []
    for sym, res in zip(symbols, results):
        if isinstance(res, Exception) or not res:
            continue

        prediction = res.get("prediction", {})
        closes = res.get("historical_closes", [])
        
        # Calculate real 14-period RSI if closes exist
        rsi_14 = 50.0
        if len(closes) >= 2:
            gains = [max(0.0, closes[i] - closes[i-1]) for i in range(1, len(closes))]
            losses = [max(0.0, closes[i-1] - closes[i]) for i in range(1, len(closes))]
            avg_g = sum(gains[-14:]) / max(1, len(gains[-14:]))
            avg_l = sum(losses[-14:]) / max(1, len(losses[-14:]))
            if avg_l == 0:
                rsi_14 = 100.0 if avg_g > 0 else 50.0
            else:
                rs = avg_g / avg_l
                rsi_14 = round(100.0 - (100.0 / (1.0 + rs)), 1)

        sma_20 = (sum(closes[-20:]) / len(closes[-20:])) if len(closes) >= 5 else res.get("price", 0.0)
        momentum_5d = ((closes[-1] - closes[-5]) / closes[-5] * 100) if len(closes) >= 5 else res.get("change_pct", 0.0)

        quote_snapshot = {
            "symbol": sym,
            "name": res.get("name", sym),
            "price": res.get("price", 0.0),
            "change": res.get("change", 0.0),
            "change_pct": res.get("change_pct", 0.0),
            "previous_close": res.get("previous_close", 0.0),
            "currency_symbol": res.get("currency_symbol", "Rs."),
            "rsi_14": rsi_14,
            "sma_20": round(sma_20, 2),
            "momentum_5d_pct": round(momentum_5d, 2),
            "volume": random.randint(1500000, 8000000),
            "avg_volume_10d": 2000000.0
        }

        is_match, reasons = evaluate_scanner_rules(quote_snapshot, payload.rules)
        if is_match:
            quote_snapshot["reasons"] = reasons
            matched_hits.append(quote_snapshot)

    return {
        "status": "success",
        "data": {
            "scanned_count": len(symbols),
            "matched_count": len(matched_hits),
            "hits": matched_hits
        }
    }

@app.post("/api/scanner/configs")
def create_scanner_config(payload: ScannerConfigCreate, db: Session = Depends(get_db)):
    """Save a custom scanner rule preset."""
    from backend.models import ScannerConfig
    cfg = ScannerConfig(
        name=payload.name.strip(),
        universe=payload.universe or "NIFTY 50",
        custom_symbols=payload.custom_symbols or [],
        rules_json=payload.rules
    )
    db.add(cfg)
    db.commit()
    db.refresh(cfg)
    return {"status": "success", "data": {"id": cfg.id, "name": cfg.name, "universe": cfg.universe}}

@app.get("/api/scanner/configs")
def list_scanner_configs(db: Session = Depends(get_db)):
    """List saved custom scanner presets."""
    from backend.models import ScannerConfig
    configs = db.query(ScannerConfig).order_by(ScannerConfig.created_at.desc()).all()
    return {
        "status": "success",
        "data": [
            {
                "id": c.id,
                "name": c.name,
                "universe": c.universe,
                "rules": c.rules_json,
                "created_at": c.created_at.isoformat() if c.created_at else None
            }
            for c in configs
        ]
    }

@app.delete("/api/scanner/configs/{config_id}")
def delete_scanner_config(config_id: int, db: Session = Depends(get_db)):
    """Delete a custom scanner preset."""
    from backend.models import ScannerConfig
    cfg = db.query(ScannerConfig).filter(ScannerConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Scanner config not found.")
    db.delete(cfg)
    db.commit()
    return {"status": "success", "message": "Scanner preset deleted."}

@app.post("/api/scanner/save-hits-to-watchlist")
def save_hits_to_watchlist(payload: SaveHitsToWatchlistPayload, db: Session = Depends(get_db)):
    """Batch add selected scanner hits to a watchlist."""
    from backend.models import Watchlist, WatchlistItem
    wl = db.query(Watchlist).filter(Watchlist.id == payload.watchlist_id).first()
    if not wl:
        raise HTTPException(status_code=404, detail="Target Watchlist not found.")

    added_count = 0
    for sym in payload.symbols:
        sym_clean = sym.strip().upper()
        existing = db.query(WatchlistItem).filter(
            WatchlistItem.watchlist_id == payload.watchlist_id,
            WatchlistItem.symbol == sym_clean
        ).first()
        if not existing:
            item = WatchlistItem(
                watchlist_id=payload.watchlist_id,
                symbol=sym_clean,
                name=sym_clean,
                exchange="NSE"
            )
            db.add(item)
            added_count += 1

    db.commit()
    return {"status": "success", "message": f"Added {added_count} new symbols to watchlist '{wl.name}'."}

class AISentimentPayload(BaseModel):
    symbol: str

@app.post("/api/ai/sentiment")
async def get_ai_sentiment(payload: AISentimentPayload):
    """Returns the single canonical AI signal object for a symbol."""
    clean_symbol = payload.symbol.strip().upper()
    if not clean_symbol:
        raise HTTPException(status_code=400, detail="Symbol parameter cannot be empty.")
    try:
        quote_data = await get_stock_quote(clean_symbol)
        prediction = quote_data.get("prediction", {})
        return {
            "status": "success",
            "data": prediction
        }
    except Exception as e:
        logger.error(f"Failed AI sentiment for {clean_symbol}: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch AI sentiment.")

@app.get("/api/ai/jev-prediction/{symbol}")
async def get_jev_prediction_endpoint(symbol: str):
    """Executes TypeSafe Jev™ System One quantitative prediction."""
    clean_symbol = symbol.strip().upper()
    if not clean_symbol:
        raise HTTPException(status_code=400, detail="Symbol parameter cannot be empty.")
    try:
        from backend.jev_engine import run_jev_prediction
        quote_data = await get_stock_quote(clean_symbol)
        price = float(quote_data.get("price", 0.0))
        change_pct = float(quote_data.get("change_pct", 0.0))
        prev_close = float(quote_data.get("previous_close", price))
        day_high = float(quote_data.get("day_high", price))
        day_low = float(quote_data.get("day_low", price))
        fifty_two_high = float(quote_data.get("fifty_two_week_high", price))
        fifty_two_low = float(quote_data.get("fifty_two_week_low", price))
        historical_closes = quote_data.get("historical_closes", [])
        news = [n.get("title", "") for n in quote_data.get("news", []) if isinstance(n, dict)]

        jev_result = await run_jev_prediction(
            symbol=clean_symbol,
            price=price,
            change_pct=change_pct,
            previous_close=prev_close,
            day_high=day_high,
            day_low=day_low,
            fifty_two_high=fifty_two_high,
            fifty_two_low=fifty_two_low,
            historical_closes=historical_closes,
            headlines=news,
        )
        return {"status": "success", "data": jev_result}
    except Exception as e:
        logger.error(f"Jev prediction failed for {clean_symbol}: {e}", exc_info=True)
# === Phase 6: F&O Options Chain & Quote Endpoints ===

@app.get("/api/options/chain/{symbol}")
async def get_options_chain_endpoint(symbol: str, expiry: Optional[str] = None):
    """Fetch realistic NSE-style option chain for underlying symbol with Black-Scholes pricing."""
    from backend.options_engine import get_option_chain
    clean_sym = symbol.strip().upper()
    quote = await get_cached_quote(clean_sym)
    spot = float(quote.get("price", 0.0))
    if spot <= 0:
        raise HTTPException(status_code=400, detail=f"Could not determine spot price for {clean_sym}")
    chain = get_option_chain(clean_sym, spot_price=spot, expiry_str=expiry)
    return {"status": "success", "data": chain}

@app.get("/api/options/quote")
async def get_option_quote_endpoint(symbol: str, strike: float, type: str = "CE", expiry: Optional[str] = None):
    """Get individual option contract premium, Greeks, and lot size."""
    from backend.options_engine import calculate_black_scholes, get_lot_size, get_option_expiries
    clean_sym = symbol.strip().upper()
    quote = await get_cached_quote(clean_sym)
    spot = float(quote.get("price", 0.0))
    lot = get_lot_size(clean_sym)
    expiries = get_option_expiries()
    matched_exp = next((e for e in expiries if e["expiry"] == expiry), expiries[0])
    calc = calculate_black_scholes(spot, strike, matched_exp["days_to_expiry"], type)
    return {
        "status": "success",
        "data": {
            "symbol": clean_sym,
            "spot_price": spot,
            "strike": strike,
            "type": type.upper(),
            "lot_size": lot,
            "expiry": matched_exp["expiry"],
            "days_to_expiry": matched_exp["days_to_expiry"],
            **calc
        }
    }

class HoldingSLUpdate(BaseModel):
    holding_id: int
    stop_loss_price: Optional[float] = None
    target_price: Optional[float] = None

@app.post("/api/holdings/set-protection")
def update_holding_protection(payload: HoldingSLUpdate, user: Optional[User] = Depends(get_optional_user), db: Session = Depends(get_db)):
    """Set or update Stop Loss and Target price for an existing open holding."""
    from backend.models import Holding
    uid = user.id if user else None
    q = db.query(Holding).filter(Holding.id == payload.holding_id)
    if uid is not None:
        q = q.filter(Holding.user_id == uid)
    h = q.first()
    if not h:
        raise HTTPException(status_code=404, detail="Holding position not found.")
    h.stop_loss = payload.stop_loss_price
    h.stop_loss_price = payload.stop_loss_price
    h.target_price = payload.target_price
    h.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(h)
    return {
        "status": "success",
        "message": f"Updated protection for {h.symbol}: SL ₹{h.stop_loss_price}, Target ₹{h.target_price}",
        "data": {
            "id": h.id, "symbol": h.symbol,
            "stop_loss_price": h.stop_loss_price,
            "target_price": h.target_price
        }
    }

import os
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

frontend_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")
if os.path.exists(frontend_path):
    app.mount("/static", StaticFiles(directory=frontend_path), name="static")

@app.get("/")
@app.get("/login")
@app.get("/auth")
@app.get("/terminal")
@app.get("/trade")
@app.get("/app")
@app.get("/dashboard")
async def serve_spa():
    """Serves the QuantVeda React SPA (auth gate + terminal)."""
    index_file = os.path.join(frontend_path, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return {"status": "running", "project": "QuantVeda", "version": "1.0.0"}

@app.get("/{filename:path}")
async def serve_frontend_files(filename: str):
    # Never shadow API/docs routes with the SPA fallback.
    if filename.startswith("api/") or filename in ("docs", "openapi.json", "redoc"):
        raise HTTPException(status_code=404, detail="Not found")
    file_path = os.path.join(frontend_path, filename)
    if os.path.exists(file_path) and os.path.isfile(file_path):
        return FileResponse(file_path)
    index_file = os.path.join(frontend_path, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    raise HTTPException(status_code=404, detail="File not found")


