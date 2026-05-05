from __future__ import annotations

import hashlib
import logging
import os
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Literal, Optional

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from ..client import ChorusApiError, ChorusClient
from ..config import ChorusSettings, load_chorus_settings
from .entities import Invoice, PublicCustomer, PublicService, Supplier, SyncRun, Tenant


CHORUS_EMPTY_RESULT_CODES = {"20002"}


SyncMode = Literal["recent", "delta", "full"]
DEFAULT_RECENT_PAGE_SIZE = 100
DEFAULT_FULL_PAGE_SIZE = 2000
DELTA_SAFETY_MARGIN = timedelta(hours=24)


logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Coercion helpers (Chorus payloads are loosely typed)
# ---------------------------------------------------------------------------


def _first_present(payload: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in payload and payload[key] not in (None, ""):
            return payload[key]
    return None


def _as_str(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    return None


def _as_decimal(value: Any) -> Optional[Decimal]:
    if value is None or value == "":
        return None
    try:
        if isinstance(value, str):
            value = value.replace(" ", "").replace(" ", "").replace(",", ".")
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


def _as_bool(value: Any, default: bool = True) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "oui", "yes", "actif", "active"}:
            return True
        if normalized in {"false", "0", "non", "no", "inactif", "inactive"}:
            return False
    return default


def _as_date(value: Any):
    text = _as_str(value)
    if not text:
        return None
    text = text[:10]
    try:
        return datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError:
        return None


def _as_datetime(value: Any) -> Optional[datetime]:
    text = _as_str(value)
    if not text:
        return None
    try:
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def _advisory_lock_key(*parts: str) -> int:
    digest = hashlib.blake2b("::".join(parts).encode("utf-8"), digest_size=8).digest()
    return int.from_bytes(digest, "big", signed=True)


def _try_advisory_xact_lock(session: Session, *parts: str) -> bool:
    bind = session.get_bind()
    if bind.dialect.name != "postgresql":
        return True
    key = _advisory_lock_key(*parts)
    return bool(session.scalar(select(func.pg_try_advisory_xact_lock(key))))


# ---------------------------------------------------------------------------
# Tenant bootstrap (single-tenant default)
# ---------------------------------------------------------------------------


def ensure_tenant(session: Session, tenant_id: str, *, name: str = "Default tenant") -> Tenant:
    tenant = session.scalar(select(Tenant).where(Tenant.id == tenant_id))
    if tenant is not None:
        return tenant

    tenant = Tenant(id=tenant_id, code=tenant_id, name=name, active=True)
    session.add(tenant)
    session.flush()
    return tenant


# ---------------------------------------------------------------------------
# Sync run audit context manager
# ---------------------------------------------------------------------------


class SyncRunContext:
    def __init__(
        self,
        session: Session,
        *,
        tenant_id: str,
        entity: str,
        trigger: str,
        chorus_environment: Optional[str],
        payload_summary: Optional[dict[str, Any]] = None,
    ) -> None:
        self.session = session
        self.run = SyncRun(
            id=str(uuid.uuid4()),
            tenant_id=tenant_id,
            entity=entity,
            trigger=trigger,
            status="running",
            chorus_environment=chorus_environment,
            payload_summary=payload_summary,
        )

    def __enter__(self) -> SyncRun:
        self.session.add(self.run)
        self.session.flush()
        return self.run

    def __exit__(self, exc_type, exc, _tb) -> None:
        self.run.finished_at = datetime.now(timezone.utc)
        if exc is None:
            if self.run.rows_failed > 0 and self.run.rows_upserted == 0:
                self.run.status = "failed"
            elif self.run.rows_failed > 0:
                self.run.status = "partial"
            else:
                self.run.status = "success"
        else:
            self.run.status = "failed"
            self.run.error_message = str(exc)[:5000]
        self.session.flush()


# ---------------------------------------------------------------------------
# Suppliers (active recipient structures)
# ---------------------------------------------------------------------------


def _structure_items(response: Any) -> list[dict[str, Any]]:
    if not isinstance(response, dict):
        return []
    for key in (
        "listeStructures",
        "structures",
        "listeStructure",
        "resultats",
        "results",
        "items",
        "data",
    ):
        value = response.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    return []


def _supplier_id_from(structure: dict[str, Any]) -> Optional[str]:
    raw = _first_present(
        structure,
        "idStructureCPP",
        "idStructure",
        "idFournisseur",
        "idDestinataireCPP",
        "idDestinataire",
    )
    return _as_str(raw)


def _supplier_legal_name(structure: dict[str, Any]) -> str:
    name = _as_str(
        _first_present(
            structure,
            "raisonSociale",
            "raisonSocialeStructure",
            "designation",
            "designationStructure",
            "libelle",
        )
    )
    if name:
        return name
    siret = _as_str(_first_present(structure, "siretStructure", "siret"))
    return f"Structure {siret}" if siret else "Structure inconnue"


def _summarize_chorus_response(response: Any) -> dict[str, Any]:
    """Compact view of a Chorus response, for storage in sync_runs.payload_summary."""
    if not isinstance(response, dict):
        return {}

    summary: dict[str, Any] = {}
    for key in ("codeRetour", "libelle"):
        value = response.get(key)
        if value is not None:
            summary[key] = value

    parametres_retour = response.get("parametresRetour")
    if isinstance(parametres_retour, dict):
        for key in ("total", "pageEnCours", "nombreResultats"):
            value = parametres_retour.get(key)
            if value is not None:
                summary[key] = value

    return summary


def load_allowed_supplier_ids() -> Optional[set[str]]:
    """
    Whitelist of Chorus supplier ids (`idStructureCPP`) à synchroniser.
    Lue depuis `CHORUS_ALLOWED_SUPPLIER_IDS` (CSV). None = pas de filtre.
    """
    raw = os.environ.get("CHORUS_ALLOWED_SUPPLIER_IDS", "").strip()
    if not raw:
        return None
    ids = {chunk.strip() for chunk in raw.split(",") if chunk.strip()}
    return ids or None


def _infer_environment(settings: ChorusSettings) -> Optional[str]:
    base_url = (settings.base_url or "").lower()
    if "sandbox" in base_url:
        return "sandbox"
    if "api.piste.gouv.fr" in base_url:
        return "production"
    return None


def sync_suppliers(
    session: Session,
    *,
    settings: ChorusSettings,
    client: Optional[ChorusClient] = None,
    tenant_id: str,
    trigger: str = "manual",
) -> SyncRun:
    """Fetch active supplier structures from Chorus and upsert them as suppliers."""
    ensure_tenant(session, tenant_id)
    chorus_client = client or ChorusClient(settings)

    with SyncRunContext(
        session,
        tenant_id=tenant_id,
        entity="suppliers",
        trigger=trigger,
        chorus_environment=_infer_environment(settings),
    ) as run:
        structures = chorus_client.fetch_active_supplier_structures()
        run.rows_fetched = len(structures)

        now = datetime.now(timezone.utc)
        allowed_ids = load_allowed_supplier_ids()
        seen_supplier_ids: set[str] = set()
        for structure in structures:
            supplier_id = _supplier_id_from(structure)
            if not supplier_id:
                run.rows_failed += 1
                continue
            seen_supplier_ids.add(supplier_id)

            siret = _as_str(_first_present(structure, "siretStructure", "siret")) or ""
            chorus_active = _as_bool(_first_present(structure, "statut", "active"), default=True)
            if allowed_ids is not None and supplier_id not in allowed_ids:
                effective_active = False
            else:
                effective_active = chorus_active

            payload = {
                "id": supplier_id,
                "tenant_id": tenant_id,
                "legal_name": _supplier_legal_name(structure),
                "siret": siret,
                "vat_number": _as_str(_first_present(structure, "numeroTVA", "numeroTva")),
                "chorus_supplier_code": supplier_id,
                "active": effective_active,
                "raw_payload": structure,
                "last_synced_at": now,
            }

            stmt = pg_insert(Supplier).values(**payload)
            stmt = stmt.on_conflict_do_update(
                index_elements=[Supplier.id],
                set_={
                    "legal_name": stmt.excluded.legal_name,
                    "siret": stmt.excluded.siret,
                    "vat_number": stmt.excluded.vat_number,
                    "chorus_supplier_code": stmt.excluded.chorus_supplier_code,
                    "active": stmt.excluded.active,
                    "raw_payload": stmt.excluded.raw_payload,
                    "last_synced_at": stmt.excluded.last_synced_at,
                },
            )
            session.execute(stmt)
            run.rows_upserted += 1

        if seen_supplier_ids:
            session.execute(
                update(Supplier)
                .where(
                    Supplier.tenant_id == tenant_id,
                    Supplier.chorus_supplier_code.is_not(None),
                    Supplier.chorus_supplier_code.notin_(seen_supplier_ids),
                )
                .values(active=False, last_synced_at=now)
            )

        run.payload_summary = {
            "chorus_response": {"rows": len(structures)},
        }

    return run


# ---------------------------------------------------------------------------
# Invoices for a supplier
# ---------------------------------------------------------------------------


_INVOICE_LIST_KEYS = {
    "factures",
    "listeFacture",
    "listeFactures",
    "listeDemandePaiement",
    "listeDemandesPaiement",
    "demandesPaiement",
    "resultats",
    "results",
    "items",
    "data",
}


def _deep_find_first_list(value: Any, candidate_keys: set[str]) -> list[dict[str, Any]]:
    if isinstance(value, dict):
        for key, nested in value.items():
            if key in candidate_keys and isinstance(nested, list):
                return [item for item in nested if isinstance(item, dict)]
        for nested in value.values():
            found = _deep_find_first_list(nested, candidate_keys)
            if found:
                return found
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    return []


def _invoice_id_from(supplier_id: str, invoice: dict[str, Any]) -> str:
    chorus_id = _as_str(
        _first_present(
            invoice,
            "identifiantFactureCPP",
            "idFacture",
            "numeroFactureChorus",
            "numeroDp",
            "numeroDP",
        )
    )
    if chorus_id:
        return f"chorus-{chorus_id}"
    supplier_number = _as_str(
        _first_present(invoice, "numeroFacture", "numeroFactureSaisi")
    )
    if supplier_number:
        return f"{supplier_id}::{supplier_number}"
    return f"chorus-{uuid.uuid5(uuid.NAMESPACE_OID, repr(invoice))}"


def _invoice_supplier_invoice_number(invoice: dict[str, Any]) -> Optional[str]:
    return _as_str(
        _first_present(
            invoice,
            "numeroFacture",
            "numeroFactureSaisi",
            "numeroFactureFournisseur",
        )
    )


def _invoice_already_exists(
    session: Session,
    *,
    tenant_id: str,
    local_supplier_id: str,
    invoice: dict[str, Any],
) -> bool:
    supplier_invoice_number = _invoice_supplier_invoice_number(invoice)
    if not supplier_invoice_number:
        return False

    invoice_id = _invoice_id_from(local_supplier_id, invoice)
    if session.get(Invoice, invoice_id) is not None:
        return True

    existing_id = session.scalar(
        select(Invoice.id).where(
            Invoice.tenant_id == tenant_id,
            Invoice.supplier_id == local_supplier_id,
            Invoice.supplier_invoice_number == supplier_invoice_number,
        )
    )
    return existing_id is not None


def _count_local_invoices(
    session: Session,
    *,
    tenant_id: str,
    local_supplier_id: str,
) -> int:
    return (
        session.scalar(
            select(func.count(Invoice.id)).where(
                Invoice.tenant_id == tenant_id,
                Invoice.supplier_id == local_supplier_id,
            )
        )
        or 0
    )


def _extract_chorus_total(response: Any, fallback: int) -> int:
    if isinstance(response, dict):
        parametres_retour = response.get("parametresRetour")
        if isinstance(parametres_retour, dict):
            value = _as_decimal(parametres_retour.get("total"))
            if value is not None:
                return int(value)

        for key in ("total", "nbTotalResultats", "nombreTotalResultats"):
            value = _as_decimal(response.get(key))
            if value is not None:
                return int(value)

    return fallback


def _public_customer_identity_from_invoice(invoice: dict[str, Any]) -> Optional[dict[str, Any]]:
    code = _as_str(
        _first_present(
            invoice,
            "codeDestinataire",
            "siretDestinataire",
            "siretStructure",
            "identifiantDestinataire",
        )
    )
    id_destinataire = _as_str(
        _first_present(
            invoice,
            "idDestinataire",
            "idStructureDestinataire",
            "idStructureCPP",
            "idDestinataireCPP",
        )
    )
    stable_key = code or id_destinataire
    if not stable_key:
        return None

    api_legal_name = _as_str(
        _first_present(
            invoice,
            "designationDestinataire",
            "raisonSocialeStuctDmd",
            "raisonSocialeStructureDmd",
            "raisonSocialeDestinataire",
            "nomDestinataire",
            "destinataire",
            "libelleDestinataire",
        )
    )
    raw_siret = _as_str(
        _first_present(invoice, "siretDestinataire", "siretStructure", "siret")
    )
    digits = "".join(character for character in (raw_siret or code or "") if character.isdigit())

    return {
        "id": f"public-{uuid.uuid5(uuid.NAMESPACE_URL, stable_key)}",
        "code_destinataire": code or stable_key,
        "legal_name": api_legal_name or f"Destinataire {stable_key}",
        "siret": digits if len(digits) == 14 else "",
        "has_real_name": bool(api_legal_name),
    }


def _ensure_public_customer_from_invoice(
    session: Session,
    *,
    tenant_id: str,
    invoice: dict[str, Any],
    now: datetime,
) -> Optional[str]:
    identity = _public_customer_identity_from_invoice(invoice)
    if identity is None:
        return None

    has_real_name = bool(identity.get("has_real_name"))
    new_siret = identity["siret"] or None
    new_legal_name = identity["legal_name"]

    existing = session.scalar(
        select(PublicCustomer).where(
            PublicCustomer.tenant_id == tenant_id,
            PublicCustomer.code_destinataire == identity["code_destinataire"],
        )
    )
    if existing is None:
        existing = session.get(PublicCustomer, identity["id"])

    if existing is not None:
        had_placeholder = (
            existing.legal_name is None
            or existing.legal_name.startswith("Destinataire ")
        )
        if has_real_name and (had_placeholder or existing.legal_name != new_legal_name):
            existing.legal_name = new_legal_name
        if new_siret and existing.siret != new_siret:
            existing.siret = new_siret
        existing.raw_payload = invoice
        existing.last_synced_at = now
        return existing.id

    stmt = pg_insert(PublicCustomer).values(
        id=identity["id"],
        tenant_id=tenant_id,
        code_destinataire=identity["code_destinataire"],
        legal_name=new_legal_name,
        siret=new_siret,
        structure_type="PUBLIC",
        active=True,
        raw_payload=invoice,
        last_synced_at=now,
    )
    session.execute(stmt.on_conflict_do_nothing())

    inserted_or_existing = session.scalar(
        select(PublicCustomer.id).where(
            PublicCustomer.tenant_id == tenant_id,
            PublicCustomer.code_destinataire == identity["code_destinataire"],
        )
    )
    if inserted_or_existing is not None:
        return inserted_or_existing

    customer_by_id = session.get(PublicCustomer, identity["id"])
    return customer_by_id.id if customer_by_id is not None else identity["id"]


def _ensure_public_service_from_invoice(
    session: Session,
    *,
    tenant_id: str,
    public_customer_id: Optional[str],
    invoice: dict[str, Any],
    now: datetime,
) -> Optional[str]:
    if public_customer_id is None:
        return None

    code = _as_str(_first_present(invoice, "codeServiceExecutant"))
    chorus_id = _as_str(_first_present(invoice, "idServiceExecutant"))
    label = _as_str(_first_present(invoice, "nomServiceExecutant", "libelleServiceExecutant"))
    if not code and not chorus_id:
        return None

    natural_key = code or f"id-{chorus_id}"
    service_id = f"{public_customer_id}::SVC{natural_key}"

    stmt = pg_insert(PublicService).values(
        id=service_id,
        tenant_id=tenant_id,
        public_customer_id=public_customer_id,
        code_service_executant=code or natural_key,
        label=label or f"Service {natural_key}",
        engagement_required=False,
        purchase_order_required=False,
        active=True,
        raw_payload=invoice,
        last_synced_at=now,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=[PublicService.id],
        set_={
            "label": stmt.excluded.label,
            "code_service_executant": stmt.excluded.code_service_executant,
            "active": stmt.excluded.active,
            "last_synced_at": stmt.excluded.last_synced_at,
        },
    )
    session.execute(stmt)
    return service_id


def _resolve_delta_since(
    session: Session,
    *,
    tenant_id: str,
    local_supplier_id: str,
) -> Optional[date]:
    """
    Borne basse à utiliser pour une sync delta:
    on prend le max(last_status_sync_at) des factures déjà en DB pour ce fournisseur,
    moins une marge de sécurité de 24h pour rattraper les dépôts antidatés.
    """
    last_synced = session.scalar(
        select(func.max(Invoice.last_status_sync_at)).where(
            Invoice.tenant_id == tenant_id,
            Invoice.supplier_id == local_supplier_id,
        )
    )
    if last_synced is None:
        return None
    return (last_synced - DELTA_SAFETY_MARGIN).date()


def _resolved_page_size(mode: SyncMode, requested: Optional[int]) -> int:
    if mode == "full":
        if requested is not None and requested > 0:
            return min(requested, 5000)
        return DEFAULT_FULL_PAGE_SIZE
    return DEFAULT_RECENT_PAGE_SIZE


def _build_invoice_search_payload(
    *,
    supplier_id_int: int,
    page_size: int,
    since: Optional[date],
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "cadreFacturation": "A1_FACTURE_FOURNISSEUR",
        "idFournisseur": supplier_id_int,
        "rechercheFactureParFournisseur": {
            "nbResultatsMaximum": page_size,
            "nbResultatsParPage": page_size,
            "triColonne": "DateDepot",
            "triSens": "Descendant",
        },
        "typeFacture": "FACTURE",
    }
    if since is not None:
        payload["periodeDateDepotDu"] = since.strftime("%Y-%m-%d")
    return payload


def sync_invoices_for_supplier(
    session: Session,
    *,
    settings: ChorusSettings,
    supplier_id: str,
    client: Optional[ChorusClient] = None,
    tenant_id: str,
    mode: SyncMode = "recent",
    page_size: Optional[int] = None,
    since: Optional[date] = None,
    trigger: str = "manual",
    extra_criteria: Optional[dict[str, Any]] = None,
) -> SyncRun:
    """
    Fetch supplier invoices from Chorus and upsert them.

    Modes:
      - "recent" (default) : top N most recent invoices (sorted by deposit date desc).
                             Cheap, ideal for an "Actualiser" button.
      - "delta"            : count-check Chorus, then fetch exactly the 100 most
                             recent invoices only if Chorus has more rows than DB.
                             Existing invoices are skipped; missing invoices are inserted.
      - "full"             : retrieve everything (rare; bootstrap or repair).
    """
    ensure_tenant(session, tenant_id)
    chorus_client = client or ChorusClient(settings)

    with SyncRunContext(
        session,
        tenant_id=tenant_id,
        entity="invoices",
        trigger=trigger,
        chorus_environment=_infer_environment(settings),
        payload_summary={"supplier_id": supplier_id, "mode": mode},
    ) as run:
        try:
            supplier_id_int = int(supplier_id)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"supplier_id Chorus invalide: {supplier_id!r}") from exc

        if not _try_advisory_xact_lock(
            session, "sync_invoices", tenant_id, str(supplier_id_int)
        ):
            run.rows_fetched = 0
            run.payload_summary = {
                "supplier_id": supplier_id,
                "mode": mode,
                "skipped": True,
                "reason": "concurrent_sync_already_running",
            }
            return run

        local_supplier_id = _ensure_local_supplier_for_chorus_id(
            session, tenant_id=tenant_id, chorus_supplier_code=str(supplier_id_int)
        )

        def search_chorus(payload: dict[str, Any]) -> tuple[Any, dict[str, Any]]:
            try:
                response = chorus_client.search_supplier_invoices(payload)
                return response, _summarize_chorus_response(response)
            except ChorusApiError as exc:
                message = str(exc)
                if any(f"codeRetour={code}" in message for code in CHORUS_EMPTY_RESULT_CODES):
                    logger.info("Sync invoices: aucun résultat Chorus (%s)", message)
                    return {}, {"codeRetour": "20002", "empty": True}
                raise

        local_count = _count_local_invoices(
            session, tenant_id=tenant_id, local_supplier_id=local_supplier_id
        )
        remote_total: Optional[int] = None
        effective_mode = mode
        effective_since: Optional[date] = since
        effective_page_size = _resolved_page_size(mode, page_size)
        count_response_summary: dict[str, Any] = {}

        if mode in {"delta", "full"}:
            count_payload = _build_invoice_search_payload(
                supplier_id_int=supplier_id_int,
                page_size=2,
                since=None,
            )
            if extra_criteria:
                count_payload.update(extra_criteria)
                count_payload["idFournisseur"] = supplier_id_int

            count_response, count_response_summary = search_chorus(count_payload)
            count_items = _deep_find_first_list(count_response, _INVOICE_LIST_KEYS)
            remote_total = _extract_chorus_total(count_response, len(count_items))

            if mode == "delta":
                effective_since = None
                if local_count == 0:
                    effective_mode = "full"
                    effective_page_size = min(max(remote_total or DEFAULT_FULL_PAGE_SIZE, 1), 5000)
                elif remote_total <= local_count:
                    run.rows_fetched = 0
                    run.payload_summary = {
                        "supplier_id": supplier_id,
                        "mode": mode,
                        "strategy": "count-check",
                        "local_count": local_count,
                        "remote_total": remote_total,
                        "skipped": True,
                        "reason": "remote_total_not_greater_than_local_count",
                        "chorus_count_response": count_response_summary,
                    }
                    return run
                else:
                    effective_page_size = _resolved_page_size("recent", page_size)

            if mode == "full":
                effective_mode = "full"
                effective_since = None
                if page_size is None:
                    effective_page_size = min(max(remote_total or DEFAULT_FULL_PAGE_SIZE, 1), 5000)

        if effective_mode == "full":
            effective_since = None

        payload = _build_invoice_search_payload(
            supplier_id_int=supplier_id_int,
            page_size=effective_page_size,
            since=effective_since,
        )
        if extra_criteria:
            payload.update(extra_criteria)
            payload["idFournisseur"] = supplier_id_int

        response, chorus_response_summary = search_chorus(payload)

        invoices_raw = _deep_find_first_list(response, _INVOICE_LIST_KEYS)
        run.rows_fetched = len(invoices_raw)

        now = datetime.now(timezone.utc)
        insert_missing_only = effective_mode != "full"
        skipped_existing = 0
        for invoice in invoices_raw:
            try:
                inserted = False
                with session.begin_nested():
                    if insert_missing_only and _invoice_already_exists(
                        session,
                        tenant_id=tenant_id,
                        local_supplier_id=local_supplier_id,
                        invoice=invoice,
                    ):
                        skipped_existing += 1
                    else:
                        _upsert_invoice(
                            session,
                            invoice=invoice,
                            tenant_id=tenant_id,
                            local_supplier_id=local_supplier_id,
                            now=now,
                        )
                        inserted = True
                if inserted:
                    run.rows_upserted += 1
            except Exception as error:  # noqa: BLE001
                logger.exception("Echec upsert facture: %s", error)
                run.rows_failed += 1

        run.payload_summary = {
            "supplier_id": supplier_id,
            "mode": mode,
            "effective_mode": effective_mode,
            "strategy": "count-check" if mode == "delta" else mode,
            "page_size": effective_page_size,
            "since": effective_since.isoformat() if effective_since else None,
            "local_count_before": local_count,
            "remote_total": remote_total,
            "fetched": run.rows_fetched,
            "upserted": run.rows_upserted,
            "skipped_existing": skipped_existing,
            "failed": run.rows_failed,
            "chorus_request": payload,
            "chorus_count_response": count_response_summary,
            "chorus_response": chorus_response_summary,
        }

    return run


