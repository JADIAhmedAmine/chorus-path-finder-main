from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy import select

from ..client import ChorusClient
from ..config import load_chorus_settings
from .config import load_database_settings
from .entities import Supplier
from .session import get_session
from .sync import (
    SyncMode,
    load_allowed_supplier_ids,
    sync_invoices_for_supplier,
    sync_suppliers,
)


logger = logging.getLogger(__name__)


def _as_int(value: Optional[str], default: int) -> int:
    if value is None or not value.strip():
        return default
    try:
        return int(value)
    except ValueError:
        return default


def _as_bool(value: Optional[str], default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True, slots=True)
class SchedulerSettings:
    enabled: bool
    startup_full_sync: bool
    interval_seconds: int
    mode: SyncMode
    page_size: int
    sync_suppliers_every_n_runs: int
    environment_override: Optional[str]


def load_scheduler_settings() -> SchedulerSettings:
    raw_mode = (os.environ.get("SYNC_CRON_MODE") or "delta").strip().lower()
    if raw_mode not in ("recent", "delta", "full"):
        raw_mode = "delta"
    return SchedulerSettings(
        enabled=_as_bool(os.environ.get("SYNC_CRON_ENABLED"), False),
        startup_full_sync=_as_bool(os.environ.get("SYNC_STARTUP_FULL_SYNC"), True),
        interval_seconds=max(60, _as_int(os.environ.get("SYNC_CRON_INTERVAL_SECONDS"), 300)),
        mode=raw_mode,  # type: ignore[arg-type]
        page_size=_as_int(os.environ.get("SYNC_CRON_PAGE_SIZE"), 100),
        sync_suppliers_every_n_runs=max(
            1, _as_int(os.environ.get("SYNC_CRON_SUPPLIERS_EVERY_N_RUNS"), 12)
        ),
        environment_override=(os.environ.get("SYNC_CRON_ENVIRONMENT") or None),
    )


_run_counter = 0


def _supplier_ids_for_sync(session, *, tenant_id: str, chorus_settings) -> list[str]:
    """
    Récupère tous les fournisseurs actifs en DB.
    Le default_supplier_id de la config sert uniquement de fallback quand la DB
    n'a encore aucune structure (premier amorçage).
    """
    supplier_ids = [
        str(supplier_id)
        for supplier_id in session.scalars(
            select(Supplier.chorus_supplier_code)
            .where(
                Supplier.tenant_id == tenant_id,
                Supplier.active.is_(True),
                Supplier.chorus_supplier_code.is_not(None),
            )
        )
    ]

    allowed = load_allowed_supplier_ids()
    if allowed is not None:
        supplier_ids = [sid for sid in supplier_ids if sid in allowed]

    if supplier_ids:
        return supplier_ids

    if chorus_settings.default_supplier_id is not None:
        default_str = str(chorus_settings.default_supplier_id)
        if allowed is None or default_str in allowed:
            return [default_str]

    return []


def _run_startup_full_sync() -> None:
    """One-shot dev bootstrap: full Chorus fill when the API process starts."""
    settings = load_scheduler_settings()
    if not settings.startup_full_sync:
        return

    db_settings = load_database_settings()
    tenant_id = db_settings.default_tenant_id
    chorus_settings = load_chorus_settings(environment_override=settings.environment_override)
    client = ChorusClient(chorus_settings)

    logger.info("Startup full sync: démarrage (mode=full)")
    try:
        with get_session() as session:
            try:
                sync_suppliers(
                    session,
                    settings=chorus_settings,
                    client=client,
                    tenant_id=tenant_id,
                    trigger="startup",
                )
            except Exception as error:  # noqa: BLE001
                logger.exception("Startup full sync: sync_suppliers failed: %s", error)

            supplier_ids = _supplier_ids_for_sync(
                session, tenant_id=tenant_id, chorus_settings=chorus_settings
            )

            for supplier_id in supplier_ids:
                try:
                    sync_invoices_for_supplier(
                        session,
                        settings=chorus_settings,
                        client=client,
                        tenant_id=tenant_id,
                        supplier_id=supplier_id,
                        mode="full",
                        page_size=None,
                        trigger="startup",
                    )
                except Exception as error:  # noqa: BLE001
                    logger.exception(
                        "Startup full sync: sync_invoices_for_supplier(%s) failed: %s",
                        supplier_id,
                        error,
                    )
    except Exception as error:  # noqa: BLE001
        logger.exception("Startup full sync failed entirely: %s", error)


