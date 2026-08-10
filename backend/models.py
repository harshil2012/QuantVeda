from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime, Text, JSON, ForeignKey, Enum
)
from sqlalchemy.orm import relationship, declarative_base
from sqlalchemy.dialects.sqlite import REAL

Base = declarative_base()


class Watchlist(Base):
    __tablename__ = "watchlists"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False, unique=True)
    source = Column(String(20), default="manual")
    created_at = Column(DateTime, default=datetime.utcnow)
    items = relationship("WatchlistItem", back_populates="watchlist", cascade="all, delete-orphan")


class WatchlistItem(Base):
    __tablename__ = "watchlist_items"
    id = Column(Integer, primary_key=True, autoincrement=True)
    watchlist_id = Column(Integer, ForeignKey("watchlists.id"), nullable=False)
    symbol = Column(String(20), nullable=False)
    name = Column(String(200))
    exchange = Column(String(20))
    added_at = Column(DateTime, default=datetime.utcnow)
    watchlist = relationship("Watchlist", back_populates="items")


class WishlistItem(Base):
    __tablename__ = "wishlist_items"
    id = Column(Integer, primary_key=True, autoincrement=True)
    symbol = Column(String(20), nullable=False)
    name = Column(String(200))
    target_price = Column(REAL)
    note = Column(Text, default="")
    triggered_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class ScannerConfig(Base):
    __tablename__ = "scanner_configs"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    universe = Column(String(50), default="NIFTY 50")
    custom_symbols = Column(JSON, default=[])
    rules_json = Column(JSON, nullable=False)
    auto_run_minutes = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)


class ScannerHit(Base):
    __tablename__ = "scanner_hits"
    id = Column(Integer, primary_key=True, autoincrement=True)
    scanner_config_id = Column(Integer, ForeignKey("scanner_configs.id"), nullable=False)
    symbol = Column(String(20), nullable=False)
    matched_at = Column(DateTime, default=datetime.utcnow)
    snapshot_json = Column(JSON)


class UniverseSymbolCache(Base):
    __tablename__ = "universe_symbol_cache"
    symbol = Column(String(20), primary_key=True)
    name = Column(String(200))
    price = Column(REAL)
    change_pct = Column(REAL)
    volume = Column(Integer)
    avg_volume_10d = Column(REAL)
    rsi_14 = Column(REAL)
    sma_20 = Column(REAL)
    ema_20 = Column(REAL)
    updated_at = Column(DateTime, default=datetime.utcnow)


class PaperWallet(Base):
    __tablename__ = "paper_wallet"
    id = Column(Integer, primary_key=True, autoincrement=True)
    cash_balance = Column(REAL, default=100000.0)
    starting_balance = Column(REAL, default=100000.0)
    updated_at = Column(DateTime, default=datetime.utcnow)


class WalletSnapshot(Base):
    __tablename__ = "wallet_snapshots"
    id = Column(Integer, primary_key=True, autoincrement=True)
    snapshot_date = Column(DateTime, default=datetime.utcnow)
    cash_balance = Column(REAL)
    holdings_value = Column(REAL)
    total_value = Column(REAL)


class Holding(Base):
    __tablename__ = "holdings"
    id = Column(Integer, primary_key=True, autoincrement=True)
    symbol = Column(String(20), unique=True, nullable=False)
    qty = Column(REAL, default=0.0)
    avg_buy_price = Column(REAL, default=0.0)
    updated_at = Column(DateTime, default=datetime.utcnow)


class Order(Base):
    __tablename__ = "orders"
    id = Column(Integer, primary_key=True, autoincrement=True)
    symbol = Column(String(20), nullable=False)
    side = Column(String(4), nullable=False)
    order_type = Column(String(10), nullable=False)
    qty = Column(REAL, nullable=False)
    limit_price = Column(REAL, nullable=True)
    status = Column(String(10), default="PENDING")
    filled_price = Column(REAL, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class PredictionLog(Base):
    __tablename__ = "prediction_logs"
    id = Column(Integer, primary_key=True, autoincrement=True)
    symbol = Column(String(20), nullable=False)
    predicted_target = Column(REAL, nullable=False)
    horizon_days = Column(Integer, default=5)
    confidence_score = Column(REAL, default=75.0)
    status = Column(String(20), default="PENDING")
    actual_price = Column(REAL, nullable=True)
    error_pct = Column(REAL, nullable=True)
    is_direction_correct = Column(Boolean, nullable=True)
    predicted_at = Column(DateTime, default=datetime.utcnow)
    resolved_at = Column(DateTime, nullable=True)