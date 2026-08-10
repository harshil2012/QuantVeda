from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from backend.models import Base

DATABASE_URL = "sqlite:///quantveda.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def init_db():
    Base.metadata.create_all(bind=engine)


def get_db() -> Session:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def seed_paper_wallet(db):
    from backend.models import PaperWallet
    existing = db.query(PaperWallet).first()
    if existing:
        return existing
    wallet = PaperWallet(cash_balance=100000.0, starting_balance=100000.0)
    db.add(wallet)
    db.commit()
    db.refresh(wallet)
    return wallet