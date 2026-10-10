"""Database connection.

The backend talks to Supabase Postgres directly with SQLAlchemy, using the
connection string in DATABASE_URL (server-side only, never sent to the browser).
Each API request gets its own session; the request's changes are committed
together or rolled back together, so a half-saved transaction is impossible.
"""
from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.core.exceptions import ServiceNotConfiguredError


@lru_cache
def get_engine() -> Engine:
    url = get_settings().database_url
    if not url:
        raise ServiceNotConfiguredError(
            "The database is not configured. Set DATABASE_URL in backend/.env.")
    return create_engine(
        url,
        pool_pre_ping=True,       # drop dead connections (poolers close idle ones)
        pool_size=5,
        max_overflow=5,
        pool_recycle=300,
        # Supabase's transaction pooler (port 6543) does not support prepared statements.
        connect_args={"prepare_threshold": None, "connect_timeout": 10},
    )


@lru_cache
def _session_factory() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    """FastAPI dependency: one session per request, committed by the service layer."""
    session = _session_factory()()
    try:
        yield session
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def check_database() -> bool:
    with get_engine().connect() as conn:
        conn.execute(text("select 1"))
    return True
