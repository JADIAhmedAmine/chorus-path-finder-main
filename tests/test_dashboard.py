from __future__ import annotations

import sys
import unittest
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from chorus_python.dashboard import (
    CustomerLookup,
    build_dashboard_summary,
)


@dataclass
class FakeInvoice:
    id: str
    supplier_invoice_number: str
    total_ttc: Decimal | float
    status_chorus: str | None = None
    status_reason_code: str | None = None
    status_reason_label: str | None = None
    invoice_date: date | None = None
    submitted_at: datetime | None = None
    status_changed_at: datetime | None = None
    updated_at: datetime | None = None
    public_customer_id: str | None = None


REF_DATE = date(2026, 4, 30)


def _dt(days_ago: int) -> datetime:
    return datetime.combine(REF_DATE - timedelta(days=days_ago), datetime.min.time(), tzinfo=timezone.utc)


class BuildDashboardSummaryTest(unittest.TestCase):
    maxDiff = None

    def _sample(self) -> list[FakeInvoice]:
        return [
            FakeInvoice(
                id="inv-1",
                supplier_invoice_number="F-001",
                total_ttc=Decimal("1000.00"),
                status_chorus="MISE_EN_PAIEMENT",
                invoice_date=REF_DATE - timedelta(days=20),
                submitted_at=_dt(20),
                status_changed_at=_dt(2),
                public_customer_id="cust-A",
            ),
            FakeInvoice(
                id="inv-2",
                supplier_invoice_number="F-002",
                total_ttc=Decimal("400.00"),
                status_chorus="REJETEE",
                status_reason_code="REJ_MOTIF",
                status_reason_label="Pièce jointe manquante",
                invoice_date=REF_DATE - timedelta(days=45),
                submitted_at=_dt(45),
                status_changed_at=_dt(35),
                public_customer_id="cust-A",
            ),
            FakeInvoice(
                id="inv-3",
                supplier_invoice_number="F-003",
                total_ttc=Decimal("250.00"),
                status_chorus="A_RECYCLER",
                status_reason_code="REJ_MOTIF",
                status_reason_label="Pièce jointe manquante",
                submitted_at=_dt(10),
                status_changed_at=_dt(10),
                public_customer_id="cust-B",
            ),
            FakeInvoice(
                id="inv-4",
                supplier_invoice_number="F-004",
                total_ttc=Decimal("600.00"),
                status_chorus="DEPOSEE",
                submitted_at=_dt(3),
                status_changed_at=_dt(3),
                public_customer_id="cust-B",
            ),
            FakeInvoice(
                id="inv-5",
                supplier_invoice_number="F-005",
                total_ttc=Decimal("150.00"),
                status_chorus="BROUILLON",
                invoice_date=REF_DATE - timedelta(days=4),
                public_customer_id="cust-A",
            ),
        ]

    def test_totals_split_invoices_per_bucket(self) -> None:
        summary = build_dashboard_summary(
            self._sample(),
            reference_date=REF_DATE,
            customers=[
                CustomerLookup(public_customer_id="cust-A", name="Région A"),
                CustomerLookup(public_customer_id="cust-B", name="Mairie B"),
            ],
        ).to_dict()

        totals = summary["totals"]
        self.assertEqual(totals["invoiceCount"], 5)
        self.assertEqual(totals["paidCount"], 1)
        self.assertEqual(totals["paidAmount"], 1000.00)
        self.assertEqual(totals["blockedCount"], 2)
        self.assertEqual(totals["actionRequiredCount"], 2)
        self.assertEqual(totals["blockedAmount"], 650.00)
        self.assertEqual(totals["actionRequiredAmount"], 650.00)
        self.assertEqual(totals["rejectedCount"], 1)
        self.assertEqual(totals["draftCount"], 1)
        self.assertEqual(totals["inProgressCount"], 1)
        self.assertEqual(totals["totalAmount"], 2400.00)

    def test_status_distribution_orders_by_count(self) -> None:
        summary = build_dashboard_summary(self._sample(), reference_date=REF_DATE).to_dict()
        statuses = [entry["status"] for entry in summary["statusDistribution"]]
        self.assertEqual(statuses[0:1], ["MISE_EN_PAIEMENT"])  # first appearance
        # Tous les statuts doivent apparaître exactement une fois.
        self.assertEqual(len(statuses), 5)

    def test_aging_buckets_classify_non_paid_invoices(self) -> None:
        summary = build_dashboard_summary(self._sample(), reference_date=REF_DATE).to_dict()
        aging = {entry["label"]: entry for entry in summary["aging"]}
        self.assertEqual(aging["0-7"]["count"], 2)  # inv-4 (3j) + inv-5 (4j)
        self.assertEqual(aging["8-15"]["count"], 1)  # inv-3 (10j)
        self.assertEqual(aging["16-30"]["count"], 0)
        self.assertEqual(aging["30+"]["count"], 1)  # inv-2 (35j)

    def test_top_entities_by_blocked_uses_blocked_amount(self) -> None:
        summary = build_dashboard_summary(
            self._sample(),
            reference_date=REF_DATE,
            customers=[
                CustomerLookup(public_customer_id="cust-A", name="Région A"),
                CustomerLookup(public_customer_id="cust-B", name="Mairie B"),
            ],
        ).to_dict()

        blocked = summary["topEntitiesByBlocked"]
        self.assertEqual(len(blocked), 2)
        self.assertEqual(blocked[0]["publicCustomerId"], "cust-A")
        self.assertEqual(blocked[0]["blockedAmount"], 400.00)
        self.assertEqual(blocked[1]["publicCustomerId"], "cust-B")
        self.assertEqual(blocked[1]["blockedAmount"], 250.00)

    def test_top_rejection_reasons_aggregate_by_code(self) -> None:
        summary = build_dashboard_summary(self._sample(), reference_date=REF_DATE).to_dict()
        reasons = summary["topRejectionReasons"]
        self.assertEqual(len(reasons), 1)
        self.assertEqual(reasons[0]["reasonCode"], "REJ_MOTIF")
        self.assertEqual(reasons[0]["count"], 2)
        self.assertEqual(reasons[0]["blockedAmount"], 650.00)

    def test_recent_issues_include_rejected_and_action_required(self) -> None:
        summary = build_dashboard_summary(self._sample(), reference_date=REF_DATE).to_dict()
        issues = summary["recentIssues"]
        self.assertEqual(len(issues), 2)
        statuses = {entry["status"] for entry in issues}
        self.assertEqual(statuses, {"REJETEE", "A_RECYCLER"})
        # Tous doivent porter requiresAction=True (les deux sont ACTION_REQUIRED)
        self.assertTrue(all(entry["requiresAction"] for entry in issues))

    def test_api_health_computes_success_rate(self) -> None:
        audit_events = [
            {"action": "invoice.submit", "status": "success"},
            {"action": "invoice.submit", "status": "failed", "errorMessage": "boom", "timestamp": "2026-04-30T10:00:00Z"},
            {"action": "invoice.recycle", "status": "success"},
            {"action": "invoice.recycle", "status": "success"},
            {"action": "auth.login", "status": "success"},  # ignoré (hors actions API Chorus)
        ]
        summary = build_dashboard_summary(
            self._sample(),
            audit_events=audit_events,
            reference_date=REF_DATE,
        ).to_dict()
        api = summary["apiHealth"]
        self.assertEqual(api["totalCalls"], 4)
        self.assertEqual(api["successCount"], 3)
        self.assertEqual(api["failedCount"], 1)
        self.assertEqual(api["successRate"], 75.0)
        self.assertEqual(api["lastErrorMessage"], "boom")
        self.assertEqual(api["lastErrorAt"], "2026-04-30T10:00:00Z")

    def test_api_health_with_no_events(self) -> None:
        summary = build_dashboard_summary(self._sample(), reference_date=REF_DATE).to_dict()
        api = summary["apiHealth"]
        self.assertEqual(api["totalCalls"], 0)
        self.assertIsNone(api["successRate"])

    def test_insights_include_blocked_amount_and_oldest_bucket(self) -> None:
        summary = build_dashboard_summary(
            self._sample(),
            reference_date=REF_DATE,
            customers=[
                CustomerLookup(public_customer_id="cust-A", name="Région A"),
                CustomerLookup(public_customer_id="cust-B", name="Mairie B"),
            ],
        ).to_dict()
        titles = {insight["title"] for insight in summary["insights"]}
        self.assertIn("Montant immobilisé", titles)
        self.assertIn("Action requise", titles)
        self.assertIn("Entité la plus exposée", titles)
        self.assertIn("Dossiers anciens", titles)

    def test_empty_invoice_list_returns_safe_defaults(self) -> None:
        summary = build_dashboard_summary([], reference_date=REF_DATE).to_dict()
        self.assertEqual(summary["totals"]["invoiceCount"], 0)
        self.assertEqual(summary["statusDistribution"], [])
        self.assertEqual(summary["topEntitiesByBlocked"], [])
        self.assertEqual(summary["topRejectionReasons"], [])
        self.assertEqual(summary["recentIssues"], [])
        self.assertIsNone(summary["apiHealth"]["successRate"])
        self.assertEqual(summary["insights"], [])


if __name__ == "__main__":
    unittest.main()
