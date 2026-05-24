from __future__ import annotations

import sys
import unittest
from datetime import date
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from chorus_python.config import ChorusSettings
from chorus_python.db import sync as sync_module


class _NestedTransaction:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class _FakeSession:
    def add(self, _item):
        pass

    def flush(self):
        pass

    def begin_nested(self):
        return _NestedTransaction()


class _FakeChorusClient:
    def __init__(self):
        self.payloads: list[dict] = []

    def search_supplier_invoices(self, payload: dict):
        self.payloads.append(payload)
        if len(self.payloads) == 1:
            return {"parametresRetour": {"total": 10}, "factures": []}
        return {
            "parametresRetour": {"total": 10},
            "factures": [
                {
                    "identifiantFactureCPP": "CPP-1",
                    "numeroFacture": "F-001",
                    "statut": "MISE_EN_PAIEMENT",
                    "montantTTC": "120.00",
                }
            ],
        }


class _FakeStorageSession:
    def __init__(self, *, by_pk: dict[str, object] | None = None, scalar_value=None):
        self.by_pk = by_pk or {}
        self.scalar_value = scalar_value

    def get(self, _model, key: str):
        return self.by_pk.get(key)

    def scalar(self, _statement):
        return self.scalar_value


class _FakePersistSession:
    def __init__(self, invoice):
        self.invoice = invoice
        self.flushed = False

    def get(self, _model, key: str):
        return self.invoice if key == self.invoice.id else None

    def scalar(self, _statement):
        return None

    def flush(self):
        self.flushed = True


