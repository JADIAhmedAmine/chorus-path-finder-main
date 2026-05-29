"""Synthèse pilotage : agrège les factures + l'audit en un payload unique.

Volontairement pur (pas de DB ni de FS) pour rester testable.
La couche API (`db/api.py`) charge les factures + l'audit puis appelle
`build_dashboard_summary`.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Iterable, Protocol


# === Catégories de statut Chorus =============================================

PAID_STATES: frozenset[str] = frozenset(
    {"MISE_EN_PAIEMENT", "COMPTABILISEE", "MANDATEE"}
)

IN_PROGRESS_STATES: frozenset[str] = frozenset(
    {
        "DEPOSEE",
        "EN_COURS_ACHEMINEMENT",
        "MISE_A_DISPOSITION",
        "MISE_A_DISPOSITION_COMPTABLE",
        "MISE_A_DISPOSITION_MOE",
        "MISE_A_DISPOSITION_MOA",
        "A_VALIDER_1",
        "A_VALIDER_2",
        "A_VALIDER_MOE",
        "SERVICE_FAIT",
        "PRISE_EN_COMPTE_MOE",
        "PRISE_EN_COMPTE_MOA",
        "PRISE_EN_COMPTE_DESTINATAIRE",
        "VALIDEE_1",
        "VALIDEE_2",
        "ASSOCIEE",
        "TRANSMISE_MOA",
    }
)

ACTION_REQUIRED_STATES: frozenset[str] = frozenset(
    {
        "REJETEE",
        "A_RECYCLER",
        "EN_ATTENTE_RECYCLAGE_FOURNISSEUR",
        "ERREUR_FOURNISSEUR_SUR_VALIDEUR",
        "ERREUR_FOURNISSEUR_SUR_MOE",
        "ERREUR_FOURNISSEUR_SUR_MOA",
        "ERREUR_MOE_SUR_FOURNISSEUR",
        "ERREUR_MOA_SUR_FOURNISSEUR",
        "A_COMPLETER",
        "DUPLIQUE_APRES_REFUS",
    }
)

BLOCKED_STATES: frozenset[str] = ACTION_REQUIRED_STATES | frozenset(
    {
        "SUSPENDUE",
        "REFUSEE_1",
        "REFUSEE_2",
        "REFUSEE_MOE",
        "REFUSEE_MOA",
        "REFUSEE_FOURNISSEUR",
        "ABSENCE_VALIDATION_1_HORS_DELAI",
        "ABSENCE_VALIDATION_2_HORS_DELAI",
        "ABSENCE_VALIDATION_MOE_DELAI_REGLEMENTAIRE",
        "ABANDONNEE",
        "SUPPRIMEE",
        "NON_CONFORME",
        "ERREUR_DESTINATAIRE_PD",
        "ERREUR_DESTINATAIRE_EA",
        "TECHNIQUE_INCONNU",
    }
)

DRAFT_STATES: frozenset[str] = frozenset({"BROUILLON"})


def _bucket_for_status(status: str | None) -> str:
    if not status:
        return "UNKNOWN"
    normalized = status.strip().upper()
    if normalized in PAID_STATES:
        return "PAID"
    if normalized in ACTION_REQUIRED_STATES:
        return "ACTION_REQUIRED"
    if normalized in BLOCKED_STATES:
        return "BLOCKED"
    if normalized in IN_PROGRESS_STATES:
        return "IN_PROGRESS"
    if normalized in DRAFT_STATES:
        return "DRAFT"
    return "UNKNOWN"


# === Modèle d'entrée ==========================================================

class InvoiceLike(Protocol):
    """Vue minimale d'une facture utilisée par le builder.

    Le mapping ORM `Invoice` colle naturellement à ce protocole — pas besoin
    d'adaptateur dans la couche API.
    """

    id: str
    supplier_invoice_number: str
    total_ttc: Decimal | float | int
    status_chorus: str | None
    status_reason_code: str | None
    status_reason_label: str | None
    invoice_date: date | None
    submitted_at: datetime | None
    status_changed_at: datetime | None
    updated_at: datetime | None
    public_customer_id: str | None


@dataclass(frozen=True)
class CustomerLookup:
    public_customer_id: str
    name: str


# === Sortie ==================================================================

@dataclass
class DashboardSummary:
    generated_at: str
    period_from: str | None
    period_to: str | None
    totals: dict[str, Any]
    api_health: dict[str, Any]
    status_distribution: list[dict[str, Any]]
    aging: list[dict[str, Any]]
    top_entities_by_amount: list[dict[str, Any]]
    top_entities_by_blocked: list[dict[str, Any]]
    top_rejection_reasons: list[dict[str, Any]]
    recent_issues: list[dict[str, Any]]
    insights: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "generatedAt": self.generated_at,
            "periodFrom": self.period_from,
            "periodTo": self.period_to,
            "totals": self.totals,
            "apiHealth": self.api_health,
            "statusDistribution": self.status_distribution,
            "aging": self.aging,
            "topEntitiesByAmount": self.top_entities_by_amount,
            "topEntitiesByBlocked": self.top_entities_by_blocked,
            "topRejectionReasons": self.top_rejection_reasons,
            "recentIssues": self.recent_issues,
            "insights": self.insights,
        }


# === Helpers internes ========================================================

_AGING_BUCKETS: tuple[tuple[str, int, int | None], ...] = (
    ("0-7", 0, 7),
    ("8-15", 8, 15),
    ("16-30", 16, 30),
    ("30+", 31, None),
)


def _to_float(value: Decimal | float | int | None) -> float:
    if value is None:
        return 0.0
    if isinstance(value, Decimal):
        return float(value)
    return float(value)


def _coerce_date(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
        except ValueError:
            return None
    return None


def _age_days(reference_date: date, *candidates: Any) -> int | None:
    for candidate in candidates:
        coerced = _coerce_date(candidate)
        if coerced is not None:
            delta = (reference_date - coerced).days
            return max(delta, 0)
    return None


def _bucket_label_for_age(age: int | None) -> str | None:
    if age is None:
        return None
    for label, lower, upper in _AGING_BUCKETS:
        if upper is None:
            if age >= lower:
                return label
        elif lower <= age <= upper:
            return label
    return None


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


# === Builder principal =======================================================

def build_dashboard_summary(
    invoices: Iterable[InvoiceLike],
    *,
    audit_events: Iterable[dict[str, Any]] | None = None,
    customers: Iterable[CustomerLookup] | None = None,
    period_from: str | None = None,
    period_to: str | None = None,
    reference_date: date | None = None,
    top_n: int = 5,
    recent_issues_limit: int = 5,
) -> DashboardSummary:
    invoice_list = list(invoices)
    today = reference_date or datetime.now(timezone.utc).date()
    customer_names: dict[str, str] = {
        entry.public_customer_id: entry.name
        for entry in (customers or [])
        if entry.public_customer_id
    }

    # --- Compteurs globaux --------------------------------------------------
    total_amount = 0.0
    paid_amount = 0.0
    blocked_amount = 0.0
    in_progress_amount = 0.0
    action_amount = 0.0
    paid_count = 0
    blocked_count = 0
    action_count = 0
    in_progress_count = 0
    draft_count = 0
    rejected_count = 0

    status_count: Counter[str] = Counter()
    status_amount: dict[str, float] = defaultdict(float)
    customer_total: dict[str, float] = defaultdict(float)
    customer_blocked: dict[str, float] = defaultdict(float)
    customer_count: dict[str, int] = defaultdict(int)
    aging_count: dict[str, int] = {label: 0 for label, *_ in _AGING_BUCKETS}
    aging_amount: dict[str, float] = {label: 0.0 for label, *_ in _AGING_BUCKETS}
    rejection_count: Counter[tuple[str, str | None]] = Counter()
    rejection_amount: dict[tuple[str, str | None], float] = defaultdict(float)
    issue_pool: list[dict[str, Any]] = []

    for invoice in invoice_list:
        amount = _to_float(invoice.total_ttc)
        status_raw = (invoice.status_chorus or "").strip().upper() or None
        bucket = _bucket_for_status(status_raw)

        total_amount += amount
        if status_raw:
            status_count[status_raw] += 1
            status_amount[status_raw] += amount

        if bucket == "PAID":
            paid_amount += amount
            paid_count += 1
        elif bucket == "BLOCKED":
            blocked_amount += amount
            blocked_count += 1
        elif bucket == "ACTION_REQUIRED":
            blocked_amount += amount
            blocked_count += 1
            action_amount += amount
            action_count += 1
        elif bucket == "IN_PROGRESS":
            in_progress_amount += amount
            in_progress_count += 1
        elif bucket == "DRAFT":
            draft_count += 1

        if status_raw == "REJETEE":
            rejected_count += 1

        # Top entités
        customer_id = invoice.public_customer_id
        if customer_id:
            customer_count[customer_id] += 1
            customer_total[customer_id] += amount
            if bucket in ("BLOCKED", "ACTION_REQUIRED"):
                customer_blocked[customer_id] += amount

        # Aging (uniquement pour les factures non encore payées)
        if bucket != "PAID":
            age = _age_days(
                today,
                invoice.submitted_at,
                invoice.status_changed_at,
                invoice.invoice_date,
            )
            label = _bucket_label_for_age(age)
            if label is not None:
                aging_count[label] += 1
                aging_amount[label] += amount

        # Motifs de rejet
        reason_code = (invoice.status_reason_code or "").strip() or None
        reason_label = (invoice.status_reason_label or "").strip() or None
        if bucket in ("BLOCKED", "ACTION_REQUIRED") and (reason_code or reason_label):
            key = (reason_code or reason_label or "INCONNU", reason_label)
            rejection_count[key] += 1
            rejection_amount[key] += amount

        # Pool des issues récentes
        if bucket in ("BLOCKED", "ACTION_REQUIRED"):
            sort_key = invoice.status_changed_at or invoice.submitted_at or invoice.updated_at
            issue_pool.append(
                {
                    "_sort": sort_key.isoformat() if isinstance(sort_key, datetime) else "",
                    "invoiceId": invoice.id,
                    "supplierInvoiceNumber": invoice.supplier_invoice_number,
                    "status": status_raw,
                    "statusReasonCode": reason_code,
                    "statusReasonLabel": reason_label,
                    "publicCustomerId": customer_id,
                    "publicCustomerName": customer_names.get(customer_id or "", None),
                    "totalTtc": amount,
                    "ageInDays": _age_days(
                        today,
                        invoice.status_changed_at,
                        invoice.submitted_at,
                        invoice.invoice_date,
                    ),
                    "requiresAction": bucket == "ACTION_REQUIRED",
                }
            )

    # --- Sérialisation des listes -------------------------------------------

    status_distribution = [
        {
            "status": status,
            "count": count,
            "amount": round(status_amount.get(status, 0.0), 2),
            "bucket": _bucket_for_status(status),
        }
        for status, count in status_count.most_common()
    ]

    aging = [
        {
            "label": label,
            "count": aging_count[label],
            "amount": round(aging_amount[label], 2),
        }
        for label, *_ in _AGING_BUCKETS
    ]

    top_entities_by_amount = sorted(
        (
            {
                "publicCustomerId": customer_id,
                "publicCustomerName": customer_names.get(customer_id, customer_id),
                "count": customer_count[customer_id],
                "totalAmount": round(customer_total[customer_id], 2),
                "blockedAmount": round(customer_blocked.get(customer_id, 0.0), 2),
            }
            for customer_id in customer_total
        ),
        key=lambda entry: entry["totalAmount"],
        reverse=True,
    )[:top_n]

    top_entities_by_blocked = sorted(
        (
            {
                "publicCustomerId": customer_id,
                "publicCustomerName": customer_names.get(customer_id, customer_id),
                "count": customer_count[customer_id],
                "totalAmount": round(customer_total[customer_id], 2),
                "blockedAmount": round(blocked, 2),
            }
            for customer_id, blocked in customer_blocked.items()
            if blocked > 0
        ),
        key=lambda entry: entry["blockedAmount"],
        reverse=True,
    )[:top_n]

    top_rejection_reasons = sorted(
        (
            {
                "reasonCode": code,
                "reasonLabel": label,
                "count": rejection_count[(code, label)],
                "blockedAmount": round(rejection_amount[(code, label)], 2),
            }
            for (code, label) in rejection_count
        ),
        key=lambda entry: entry["count"],
        reverse=True,
    )[:top_n]

    recent_issues = sorted(
        issue_pool,
        key=lambda item: item.get("_sort") or "",
        reverse=True,
    )[:recent_issues_limit]
    for item in recent_issues:
        item.pop("_sort", None)

    # --- Audit / API health -------------------------------------------------
    api_health = _build_api_health(audit_events or ())

    # --- Totals -------------------------------------------------------------
    totals = {
        "invoiceCount": len(invoice_list),
        "totalAmount": round(total_amount, 2),
        "paidAmount": round(paid_amount, 2),
        "paidCount": paid_count,
        "inProgressAmount": round(in_progress_amount, 2),
        "inProgressCount": in_progress_count,
        "blockedAmount": round(blocked_amount, 2),
        "blockedCount": blocked_count,
        "actionRequiredAmount": round(action_amount, 2),
        "actionRequiredCount": action_count,
        "rejectedCount": rejected_count,
        "draftCount": draft_count,
    }

    insights = _build_insights(totals, status_count, top_entities_by_blocked, aging)

    return DashboardSummary(
        generated_at=_utc_now_iso(),
        period_from=period_from,
        period_to=period_to,
        totals=totals,
        api_health=api_health,
        status_distribution=status_distribution,
        aging=aging,
        top_entities_by_amount=top_entities_by_amount,
        top_entities_by_blocked=top_entities_by_blocked,
        top_rejection_reasons=top_rejection_reasons,
        recent_issues=recent_issues,
        insights=insights,
    )


# === Sous-builders ============================================================

_API_HEALTH_ACTIONS: frozenset[str] = frozenset(
    {"invoice.submit", "invoice.recycle", "invoice.validator.correct"}
)


def _build_api_health(audit_events: Iterable[dict[str, Any]]) -> dict[str, Any]:
    success = 0
    failed = 0
    last_error: str | None = None
    last_error_at: str | None = None

    for event in audit_events:
        action = event.get("action")
        if action not in _API_HEALTH_ACTIONS:
            continue
        status = event.get("status")
        if status == "success":
            success += 1
        else:
            failed += 1
            message = event.get("errorMessage")
            timestamp = event.get("timestamp")
            if isinstance(message, str) and not last_error:
                last_error = message
                last_error_at = timestamp if isinstance(timestamp, str) else None

    total = success + failed
    success_rate = round((success / total) * 100, 1) if total else None

    return {
        "totalCalls": total,
        "successCount": success,
        "failedCount": failed,
        "successRate": success_rate,
        "lastErrorMessage": last_error,
        "lastErrorAt": last_error_at,
    }


def _format_eur(amount: float) -> str:
    return f"{amount:,.0f} €".replace(",", " ")


def _build_insights(
    totals: dict[str, Any],
    status_count: Counter[str],
    top_blocked: list[dict[str, Any]],
    aging: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    insights: list[dict[str, Any]] = []

    blocked_amount = float(totals.get("blockedAmount", 0.0))
    if blocked_amount > 0:
        insights.append(
            {
                "severity": "HIGH",
                "title": "Montant immobilisé",
                "message": f"{_format_eur(blocked_amount)} sont actuellement bloqués chez Chorus Pro.",
            }
        )

    action_count = int(totals.get("actionRequiredCount", 0) or 0)
    if action_count > 0:
        plural = "factures" if action_count > 1 else "facture"
        insights.append(
            {
                "severity": "MEDIUM",
                "title": "Action requise",
                "message": f"{action_count} {plural} à corriger ou recycler côté fournisseur.",
            }
        )

    blocked_states = [
        (status, count)
        for status, count in status_count.most_common()
        if _bucket_for_status(status) in ("BLOCKED", "ACTION_REQUIRED")
    ]
    if blocked_states:
        first_status, first_count = blocked_states[0]
        insights.append(
            {
                "severity": "MEDIUM",
                "title": "Principal blocage",
                "message": (
                    f"L'essentiel des dossiers bloqués est en statut {first_status} ({first_count})."
                ),
            }
        )

    if top_blocked:
        leader = top_blocked[0]
        insights.append(
            {
                "severity": "MEDIUM",
                "title": "Entité la plus exposée",
                "message": (
                    f"{leader['publicCustomerName']} concentre {_format_eur(leader['blockedAmount'])} bloqués."
                ),
            }
        )

    stuck = next(
        (entry for entry in aging if entry["label"] == "30+" and entry["count"] > 0),
        None,
    )
    if stuck:
        insights.append(
            {
                "severity": "HIGH",
                "title": "Dossiers anciens",
                "message": (
                    f"{stuck['count']} facture(s) en attente depuis plus de 30 jours."
                ),
            }
        )

    return insights
