from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from .config import DatabaseSettings, load_database_settings


def _build_engine(settings: DatabaseSettings) -> Engine:
    engine = create_engine(
        settings.url,
        pool_size=settings.pool_size,
        max_overflow=settings.max_overflow,
        pool_pre_ping=True,
        pool_recycle=settings.pool_recycle_seconds,
        echo=settings.echo_sql,
        future=True,
    )

    timeout_ms = settings.statement_timeout_ms
    if timeout_ms and settings.url.startswith("postgresql"):
        @event.listens_for(engine, "connect")
        def _set_statement_timeout(dbapi_connection, _connection_record):
            with dbapi_connection.cursor() as cursor:
                cursor.execute(f"SET statement_timeout = {int(timeout_ms)}")

    return engine


_settings = load_database_settings()
engine: Engine = _build_engine(_settings)
SessionLocal: sessionmaker[Session] = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
    future=True,
)


@contextmanager
def get_session() -> Iterator[Session]:
    """Context-manager session with commit/rollback handling."""
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def fastapi_session() -> Iterator[Session]:
    """FastAPI dependency that yields a managed session."""
    with get_session() as session:
        yield session
