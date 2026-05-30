from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Optional
from uuid import uuid4

from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session, selectinload

from .entities import (
    ChorusFluxDeposit,
    Invoice,
    InvoiceLine,
    PublicCustomer,
    PublicService,
    Supplier,
    SyncRun,
)


@dataclass(slots=True)
class Page[T]:
    total: int
    page: int
    page_size: int
    items: list[T]


def list_suppliers(
    session: Session,
    *,
    tenant_id: str,
    active_only: bool = True,
    page: int = 1,
    page_size: int = 100,
) -> Page[Supplier]:
    page = max(1, page)
    page_size = max(1, min(page_size, 500))
    base = select(Supplier).where(Supplier.tenant_id == tenant_id)
    if active_only:
        base = base.where(Supplier.active.is_(True))

    total = session.scalar(
        select(func.count()).select_from(base.subquery())
    ) or 0

    items = list(
        session.scalars(
            base.order_by(Supplier.legal_name)
            .limit(page_size)
            .offset((page - 1) * page_size)
        )
    )
    return Page(total=total, page=page, page_size=page_size, items=items)


def list_public_customers(
    session: Session, *, tenant_id: str, active_only: bool = True
) -> list[PublicCustomer]:
    stmt = select(PublicCustomer).where(PublicCustomer.tenant_id == tenant_id)
    if active_only:
        stmt = stmt.where(PublicCustomer.active.is_(True))
    return list(session.scalars(stmt.order_by(PublicCustomer.legal_name)))


def list_public_services(
    session: Session, *, tenant_id: str, public_customer_id: Optional[str] = None
) -> list[PublicService]:
    stmt = select(PublicService).where(PublicService.tenant_id == tenant_id)
    if public_customer_id:
        stmt = stmt.where(PublicService.public_customer_id == public_customer_id)
    return list(session.scalars(stmt.order_by(PublicService.label)))


def list_invoices(
    session: Session,
    *,
    tenant_id: str,
    supplier_id: Optional[str] = None,
    public_customer_id: Optional[str] = None,
    status_internal: Optional[str] = None,
    status_chorus: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
) -> Page[Invoice]:
    page = max(1, page)
    page_size = max(1, min(page_size, 500))

    base = (
        select(Invoice)
        .join(Supplier, Invoice.supplier_id == Supplier.id)
        .where(Invoice.tenant_id == tenant_id)
        .where(Supplier.active.is_(True))
        .options(selectinload(Invoice.lines))
    )
    if supplier_id:
        base = base.where(Invoice.supplier_id == supplier_id)
    if public_customer_id:
        base = base.where(Invoice.public_customer_id == public_customer_id)
    if status_internal:
        base = base.where(Invoice.status_internal == status_internal)
    if status_chorus:
        base = base.where(Invoice.status_chorus == status_chorus)

    total = session.scalar(
        select(func.count()).select_from(base.with_only_columns(Invoice.id).subquery())
    ) or 0

    items = list(
        session.scalars(
            base.order_by(desc(Invoice.invoice_date), desc(Invoice.created_at))
            .limit(page_size)
            .offset((page - 1) * page_size)
        )
    )
    return Page(total=total, page=page, page_size=page_size, items=items)


def list_invoices_for_dashboard(
    session: Session,
    *,
    tenant_id: str,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    max_rows: int = 5000,
) -> list[Invoice]:
    """Charge toutes les factures actives du tenant pour le calcul des KPI.

    Filtre par `invoice_date` (facultatif) et garde un plafond `max_rows`
    pour ne pas exploser la RAM sur de très gros volumes ; au-delà la
    synthèse devra basculer sur des requêtes d'agrégation côté SQL.
    """
    base = (
        select(Invoice)
        .join(Supplier, Invoice.supplier_id == Supplier.id)
        .where(Invoice.tenant_id == tenant_id)
        .where(Supplier.active.is_(True))
    )
    if from_date is not None:
        base = base.where(Invoice.invoice_date >= from_date)
    if to_date is not None:
        base = base.where(Invoice.invoice_date <= to_date)
    return list(
        session.scalars(
            base.order_by(desc(Invoice.invoice_date), desc(Invoice.created_at)).limit(max_rows)
        )
    )


def get_invoice(session: Session, *, invoice_id: str) -> Optional[Invoice]:
    return session.scalar(
        select(Invoice)
        .where(Invoice.id == invoice_id)
        .options(selectinload(Invoice.lines))
    )


def list_invoice_lines(session: Session, *, invoice_id: str) -> list[InvoiceLine]:
    stmt = (
        select(InvoiceLine)
        .where(InvoiceLine.invoice_id == invoice_id)
        .order_by(InvoiceLine.line_number)
    )
    return list(session.scalars(stmt))


def list_recent_sync_runs(
    session: Session,
    *,
    tenant_id: str,
    entity: Optional[str] = None,
    limit: int = 25,
) -> list[SyncRun]:
    stmt = (
        select(SyncRun)
        .where(SyncRun.tenant_id == tenant_id)
        .order_by(desc(SyncRun.started_at))
        .limit(max(1, min(limit, 200)))
    )
    if entity:
        stmt = stmt.where(SyncRun.entity == entity)
    return list(session.scalars(stmt))


def _truncate(value: Optional[str], max_length: int) -> Optional[str]:
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    if not trimmed:
        return None
    return trimmed[:max_length]


def record_flux_deposit(
    session: Session,
    *,
    tenant_id: str,
    nom_fichier: str,
    format_flux: str,
    syntaxe_flux: str,
    avec_signature: bool,
    id_utilisateur_courant: int,
    status_local: str,
    file_sha256: Optional[str] = None,
    file_size: Optional[int] = None,
    detected_file_type: Optional[str] = None,
    root_element: Optional[str] = None,
    namespace: Optional[str] = None,
    http_status: Optional[int] = None,
    code_retour: Optional[int] = None,
    libelle: Optional[str] = None,
    date_depot: Optional[str] = None,
    numero_flux_depot: Optional[str] = None,
    raw_response: Any = None,
) -> ChorusFluxDeposit:
    """Persiste une trace de dépôt de flux Chorus Pro (métadonnées only, sans contenu)."""
    if isinstance(raw_response, dict):
        normalized_raw: Optional[dict[str, Any]] = raw_response
    elif raw_response is None:
        normalized_raw = None
    else:
        normalized_raw = {"raw": raw_response}

    deposit = ChorusFluxDeposit(
        id=str(uuid4()),
        tenant_id=tenant_id,
        nom_fichier=(_truncate(nom_fichier, 255) or ""),
        file_sha256=_truncate(file_sha256, 64),
        file_size=(int(file_size) if isinstance(file_size, int) else None),
        format_flux=(_truncate(format_flux, 64) or ""),
        syntaxe_flux=(_truncate(syntaxe_flux, 64) or ""),
        detected_file_type=_truncate(detected_file_type, 64),
        root_element=_truncate(root_element, 128),
        namespace=_truncate(namespace, 512),
        avec_signature=bool(avec_signature),
        id_utilisateur_courant=int(id_utilisateur_courant),
        status_local=(_truncate(status_local, 32) or "ERROR"),
        http_status=http_status,
        code_retour=code_retour,
        libelle=libelle,
        date_depot=_truncate(date_depot, 32),
        numero_flux_depot=_truncate(numero_flux_depot, 128),
        raw_response=normalized_raw,
    )
    session.add(deposit)
    session.flush()
    return deposit
