import logging
import os

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from backend.models import Base

load_dotenv()

logger = logging.getLogger("quantveda.db")

# ---------------------------------------------------------------------------
# Database URL resolution
#   - Default: local SQLite (zero setup, current behavior preserved).
#   - Production: set DATABASE_URL to Postgres, e.g.
#       DATABASE_URL=postgresql+psycopg://user:password@host:5432/quantveda
#     (Supabase / Neon free tiers work; just paste the connection string.)
# ---------------------------------------------------------------------------

DEFAULT_SQLITE_URL = "sqlite:///quantveda.db"


def _resolve_database_url() -> str:
    url = (os.getenv("DATABASE_URL") or "").strip() or DEFAULT_SQLITE_URL
    # Heroku-style scheme -> SQLAlchemy + psycopg v3 dialect
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+psycopg://", 1)
    elif url.startswith("postgresql://") and "+psycopg" not in url:
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


DATABASE_URL = _resolve_database_url()
USING_POSTGRES = DATABASE_URL.startswith("postgresql")


def _build_engine():
    if USING_POSTGRES:
        return create_engine(
            DATABASE_URL,
            # prepare_threshold=None: Supavisor (transaction pooling) cannot
            # hold named prepared statements across checkouts.
            connect_args={"connect_timeout": 5, "prepare_threshold": None},
            pool_pre_ping=True,
            pool_size=5,
            max_overflow=10,
            pool_recycle=300,
        )
    return create_engine(DATABASE_URL, connect_args={"check_same_thread": False})


engine = _build_engine()

# If Postgres is configured but unreachable, fall back to SQLite so the
# app never hard-crashes on a bad connection string or sleeping free tier.
if USING_POSTGRES:
    try:
        with engine.connect() as conn:
            conn.exec_driver_sql("SELECT 1")
        logger.info("Connected to Postgres database.")
    except Exception as e:
        logger.warning(f"Postgres unreachable ({e}); falling back to local SQLite.")
        DATABASE_URL = DEFAULT_SQLITE_URL
        USING_POSTGRES = False
        engine = _build_engine()

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def init_db():
    Base.metadata.create_all(bind=engine)
    if USING_POSTGRES:
        return
    try:
        with engine.connect() as conn:

            # Lightweight auto-migration for pre-existing SQLite files
            try:
                u_res = conn.exec_driver_sql("PRAGMA table_info(users);").fetchall()
                u_cols = [r[1] for r in u_res]
                if u_cols and "firebase_uid" not in u_cols:
                    conn.exec_driver_sql("ALTER TABLE users ADD COLUMN firebase_uid VARCHAR(128);")
                    conn.commit()
                if u_cols and "password_hash" not in u_cols:
                    conn.exec_driver_sql("ALTER TABLE users ADD COLUMN password_hash VARCHAR(255);")
                    conn.commit()
            except Exception:
                pass

            tables_to_check = ["paper_wallet", "holdings", "orders", "watchlists", "wishlist_items"]
            for tbl in tables_to_check:
                try:
                    res = conn.exec_driver_sql(f"PRAGMA table_info({tbl});").fetchall()
                    col_names = [r[1] for r in res]
                    if col_names and "user_id" not in col_names:
                        conn.exec_driver_sql(f"ALTER TABLE {tbl} ADD COLUMN user_id INTEGER REFERENCES users(id);")
                        conn.commit()
                except Exception:
                    pass

            # Short / F&O / SL columns for real-world trading in SQLite
            try:
                res = conn.exec_driver_sql("PRAGMA table_info(holdings);").fetchall()
                h_cols = [r[1] for r in res]
                for col, typ in [
                    ("position_type", "VARCHAR(10)"),
                    ("instrument_type", "VARCHAR(10)"),
                    ("strike_price", "REAL"),
                    ("expiry_date", "VARCHAR(30)"),
                    ("stop_loss", "REAL"),
                    ("stop_loss_price", "REAL"),
                    ("target_price", "REAL"),
                    ("margin_blocked", "REAL"),
                ]:
                    if h_cols and col not in h_cols:
                        conn.exec_driver_sql(f"ALTER TABLE holdings ADD COLUMN {col} {typ};")
                        conn.commit()
            except Exception:
                pass

            try:
                res = conn.exec_driver_sql("PRAGMA table_info(orders);").fetchall()
                o_cols = [r[1] for r in res]
                for col, typ in [
                    ("realized_pnl", "REAL"),
                    ("stop_loss_price", "REAL"),
                    ("target_price", "REAL"),
                    ("strike_price", "REAL"),
                    ("expiry_date", "VARCHAR(30)"),
                    ("instrument_type", "VARCHAR(10)"),
                ]:
                    if o_cols and col not in o_cols:
                        conn.exec_driver_sql(f"ALTER TABLE orders ADD COLUMN {col} {typ};")
                        conn.commit()
            except Exception:
                pass
    except Exception as e:
        logger.warning(f"init_db column migration notice: {e}")


_activity_table_ready = False


def ensure_activity_table():
    """Creates activity_logs on older databases (create_all only runs at server startup)."""
    global _activity_table_ready
    if _activity_table_ready:
        return
    try:
        from backend.models import ActivityLog
        ActivityLog.__table__.create(bind=engine, checkfirst=True)
        _activity_table_ready = True
    except Exception:
        pass


def log_activity(db, user_id=None, action="", detail="", symbol=None):
    """Best-effort per-user activity log. Never raises."""
    ensure_activity_table()
    try:
        from backend.models import ActivityLog
        db.add(ActivityLog(user_id=user_id, action=action, detail=detail or "", symbol=symbol))
        db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass


def get_db() -> Session:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def seed_paper_wallet(db, user_id=None):
    from backend.models import PaperWallet
    query = db.query(PaperWallet)
    if user_id is not None:
        query = query.filter(PaperWallet.user_id == user_id)
    else:
        query = query.filter(PaperWallet.user_id.is_(None))

    existing = query.first()
    if existing:
        return existing
    wallet = PaperWallet(user_id=user_id, cash_balance=100000.0, starting_balance=100000.0)
    db.add(wallet)
    db.commit()
    db.refresh(wallet)
    return wallet
