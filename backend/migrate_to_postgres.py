"""
One-shot SQLite -> Postgres data migration for QuantVeda.

Usage (PowerShell, from project root):
    $env:TARGET_DATABASE_URL = "postgresql+psycopg://user:pass@host:5432/quantveda"
    python -m backend.migrate_to_postgres

Optional:
    $env:SOURCE_SQLITE = "quantveda.db"   # default
    $env:DRY_RUN = "1"                    # count rows only, copy nothing

The script creates all tables on the target (Base.metadata.create_all),
copies every row preserving primary keys, then resets Postgres sequences
so new inserts continue after the migrated ids.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

load_dotenv()

from backend.models import Base  # noqa: E402


TABLE_ORDER = [
    "users",
    "otp_requests",
    "watchlists",
    "watchlist_items",
    "wishlist_items",
    "scanner_configs",
    "scanner_hits",
    "universe_symbol_cache",
    "paper_wallet",
    "wallet_snapshots",
    "holdings",
    "orders",
    "prediction_logs",
    "activity_logs",
]

CHUNK = 500


def normalize_pg_url(url: str) -> str:
    url = (url or "").strip()
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+psycopg://", 1)
    elif url.startswith("postgresql://") and "+psycopg" not in url:
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


def main() -> int:
    source_path = os.getenv("SOURCE_SQLITE", "quantveda.db")
    target_url = normalize_pg_url(os.getenv("TARGET_DATABASE_URL") or os.getenv("DATABASE_URL") or "")
    dry_run = os.getenv("DRY_RUN") == "1"

    if not os.path.exists(source_path):
        print(f"ERROR: source SQLite file not found: {source_path}")
        return 1
    if not target_url.startswith("postgresql"):
        print("ERROR: TARGET_DATABASE_URL must be a Postgres URL.")
        print("  Example: postgresql+psycopg://user:pass@host:5432/quantveda")
        return 1

    src_engine = create_engine(f"sqlite:///{source_path}")
    tgt_engine = create_engine(target_url, pool_pre_ping=True)

    # Connectivity check first (fail fast, copy nothing half-done).
    try:
        with tgt_engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as e:
        print(f"ERROR: cannot reach Postgres target: {e}")
        return 1

    print(f"Source : {source_path}")
    print(f"Target : {target_url.split('@')[-1]}")
    print(f"Tables : {', '.join(TABLE_ORDER)}")
    if dry_run:
        print("DRY RUN - counting rows only.\n")

    if not dry_run:
        Base.metadata.create_all(bind=tgt_engine)

    SrcSession = sessionmaker(bind=src_engine)
    TgtSession = sessionmaker(bind=tgt_engine)
    src = SrcSession()
    tgt = TgtSession()

    total = 0
    try:
        for table_name in TABLE_ORDER:
            table = Base.metadata.tables.get(table_name)
            if table is None:
                print(f"  [skip] {table_name}: not in models")
                continue
            try:
                rows = src.execute(table.select()).mappings().all()
            except Exception as e:
                print(f"  [skip] {table_name}: cannot read source ({e})")
                continue
            print(f"  {table_name}: {len(rows)} rows")
            if dry_run or not rows:
                continue
            for i in range(0, len(rows), CHUNK):
                tgt.execute(table.insert(), [dict(r) for r in rows[i : i + CHUNK]])
            total += len(rows)
        if not dry_run:
            tgt.commit()
            # Reset serial sequences past migrated ids.
            for table_name in TABLE_ORDER:
                table = Base.metadata.tables.get(table_name)
                if table is None or "id" not in table.c:
                    continue
                try:
                    tgt.execute(
                        text(
                            "SELECT setval(pg_get_serial_sequence(:t, 'id'), "
                            "COALESCE((SELECT MAX(id) FROM " + table_name + "), 1))"
                        ),
                        {"t": table_name},
                    )
                except Exception:
                    pass
            tgt.commit()
    except Exception as e:
        tgt.rollback()
        print(f"ERROR during copy: {e}")
        return 1
    finally:
        src.close()
        tgt.close()

    print(f"\nDone. {total} rows copied." if not dry_run else "\nDry run complete.")
    if not dry_run:
        print("Next: set DATABASE_URL in .env to the Postgres URL and restart the server.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
