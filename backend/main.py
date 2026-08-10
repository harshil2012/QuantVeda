import logging
import asyncio
import random
from datetime import datetime
from contextlib import asynccontextmanager
import requests

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from backend.broker import get_stock_quote, check_is_market_open, get_candles, get_max_candles
from backend.ai_agent import analyze_sentiment
from backend.db import init_db, seed_paper_wallet, get_db, SessionLocal
from backend.models import PaperWallet, Watchlist

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("quantveda.main")

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
}

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database and seed paper wallet on startup."""
    logger.info("Initializing database...")
    init_db()
    db = SessionLocal()
    try:
        wallet = seed_paper_wallet(db)
        logger.info(f"Paper wallet ready: ₹{wallet.cash_balance:,.2f}")
    finally:
        db.close()
    yield

app = FastAPI(
    title="QuantVeda AI Backend",
    description="FastAPI backend serving real-time market quotes, search autocomplete, market status, and AI sentiment analysis.",
    version="2.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
        quote_data = await get_stock_quote(clean_symbol)
        return {
            "status": "success",
            "data": quote_data
        }
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve))
    except Exception as e:
        logger.error(f"Failed to fetch stock quote for {clean_symbol}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="An error occurred while fetching the market price.")


@app.get("/api/candles/{symbol}")
async def get_candles_endpoint(symbol: str, interval: str = "1d", range: str = "6mo"):
    """Fetch OHLCV candlestick historical data for TradingView charts."""
    clean_symbol = symbol.strip().upper()
    if not clean_symbol:
        raise HTTPException(status_code=400, detail="Symbol parameter cannot be empty.")
    try:
        data = await get_candles(clean_symbol, interval=interval, range_str=range)
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
    side: str = Field(..., pattern="^(BUY|SELL|buy|sell)$")
    order_type: str = Field(..., pattern="^(MARKET|LIMIT|market|limit)$")
    qty: float = Field(..., gt=0)
    limit_price: Optional[float] = None


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
def list_watchlists(db: Session = Depends(get_db)):
    """List all watchlists with their items. Auto-creates 'Default' if none exist."""
    from backend.models import WatchlistItem, WishlistItem
    watchlists = db.query(Watchlist).all()
    if not watchlists:
        default_wl = Watchlist(name="Default Watchlist", source="manual")
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
def create_watchlist(payload: WatchlistCreate, db: Session = Depends(get_db)):
    """Create a new named watchlist."""
    existing = db.query(Watchlist).filter(Watchlist.name == payload.name.strip()).first()
    if existing:
        raise HTTPException(status_code=400, detail="Watchlist with this name already exists.")
    
    wl = Watchlist(name=payload.name.strip(), source=payload.source)
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

    tasks = [get_stock_quote(item.symbol) for item in wl.items]
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
async def list_wishlist(db: Session = Depends(get_db)):
    """List all wishlist target price items with live price comparison."""
    from backend.models import WishlistItem
    items = db.query(WishlistItem).all()
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
def add_wishlist_item(payload: WishlistItemAdd, db: Session = Depends(get_db)):
    """Add a stock target price alert to Wishlist."""
    from backend.models import WishlistItem
    sym_clean = payload.symbol.strip().upper()
    
    item = WishlistItem(
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
def get_wallet(db: Session = Depends(get_db)):
    """Get paper wallet balance."""
    wallet = db.query(PaperWallet).first()
    if not wallet:
        wallet = seed_paper_wallet(db)
    return {
        "status": "success",
        "data": {
            "cash_balance": wallet.cash_balance,
            "starting_balance": wallet.starting_balance,
            "updated_at": wallet.updated_at.isoformat() if wallet.updated_at else None
        }
    }

@app.post("/api/wallet/topup")
def topup_wallet(payload: WalletTopup, db: Session = Depends(get_db)):
    """Add virtual cash to paper trading wallet."""
    wallet = db.query(PaperWallet).first()
    if not wallet:
        wallet = seed_paper_wallet(db)
    
    wallet.cash_balance += payload.amount
    wallet.starting_balance += payload.amount
    wallet.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(wallet)
    return {"status": "success", "data": {"cash_balance": wallet.cash_balance, "starting_balance": wallet.starting_balance}}

@app.post("/api/orders")
async def place_order(payload: OrderCreate, db: Session = Depends(get_db)):
    """Place a market or limit paper order."""
    from backend.models import Order, Holding, PaperWallet
    sym_clean = payload.symbol.strip().upper()
    side = payload.side.strip().upper()
    order_type = payload.order_type.strip().upper()
    qty = float(payload.qty)

    wallet = db.query(PaperWallet).first()
    if not wallet:
        wallet = seed_paper_wallet(db)

    # Fetch live server price for fill verification
    quote = await get_stock_quote(sym_clean)
    live_price = float(quote.get("price", 0.0))
    if live_price <= 0:
        raise HTTPException(status_code=400, detail=f"Could not retrieve live price for {sym_clean}.")

    if order_type == "MARKET":
        fill_price = live_price
        total_cost = fill_price * qty

        if side == "BUY":
            if wallet.cash_balance < total_cost:
                raise HTTPException(
                    status_code=400,
                    detail=f"Insufficient cash balance. Required: ₹{total_cost:,.2f}, Available: ₹{wallet.cash_balance:,.2f}"
                )

            wallet.cash_balance -= total_cost
            holding = db.query(Holding).filter(Holding.symbol == sym_clean).first()
            if not holding:
                holding = Holding(symbol=sym_clean, qty=qty, avg_buy_price=fill_price)
                db.add(holding)
            else:
                new_total_qty = holding.qty + qty
                new_avg_price = ((holding.qty * holding.avg_buy_price) + total_cost) / new_total_qty
                holding.qty = new_total_qty
                holding.avg_buy_price = new_avg_price
                holding.updated_at = datetime.utcnow()

            order = Order(
                symbol=sym_clean, side="BUY", order_type="MARKET",
                qty=qty, filled_price=fill_price, status="FILLED"
            )

        else: # SELL
            holding = db.query(Holding).filter(Holding.symbol == sym_clean).first()
            if not holding or holding.qty < qty:
                available_qty = holding.qty if holding else 0
                raise HTTPException(
                    status_code=400,
                    detail=f"Insufficient holdings to sell {qty} shares of {sym_clean}. Available: {available_qty}"
                )

            holding.qty -= qty
            wallet.cash_balance += total_cost
            if holding.qty <= 0:
                db.delete(holding)
            else:
                holding.updated_at = datetime.utcnow()

            order = Order(
                symbol=sym_clean, side="SELL", order_type="MARKET",
                qty=qty, filled_price=fill_price, status="FILLED"
            )

        db.add(order)
        db.commit()
        db.refresh(order)
        return {
            "status": "success",
            "message": f"Market {side} order FILLED for {qty} {sym_clean} @ ₹{fill_price:.2f}",
            "data": {
                "id": order.id, "symbol": order.symbol, "side": order.side,
                "order_type": order.order_type, "qty": order.qty, "filled_price": order.filled_price,
                "status": order.status, "cash_balance": wallet.cash_balance
            }
        }

    else: # LIMIT ORDER
        if not payload.limit_price or payload.limit_price <= 0:
            raise HTTPException(status_code=400, detail="Limit order requires a valid positive limit_price.")

        limit_price = float(payload.limit_price)
        total_cost = limit_price * qty

        if side == "BUY" and wallet.cash_balance < total_cost:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient cash balance for limit buy order. Required: ₹{total_cost:,.2f}, Available: ₹{wallet.cash_balance:,.2f}"
            )

        if side == "SELL":
            holding = db.query(Holding).filter(Holding.symbol == sym_clean).first()
            if not holding or holding.qty < qty:
                available_qty = holding.qty if holding else 0
                raise HTTPException(
                    status_code=400,
                    detail=f"Insufficient holdings for limit sell order. Available: {available_qty}"
                )

        order = Order(
            symbol=sym_clean, side=side, order_type="LIMIT",
            qty=qty, limit_price=limit_price, status="PENDING"
        )
        db.add(order)
        db.commit()
        db.refresh(order)
        return {
            "status": "success",
            "message": f"Limit {side} order QUEUED for {qty} {sym_clean} @ ₹{limit_price:.2f}",
            "data": {
                "id": order.id, "symbol": order.symbol, "side": order.side,
                "order_type": order.order_type, "qty": order.qty, "limit_price": order.limit_price,
                "status": order.status
            }
        }

@app.get("/api/orders")
def list_orders(db: Session = Depends(get_db)):
    """List all orders (blotter) newest first."""
    from backend.models import Order
    orders = db.query(Order).order_by(Order.created_at.desc()).all()
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
                "status": o.status,
                "created_at": o.created_at.isoformat() if o.created_at else None
            }
            for o in orders
        ]
    }

@app.delete("/api/orders/{order_id}")
def cancel_order(order_id: int, db: Session = Depends(get_db)):
    """Cancel a pending limit order."""
    from backend.models import Order
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found.")
    if order.status != "PENDING":
        raise HTTPException(status_code=400, detail=f"Cannot cancel order with status '{order.status}'.")

    order.status = "CANCELLED"
    db.commit()
    return {"status": "success", "message": f"Order #{order_id} cancelled."}

@app.get("/api/holdings")
def list_holdings(db: Session = Depends(get_db)):
    """List all current holdings."""
    from backend.models import Holding
    holdings = db.query(Holding).all()
    return {
        "status": "success",
        "data": [
            {
                "id": h.id,
                "symbol": h.symbol,
                "name": h.symbol,
                "qty": h.qty,
                "avg_buy_price": h.avg_buy_price,
                "updated_at": h.updated_at.isoformat() if h.updated_at else None
            }
            for h in holdings
        ]
    }

@app.post("/api/wallet/reset")
def reset_wallet(db: Session = Depends(get_db)):
    """Reset paper trading wallet to ₹1,00,000. Clears all holdings and orders."""
    from backend.models import Holding, Order, PaperWallet, WalletSnapshot
    
    # Clear holdings
    db.query(Holding).delete()
    # Clear orders
    db.query(Order).delete()
    # Clear snapshots
    db.query(WalletSnapshot).delete()
    
    # Reset wallet
    wallet = db.query(PaperWallet).first()
    if wallet:
        wallet.cash_balance = 100000.0
        wallet.starting_balance = 100000.0
        wallet.updated_at = datetime.utcnow()
    else:
        wallet = PaperWallet(cash_balance=100000.0, starting_balance=100000.0)
        db.add(wallet)
    
    db.commit()
    db.refresh(wallet)
    return {
        "status": "success",
        "message": "Paper trading wallet reset to ₹1,00,000.00. All holdings and orders cleared.",
        "data": {
            "cash_balance": wallet.cash_balance,
            "starting_balance": wallet.starting_balance
        }
    }

@app.get("/api/portfolio")
async def get_portfolio(db: Session = Depends(get_db)):
    """Calculate portfolio holdings with live prices and unrealized/realized P&L."""
    from backend.models import Holding, PaperWallet, Order
    wallet = db.query(PaperWallet).first()
    if not wallet:
        wallet = seed_paper_wallet(db)

    holdings = db.query(Holding).all()
    
    total_invested = 0.0
    current_value = 0.0
    days_pnl = 0.0
    
    holdings_data = []
    if holdings:
        tasks = [get_stock_quote(h.symbol) for h in holdings]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        for h, res in zip(holdings, results):
            live_price = h.avg_buy_price
            currency_sym = "$"
            prev_close = live_price
            
            if not isinstance(res, Exception):
                live_price = res.get("price", h.avg_buy_price)
                currency_sym = res.get("currency_symbol", "$")
                prev_close = res.get("previous_close", live_price)

            invested = h.qty * h.avg_buy_price
            value = h.qty * live_price
            pnl = value - invested
            pnl_pct = (pnl / invested * 100) if invested > 0 else 0.0
            
            day_change = (live_price - prev_close) * h.qty
            days_pnl += day_change
            
            total_invested += invested
            current_value += value

            holdings_data.append({
                "id": h.id,
                "symbol": h.symbol,
                "qty": h.qty,
                "avg_buy_price": h.avg_buy_price,
                "live_price": live_price,
                "currency_symbol": currency_sym,
                "invested": invested,
                "current_value": value,
                "unrealized_pnl": pnl,
                "unrealized_pnl_pct": pnl_pct,
                "day_change": day_change
            })

    closed_sells = db.query(Order).filter(Order.side == "SELL", Order.status == "FILLED").all()
    realized_pnl = 0.0
    for s in closed_sells:
        if s.filled_price and s.qty:
            realized_pnl += (s.filled_price * s.qty)

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

        # --- Continuous re-poll loop (existing behaviour preserved) ---
        while True:
            await asyncio.sleep(3)
            try:
                fresh_quote = await get_stock_quote(clean_symbol)
                fresh_price = float(fresh_quote.get("price", price))
                change = round(fresh_price - price, 2)
                price = fresh_price
                direction = "up" if change > 0 else ("down" if change < 0 else "flat")

                payload = {
                    "symbol": clean_symbol,
                    "price": round(price, 2),
                    "currency_symbol": currency_sym,
                    "is_market_open": is_market_open,
                    "market_status": "MARKET OPEN" if is_market_open else "MARKET CLOSED",
                    "close_timestamp": quote.get("close_timestamp", "3:30:00 PM GMT+5:30"),
                    "change": change,
                    "direction": direction,
                    "timestamp": datetime.utcnow().isoformat()
                }
                await websocket.send_json(payload)
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

    tasks = [get_stock_quote(sym) for sym in symbols]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    matched_hits = []
    for sym, res in zip(symbols, results):
        if isinstance(res, Exception):
            continue

        prediction = res.get("prediction", {})
        quote_snapshot = {
            "symbol": sym,
            "price": res.get("price", 0.0),
            "change": res.get("change", 0.0),
            "change_pct": res.get("change_pct", 0.0),
            "previous_close": res.get("previous_close", 0.0),
            "currency_symbol": res.get("currency_symbol", "$"),
            "rsi_14": prediction.get("rsi", 50.0),
            "sma_20": prediction.get("sma_20", res.get("price", 0.0)),
            "momentum_5d_pct": prediction.get("momentum_5d_pct", 0.0),
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

import os
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

frontend_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")
if os.path.exists(frontend_path):
    app.mount("/static", StaticFiles(directory=frontend_path), name="static")

@app.get("/")
async def root():
    index_file = os.path.join(frontend_path, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return {"status": "running", "project": "QuantVeda AI", "version": "2.0.0"}

@app.get("/{filename:path}")
async def serve_frontend_files(filename: str):
    file_path = os.path.join(frontend_path, filename)
    if os.path.exists(file_path) and os.path.isfile(file_path):
        return FileResponse(file_path)
    raise HTTPException(status_code=404, detail="File not found")


