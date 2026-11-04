from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache

from dotenv import load_dotenv


DEFAULT_TENANT_ID = "tenant-gigalis-default"
DEFAULT_DATABASE_URL = "postgresql+psycopg://chorus:chorus@localhost:5432/chorus"


@dataclass(frozen=True, slots=True)
class DatabaseSettings:
    url: str
    pool_size: int
    max_overflow: int
    pool_recycle_seconds: int
    statement_timeout_ms: int
    default_tenant_id: str
    echo_sql: bool


def _as_int(value: str | None, default: int) -> int:
    if value is None or not value.strip():
        return default
    try:
        return int(value)
    except ValueError:
        return default


def _as_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@lru_cache(maxsize=1)
def load_database_settings() -> DatabaseSettings:
    load_dotenv(".env.local", override=False)
    load_dotenv(".env", override=False)

    return DatabaseSettings(
        url=os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL),
        pool_size=_as_int(os.environ.get("DATABASE_POOL_SIZE"), 5),
        max_overflow=_as_int(os.environ.get("DATABASE_MAX_OVERFLOW"), 10),
        pool_recycle_seconds=_as_int(os.environ.get("DATABASE_POOL_RECYCLE_SECONDS"), 1800),
        statement_timeout_ms=_as_int(os.environ.get("DATABASE_STATEMENT_TIMEOUT_MS"), 30000),
        default_tenant_id=os.environ.get("CHORUS_DEFAULT_TENANT_ID", DEFAULT_TENANT_ID),
        echo_sql=_as_bool(os.environ.get("DATABASE_ECHO_SQL"), False),
    )