def _ensure_local_supplier_for_chorus_id(
    session: Session, *, tenant_id: str, chorus_supplier_code: str
) -> str:
    supplier = session.scalar(
        select(Supplier).where(
            Supplier.tenant_id == tenant_id,
            Supplier.chorus_supplier_code == chorus_supplier_code,
        )
    )
    if supplier is not None:
        return supplier.id

    placeholder = Supplier(
        id=chorus_supplier_code,
        tenant_id=tenant_id,
        legal_name=f"Fournisseur Chorus {chorus_supplier_code}",
        siret="",
        chorus_supplier_code=chorus_supplier_code,
        active=True,
    )
    session.add(placeholder)
    session.flush()
    return placeholder.id


def _upsert_invoice(
    session: Session,
    *,
    invoice: dict[str, Any],
    tenant_id: str,
    local_supplier_id: str,
    now: datetime,
) -> None:
    supplier_invoice_number = _invoice_supplier_invoice_number(invoice)
    if not supplier_invoice_number:
        raise ValueError("numeroFacture absent dans la réponse Chorus")

    invoice_id = _invoice_id_from(local_supplier_id, invoice)

    total_ht = _as_decimal(_first_present(invoice, "montantHT", "montantTotalHt"))
    total_vat = _as_decimal(_first_present(invoice, "montantTVA", "montantTva"))
    total_ttc = _as_decimal(_first_present(invoice, "montantTTC", "montantAPayer"))
    if total_ht is None and total_ttc is not None and total_vat is not None:
        total_ht = total_ttc - total_vat
    if total_vat is None and total_ht is not None and total_ttc is not None:
        total_vat = total_ttc - total_ht

    public_customer_id = _ensure_public_customer_from_invoice(
        session,
        tenant_id=tenant_id,
        invoice=invoice,
        now=now,
    )
    public_service_id = _ensure_public_service_from_invoice(
        session,
        tenant_id=tenant_id,
        public_customer_id=public_customer_id,
        invoice=invoice,
        now=now,
    )

    market_number = _as_str(_first_present(invoice, "numeroMarche"))
    if market_number and market_number.lower() == "null":
        market_number = None

    payload = {
        "id": invoice_id,
        "tenant_id": tenant_id,
        "supplier_id": local_supplier_id,
        "public_customer_id": public_customer_id,
        "public_service_id": public_service_id,
        "source_format": _as_str(_first_present(invoice, "formatDepot", "format")) or "PDF",
        "supplier_invoice_number": supplier_invoice_number,
        "chorus_invoice_number": _as_str(
            _first_present(invoice, "numeroFactureChorus", "identifiantFactureCPP")
        ),
        "external_reference": _as_str(_first_present(invoice, "referenceExterne")),
        "invoice_date": _as_date(_first_present(invoice, "dateFacture", "dateEmission")),
        "due_date": _as_date(_first_present(invoice, "dateEcheance")),
        "currency_code": _as_str(_first_present(invoice, "devise", "codeDevise")) or "EUR",
        "total_ht": total_ht or Decimal("0"),
        "total_vat": total_vat or Decimal("0"),
        "total_ttc": total_ttc or Decimal("0"),
        "engagement_number": _as_str(_first_present(invoice, "numeroEngagement")),
        "purchase_order_number": _as_str(_first_present(invoice, "numeroBonCommande")),
        "market_number": market_number,
        "deposit_mode": _as_str(_first_present(invoice, "modeDepot")),
        "chorus_invoice_type": _as_str(
            _first_present(invoice, "typeDemandePaiement", "typeFacture")
        ),
        "recipient_chorus_id": _as_str(_first_present(invoice, "idDestinataire")),
        "recipient_chorus_code": _as_str(_first_present(invoice, "codeDestinataire")),
        "recipient_chorus_name": _as_str(_first_present(invoice, "designationDestinataire")),
        "service_chorus_id": _as_str(_first_present(invoice, "idServiceExecutant")),
        "service_chorus_code": _as_str(_first_present(invoice, "codeServiceExecutant")),
        "service_chorus_name": _as_str(
            _first_present(invoice, "nomServiceExecutant", "libelleServiceExecutant")
        ),
        "supplier_chorus_code": _as_str(_first_present(invoice, "codeFournisseur")),
        "supplier_chorus_name": _as_str(_first_present(invoice, "designationFournisseur")),
        "amount_to_pay": _as_decimal(_first_present(invoice, "montantAPayer")),
        "created_by_name": _as_str(_first_present(invoice, "nomPrenomUtilisateurCreateur")),
        "rejection_processed": (
            _as_bool(invoice.get("rejetTraite"), default=False)
            if invoice.get("rejetTraite") is not None
            else None
        ),
        "attachment_count": (
            int(invoice["taille"])
            if isinstance(invoice.get("taille"), int)
            else None
        ),
        "status_internal": "STATUS_SYNC_PENDING",
        "status_chorus": _as_str(
            _first_present(
                invoice,
                "statut",
                "statutCourant",
                "libelleStatutCourant",
                "libelleEtatCourant",
            )
        ),
        "status_reason_code": _as_str(
            _first_present(
                invoice,
                "codeMotifRejet",
                "codeRejet",
                "motifRejetCode",
                "codeEtatCourant",
            )
        ),
        "status_reason_label": _as_str(
            _first_present(
                invoice,
                "commentaireEtatCourant",
                "commentaireStatutCourant",
                "commentaireEtat",
                "motifRejet",
                "motifRefus",
                "libelleMotifRejet",
                "messageRejet",
            )
        ),
        "submitted_at": _as_datetime(_first_present(invoice, "dateDepot")),
        "status_changed_at": _as_datetime(
            _first_present(invoice, "dateHeureEtatCourant", "dateEtatCourant")
        ),
        "last_status_sync_at": now,
        "raw_payload": invoice,
        "last_synced_at": now,
    }

    stmt = pg_insert(Invoice).values(**payload)
    stmt = stmt.on_conflict_do_update(
        index_elements=[Invoice.id],
        set_={
            "chorus_invoice_number": stmt.excluded.chorus_invoice_number,
            "external_reference": stmt.excluded.external_reference,
            "public_customer_id": stmt.excluded.public_customer_id,
            "public_service_id": stmt.excluded.public_service_id,
            "invoice_date": stmt.excluded.invoice_date,
            "due_date": stmt.excluded.due_date,
            "currency_code": stmt.excluded.currency_code,
            "total_ht": stmt.excluded.total_ht,
            "total_vat": stmt.excluded.total_vat,
            "total_ttc": stmt.excluded.total_ttc,
            "engagement_number": stmt.excluded.engagement_number,
            "purchase_order_number": stmt.excluded.purchase_order_number,
            "market_number": stmt.excluded.market_number,
            "deposit_mode": stmt.excluded.deposit_mode,
            "chorus_invoice_type": stmt.excluded.chorus_invoice_type,
            "recipient_chorus_id": stmt.excluded.recipient_chorus_id,
            "recipient_chorus_code": stmt.excluded.recipient_chorus_code,
            "recipient_chorus_name": stmt.excluded.recipient_chorus_name,
            "service_chorus_id": stmt.excluded.service_chorus_id,
            "service_chorus_code": stmt.excluded.service_chorus_code,
            "service_chorus_name": stmt.excluded.service_chorus_name,
            "supplier_chorus_code": stmt.excluded.supplier_chorus_code,
            "supplier_chorus_name": stmt.excluded.supplier_chorus_name,
            "amount_to_pay": stmt.excluded.amount_to_pay,
            "created_by_name": stmt.excluded.created_by_name,
            "rejection_processed": stmt.excluded.rejection_processed,
            "attachment_count": stmt.excluded.attachment_count,
            "status_chorus": stmt.excluded.status_chorus,
            "status_reason_code": stmt.excluded.status_reason_code,
            "status_reason_label": stmt.excluded.status_reason_label,
            "submitted_at": stmt.excluded.submitted_at,
            "status_changed_at": stmt.excluded.status_changed_at,
            "last_status_sync_at": stmt.excluded.last_status_sync_at,
            "raw_payload": stmt.excluded.raw_payload,
            "last_synced_at": stmt.excluded.last_synced_at,
        },
    )
    session.execute(stmt)


# ---------------------------------------------------------------------------
# Public API helper
# ---------------------------------------------------------------------------


def sync_all_for_default_supplier(
    session: Session,
    *,
    tenant_id: str,
    environment_override: Optional[str] = None,
    mode: SyncMode = "delta",
    page_size: Optional[int] = None,
    trigger: str = "manual",
) -> dict[str, SyncRun]:
    """Convenience: sync suppliers + invoices for the default supplier from settings."""
    settings = load_chorus_settings(environment_override=environment_override)
    client = ChorusClient(settings)

    suppliers_run = sync_suppliers(
        session, settings=settings, client=client, tenant_id=tenant_id, trigger=trigger
    )

    default_id = settings.default_supplier_id
    invoices_run: Optional[SyncRun] = None
    if default_id is not None:
        invoices_run = sync_invoices_for_supplier(
            session,
            settings=settings,
            client=client,
            tenant_id=tenant_id,
            supplier_id=str(default_id),
            mode=mode,
            page_size=page_size,
            trigger=trigger,
        )

    result: dict[str, SyncRun] = {"suppliers": suppliers_run}
    if invoices_run is not None:
        result["invoices"] = invoices_run
    return result