class InvoiceSyncTest(unittest.TestCase):
    def test_delta_refreshes_recent_invoices_even_when_remote_count_is_not_greater(self) -> None:
        settings = ChorusSettings(
            base_url="https://api.piste.gouv.fr/cpro",
            api_key="test",
            cpro_account="test",
        )
        session = _FakeSession()
        client = _FakeChorusClient()

        with (
            patch.object(sync_module, "ensure_tenant", return_value=None),
            patch.object(sync_module, "_try_advisory_xact_lock", return_value=True),
            patch.object(
                sync_module,
                "_ensure_local_supplier_for_chorus_id",
                return_value="supplier-1",
            ),
            patch.object(sync_module, "_count_local_invoices", return_value=10),
            patch.object(sync_module, "_upsert_invoice", return_value=True) as upsert_invoice,
        ):
            run = sync_module.sync_invoices_for_supplier(
                session,
                settings=settings,
                client=client,
                tenant_id="tenant-1",
                supplier_id="123",
                mode="delta",
            )

        self.assertEqual(len(client.payloads), 2)
        self.assertEqual(
            client.payloads[1]["rechercheFactureParFournisseur"]["nbResultatsParPage"],
            sync_module.DEFAULT_RECENT_PAGE_SIZE,
        )
        self.assertEqual(run.rows_fetched, 1)
        self.assertEqual(run.rows_upserted, 1)
        self.assertEqual(run.payload_summary["remote_total"], 10)
        self.assertEqual(run.payload_summary["refreshed_existing"], 1)
        self.assertNotIn("skipped", run.payload_summary)
        upsert_invoice.assert_called_once()

    def test_resolve_invoice_storage_id_reuses_existing_supplier_invoice_number(self) -> None:
        session = _FakeStorageSession(scalar_value="supplier-1::F-001")

        invoice_id, existing = sync_module._resolve_invoice_storage_id(
            session,
            tenant_id="tenant-1",
            local_supplier_id="supplier-1",
            supplier_invoice_number="F-001",
            invoice={"identifiantFactureCPP": "CPP-1", "numeroFacture": "F-001"},
        )

        self.assertEqual(invoice_id, "supplier-1::F-001")
        self.assertTrue(existing)

    def test_invoice_supplier_invoice_number_accepts_chorus_fallback_identifiers(self) -> None:
        cases = [
            ({"numeroDemandePaiement": "DP-001"}, "DP-001"),
            ({"numeroFactureChorus": "CHORUS-001"}, "CHORUS-001"),
            ({"identifiantFactureCPP": "CPP-001"}, "CPP-001"),
            ({"idFacture": 12345}, "12345"),
        ]

        for invoice, expected in cases:
            with self.subTest(invoice=invoice):
                self.assertEqual(
                    sync_module._invoice_supplier_invoice_number(invoice),
                    expected,
                )

    def test_resolve_invoice_storage_id_prefers_existing_chorus_primary_key(self) -> None:
        session = _FakeStorageSession(
            by_pk={"chorus-CPP-1": object()},
            scalar_value="supplier-1::F-001",
        )

        invoice_id, existing = sync_module._resolve_invoice_storage_id(
            session,
            tenant_id="tenant-1",
            local_supplier_id="supplier-1",
            supplier_invoice_number="F-001",
            invoice={"identifiantFactureCPP": "CPP-1", "numeroFacture": "F-001"},
        )

        self.assertEqual(invoice_id, "chorus-CPP-1")
        self.assertTrue(existing)

    def test_normalize_chorus_status_internal(self) -> None:
        cases = {
            "MISE_EN_PAIEMENT": "PAID",
            "REJETEE": "REJECTED_BUSINESS",
            "TECHNIQUE_INCONNU": "REJECTED_TECHNICAL",
            "MISE_A_DISPOSITION": "ACCEPTED_BY_CHORUS",
            "DEPOSEE": "SUBMITTED_TO_CHORUS",
        }

        for status, expected in cases.items():
            with self.subTest(status=status):
                self.assertEqual(
                    sync_module._normalize_chorus_status_internal(status),
                    expected,
                )

    def test_persist_reception_invoice_detail_stores_raw_and_normalized_detail(self) -> None:
        invoice = SimpleNamespace(
            id="chorus-8429597",
            tenant_id="tenant-1",
            raw_payload={"identifiantFactureCPP": 8429597, "statut": "REJETEE"},
        )
        session = _FakePersistSession(invoice)
        facture = {
            "identifiantFactureCPP": 8429597,
            "numeroFacture": "EST-2025-00018",
            "statutFacture": "MISE_A_DISPOSITION",
        }
        normalized = {
            "identifiantFactureCPP": 8429597,
            "numeroFacture": "EST-2025-00018",
            "statutFacture": "MISE_A_DISPOSITION",
            "modeDepot": "DEPOT_PDF_PORTAIL",
            "rejetTraite": False,
            "fournisseur": {
                "id": "26359578",
                "siret": "12345678901234",
                "raisonSociale": "Fournisseur détail",
                "codeService": None,
            },
            "destinataire": {
                "id": "32242033407300",
                "siret": "32242033407300",
                "raisonSociale": "Destinataire détail",
                "codeService": "SFACT",
            },
            "dates": {
                "dateFacture": "2025-01-15",
                "dateDepot": "2026-05-23",
                "dateEcheancePaiement": "2026-06-30",
            },
            "montants": {
                "ht": 1146.0,
                "tva": 229.2,
                "ttc": 1375.2,
                "aPayer": 1375.2,
                "devise": "EUR",
            },
            "references": {
                "numeroBonCommande": "BC-001",
                "numeroMarche": "M-001",
                "typeFacture": "FACTURE",
            },
            "piecesJointes": [{"pieceJointeId": "PJ-1"}],
        }

        persisted = sync_module.persist_reception_invoice_detail(
            session,
            tenant_id="tenant-1",
            identifier=8429597,
            facture=facture,
            normalized_invoice=normalized,
        )

        self.assertTrue(persisted)
        self.assertTrue(session.flushed)
        self.assertEqual(invoice.raw_payload["receptionDetail"], facture)
        self.assertEqual(invoice.raw_payload["receptionNormalized"], normalized)
        self.assertEqual(invoice.chorus_invoice_number, "8429597")
        self.assertEqual(invoice.supplier_invoice_number, "EST-2025-00018")
        self.assertEqual(invoice.status_chorus, "MISE_A_DISPOSITION")
        self.assertEqual(invoice.status_internal, "ACCEPTED_BY_CHORUS")
        self.assertEqual(invoice.invoice_date, date(2025, 1, 15))
        self.assertEqual(invoice.due_date, date(2026, 6, 30))
        self.assertEqual(invoice.total_ttc, Decimal("1375.2"))
        self.assertEqual(invoice.amount_to_pay, Decimal("1375.2"))
        self.assertEqual(invoice.supplier_chorus_name, "Fournisseur détail")
        self.assertEqual(invoice.recipient_chorus_name, "Destinataire détail")
        self.assertEqual(invoice.service_chorus_code, "SFACT")
        self.assertFalse(invoice.rejection_processed)
        self.assertEqual(invoice.attachment_count, 1)


if __name__ == "__main__":
    unittest.main()