def _run_periodic_sync() -> None:
    """Cron tick: refresh suppliers occasionally, then delta-sync every active supplier."""
    global _run_counter
    settings = load_scheduler_settings()
    db_settings = load_database_settings()
    tenant_id = db_settings.default_tenant_id

    chorus_settings = load_chorus_settings(environment_override=settings.environment_override)
    client = ChorusClient(chorus_settings)

    _run_counter += 1
    refresh_suppliers = _run_counter % settings.sync_suppliers_every_n_runs == 1
    logger.info(
        "Cron sync tick #%s (mode=%s, refresh_suppliers=%s)",
        _run_counter,
        settings.mode,
        refresh_suppliers,
    )

    try:
        with get_session() as session:
            if refresh_suppliers:
                try:
                    sync_suppliers(
                        session,
                        settings=chorus_settings,
                        client=client,
                        tenant_id=tenant_id,
                        trigger="cron",
                    )
                except Exception as error:  # noqa: BLE001
                    logger.exception("Cron: sync_suppliers failed: %s", error)

            active_supplier_ids = _supplier_ids_for_sync(
                session, tenant_id=tenant_id, chorus_settings=chorus_settings
            )

            for supplier_id in active_supplier_ids:
                try:
                    sync_invoices_for_supplier(
                        session,
                        settings=chorus_settings,
                        client=client,
                        tenant_id=tenant_id,
                        supplier_id=str(supplier_id),
                        mode=settings.mode,
                        page_size=settings.page_size,
                        trigger="cron",
                    )
                except Exception as error:  # noqa: BLE001
                    logger.exception(
                        "Cron: sync_invoices_for_supplier(%s) failed: %s",
                        supplier_id,
                        error,
                    )
    except Exception as error:  # noqa: BLE001
        logger.exception("Cron tick failed entirely: %s", error)


_scheduler: Optional[BackgroundScheduler] = None


def start_scheduler() -> Optional[BackgroundScheduler]:
    """Start APScheduler for startup/bootstrap sync and optional periodic sync."""
    global _scheduler
    settings = load_scheduler_settings()
    if not settings.enabled and not settings.startup_full_sync:
        logger.info(
            "Synchronisation background désactivée "
            "(SYNC_CRON_ENABLED=false, SYNC_STARTUP_FULL_SYNC=false)."
        )
        return None
    if _scheduler is not None:
        return _scheduler

    scheduler = BackgroundScheduler(timezone="UTC")
    if settings.startup_full_sync:
        scheduler.add_job(
            _run_startup_full_sync,
            trigger="date",
            run_date=datetime.now(timezone.utc),
            id="chorus_startup_full_sync",
            name="Chorus -> DB startup full sync",
            max_instances=1,
            coalesce=True,
        )
    if settings.enabled:
        scheduler.add_job(
            _run_periodic_sync,
            trigger=IntervalTrigger(seconds=settings.interval_seconds),
            id="chorus_sync",
            name="Chorus -> DB periodic sync",
            max_instances=1,
            coalesce=True,
            next_run_time=None,
        )
    scheduler.start()
    if settings.enabled:
        logger.info(
            "Cron sync démarré (mode=%s, interval=%ss, page_size=%s, startup_full=%s)",
            settings.mode,
            settings.interval_seconds,
            settings.page_size,
            settings.startup_full_sync,
        )
    else:
        logger.info("Startup full sync planifié (cron périodique désactivé).")
    _scheduler = scheduler
    return scheduler


def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        try:
            _scheduler.shutdown(wait=False)
        except Exception:  # noqa: BLE001
            logger.exception("Erreur à l'arrêt du scheduler")
        _scheduler = None
