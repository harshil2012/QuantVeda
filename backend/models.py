from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime, Text, JSON, ForeignKey, Enum
)
from sqlalchemy.orm import relationship, declarative_base
from sqlalchemy.dialects.sqlite import REAL

Base = declarative_base()


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, autoincrement=True)
    firebase_uid = Column(String(128), unique=True, nullable=True, index=True)
    email = Column(String(255), unique=True, nullable=True, index=True)
    phone = Column(String(50), unique=True, nullable=True, index=True)
    name = Column(String(100), default="Trader")
    password_hash = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_login = Column(DateTime, default=datetime.utcnow)

    wallets = relationship("PaperWallet", back_populates="user", cascade="all, delete-orphan")
    holdings = relationship("Holding", back_populates="user", cascade="all, delete-orphan")
    orders = relationship("Order", back_populates="user", cascade="all, delete-orphan")
    watchlists = relationship("Watchlist", back_populates="user", cascade="all, delete-orphan")
    wishlists = relationship("WishlistItem", back_populates="user", cascade="all, delete-orphan")


class ActivityLog(Base):
    __tablename__ = "activity_logs"
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    action = Column(String(50), nullable=False, index=True)
    detail = Column(Text, default="")
    symbol = Column(String(20), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class OTPRequest(Base):
    __tablename__ = "otp_requests"
    id = Column(Integer, primary_key=True, autoincrement=True)
    identifier = Column(String(255), nullable=False, index=True)
    channel = Column(String(10), nullable=False)  # 'email' or 'phone'
    otp_hash = Column(String(255), nullable=False)
    expires_at = Column(DateTime, nullable=False)
    attempts = Column(Integer, default=0)
    is_used = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class Watchlist(Base):
    __tablename__ = "watchlists"
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    name = Column(String(100), nullable=False)
    source = Column(String(20), default="manual")
    created_at = Column(DateTime, default=datetime.utcnow)
    items = relationship("WatchlistItem", back_populates="watchlist", cascade="all, delete-orphan")
    user = relationship("User", back_populates="watchlists")


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
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    symbol = Column(String(20), nullable=False)
    name = Column(String(200))
    target_price = Column(REAL)
    note = Column(Text, default="")
    triggered_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    user = relationship("User", back_populates="wishlists")


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
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    cash_balance = Column(REAL, default=100000.0)
    starting_balance = Column(REAL, default=100000.0)
    updated_at = Column(DateTime, default=datetime.utcnow)
    user = relationship("User", back_populates="wallets")


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
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    symbol = Column(String(50), nullable=False)
    qty = Column(REAL, default=0.0)
    avg_buy_price = Column(REAL, default=0.0)
    position_type = Column(String(10), default="LONG")  # "LONG" or "SHORT"
    instrument_type = Column(String(10), default="EQUITY")  # "EQUITY", "CE", "PE"
    strike_price = Column(REAL, nullable=True)
    expiry_date = Column(String(20), nullable=True)
    stop_loss = Column(REAL, nullable=True)
    stop_loss_price = Column(REAL, nullable=True)
    target_price = Column(REAL, nullable=True)
    margin_blocked = Column(REAL, default=0.0)
    updated_at = Column(DateTime, default=datetime.utcnow)
    user = relationship("User", back_populates="holdings")


class Order(Base):
    __tablename__ = "orders"
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    symbol = Column(String(50), nullable=False)
    side = Column(String(10), nullable=False)  # "BUY", "SELL", "SHORT", "COVER"
    order_type = Column(String(15), nullable=False)  # "MARKET", "LIMIT", "SL-M", "SL-LIMIT"
    qty = Column(REAL, nullable=False)
    limit_price = Column(REAL, nullable=True)
    filled_price = Column(REAL, nullable=True)
    stop_loss_price = Column(REAL, nullable=True)
    target_price = Column(REAL, nullable=True)
    instrument_type = Column(String(10), default="EQUITY")  # "EQUITY", "CE", "PE"
    strike_price = Column(REAL, nullable=True)
    expiry_date = Column(String(20), nullable=True)
    realized_pnl = Column(REAL, default=0.0)
    status = Column(String(10), default="PENDING")
    created_at = Column(DateTime, default=datetime.utcnow)
    user = relationship("User", back_populates="orders")


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