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


def list_flux_deposits(
    session: Session,
    *,
    tenant_id: str,
    status_local: Optional[str] = None,
    syntaxe_flux: Optional[str] = None,
    format_flux: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    page: int = 1,
    page_size: int = 50,
) -> Page[ChorusFluxDeposit]:
    """Liste paginée des dépôts de flux d'un tenant (plus récent d'abord).

    Filtres simples sur les colonnes existantes. Le filtre de dates s'applique à
    ``created_at`` (horodatage de persistance fiable), ``date_depot`` étant une
    chaîne libre renvoyée par Chorus.
    """
    page = max(1, page)
    page_size = max(1, min(page_size, 200))

    base = select(ChorusFluxDeposit).where(ChorusFluxDeposit.tenant_id == tenant_id)
    if status_local:
        base = base.where(ChorusFluxDeposit.status_local == status_local)
    if syntaxe_flux:
        base = base.where(ChorusFluxDeposit.syntaxe_flux == syntaxe_flux)
    if format_flux:
        base = base.where(ChorusFluxDeposit.format_flux == format_flux)
    if date_from is not None:
        base = base.where(func.date(ChorusFluxDeposit.created_at) >= date_from)
    if date_to is not None:
        base = base.where(func.date(ChorusFluxDeposit.created_at) <= date_to)

    total = session.scalar(
        select(func.count()).select_from(base.with_only_columns(ChorusFluxDeposit.id).subquery())
    ) or 0

    items = list(
        session.scalars(
            base.order_by(desc(ChorusFluxDeposit.created_at))
            .limit(page_size)
            .offset((page - 1) * page_size)
        )
    )
    return Page(total=total, page=page, page_size=page_size, items=items)


def flux_deposit_stats(
    session: Session,
    *,
    tenant_id: str,
    status_local: Optional[str] = None,
    syntaxe_flux: Optional[str] = None,
    format_flux: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
) -> dict[str, Any]:
    """Agrégats SQL des dépôts de flux (counts par statut/syntaxe/format, bornes de date).

    Retourne des données *brutes* ; la traduction vers les statuts officiels
    ``etatCourantFlux`` est faite côté route (logique pure, testable sans base).
    """

    def _scoped(stmt):
        stmt = stmt.where(ChorusFluxDeposit.tenant_id == tenant_id)
        if status_local:
            stmt = stmt.where(ChorusFluxDeposit.status_local == status_local)
        if syntaxe_flux:
            stmt = stmt.where(ChorusFluxDeposit.syntaxe_flux == syntaxe_flux)
        if format_flux:
            stmt = stmt.where(ChorusFluxDeposit.format_flux == format_flux)
        if date_from is not None:
            stmt = stmt.where(func.date(ChorusFluxDeposit.created_at) >= date_from)
        if date_to is not None:
            stmt = stmt.where(func.date(ChorusFluxDeposit.created_at) <= date_to)
        return stmt

    def _group_counts(column, predicate=None) -> dict[str, int]:
        stmt = _scoped(select(column, func.count()))
        if predicate is not None:
            stmt = stmt.where(predicate)
        rows = session.execute(stmt.group_by(column))
        return {(key or "UNKNOWN"): int(count) for key, count in rows}

    def _count_where(predicate) -> int:
        return int(session.scalar(_scoped(select(func.count()).select_from(ChorusFluxDeposit)).where(predicate)) or 0)

    total = int(session.scalar(_scoped(select(func.count()).select_from(ChorusFluxDeposit))) or 0)
    last_created_at = session.scalar(_scoped(select(func.max(ChorusFluxDeposit.created_at)).select_from(ChorusFluxDeposit)))
    first_created_at = session.scalar(_scoped(select(func.min(ChorusFluxDeposit.created_at)).select_from(ChorusFluxDeposit)))
    last_date_depot = session.scalar(_scoped(select(func.max(ChorusFluxDeposit.date_depot)).select_from(ChorusFluxDeposit)))

    return {
        "total": total,
        "by_status_local": _group_counts(ChorusFluxDeposit.status_local),
        "by_syntaxe_flux": _group_counts(ChorusFluxDeposit.syntaxe_flux),
        "by_format_flux": _group_counts(ChorusFluxDeposit.format_flux),
        # Enrichissement CR (P2-3) : états officiels réels + sous-ensembles pour le repli best-effort.
        "by_etat_courant_flux": _group_counts(
            ChorusFluxDeposit.etat_courant_flux, ChorusFluxDeposit.etat_courant_flux.is_not(None)
        ),
        "by_status_local_no_cr": _group_counts(
            ChorusFluxDeposit.status_local, ChorusFluxDeposit.etat_courant_flux.is_(None)
        ),
        "cr_count": _count_where(ChorusFluxDeposit.etat_courant_flux.is_not(None)),
        "numero_count": _count_where(ChorusFluxDeposit.numero_flux_depot.is_not(None)),
        "last_created_at": last_created_at,
        "first_created_at": first_created_at,
        "last_date_depot": last_date_depot,
    }


def get_flux_deposit(session: Session, *, tenant_id: str, deposit_id: str) -> Optional[ChorusFluxDeposit]:
    """Récupère un dépôt de flux par id (scopé tenant) ou None."""
    return session.scalar(
        select(ChorusFluxDeposit).where(
            ChorusFluxDeposit.tenant_id == tenant_id,
            ChorusFluxDeposit.id == deposit_id,
        )
    )


def list_flux_deposits_needing_cr(
    session: Session, *, tenant_id: str, limit: int = 10
) -> list[ChorusFluxDeposit]:
    """Dépôts candidats à un rafraîchissement CR, les moins récemment vérifiés d'abord."""
    limit = max(1, min(limit, 50))
    stmt = (
        select(ChorusFluxDeposit)
        .where(ChorusFluxDeposit.tenant_id == tenant_id)
        .where(ChorusFluxDeposit.numero_flux_depot.is_not(None))
        .order_by(
            ChorusFluxDeposit.last_cr_checked_at.asc().nulls_first(),
            desc(ChorusFluxDeposit.created_at),
        )
        .limit(limit)
    )
    return list(session.scalars(stmt))


def apply_cr_to_deposit(
    session: Session,
    deposit: ChorusFluxDeposit,
    *,
    etat_courant_flux: Optional[str],
    cr_summary_json: Optional[dict[str, Any]],
    invoice_count: Optional[int],
    error_count: Optional[int],
    cr_available: Optional[bool],
    last_cr_checked_at,
    last_cr_error: Optional[str],
) -> ChorusFluxDeposit:
    """Applique les données de compte rendu à un dépôt (et persiste via flush)."""
    deposit.etat_courant_flux = etat_courant_flux
    deposit.cr_summary_json = cr_summary_json
    deposit.invoice_count = invoice_count
    deposit.error_count = error_count
    deposit.cr_available = cr_available
    deposit.last_cr_checked_at = last_cr_checked_at
    deposit.last_cr_error = last_cr_error
    session.add(deposit)
    session.flush()
    return deposit
