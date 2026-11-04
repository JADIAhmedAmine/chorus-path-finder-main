from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from chorus_python.recycle_policy import (
    InvalidRecyclePayloadError,
    prepare_recycle_payload,
)


def base_payload() -> dict[str, object]:
    return {
        "destinataire": {"codeDestinataire": "32242033407300"},
        "identifiantFactureCPP": 8426157,
    }


class RecyclePayloadPolicyTest(unittest.TestCase):
    def test_accepts_recipient_siret_correction(self) -> None:
        payload = base_payload()
        payload["destinataire"] = {"codeDestinataire": "  13002526500013  "}

        prepared = prepare_recycle_payload(payload)

        self.assertEqual(
            prepared["destinataire"],
            {"codeDestinataire": "13002526500013"},
        )

    def test_accepts_recipient_service_correction(self) -> None:
        payload = base_payload()
        payload["destinataire"] = {
            "codeDestinataire": "32242033407300",
            "codeServiceExecutant": " SERVICE-FACTURES ",
        }

        prepared = prepare_recycle_payload(payload)

        self.assertEqual(
            prepared["destinataire"]["codeServiceExecutant"],
            "SERVICE-FACTURES",
        )

    def test_accepts_legal_commitment_or_purchase_order_correction(self) -> None:
        payload = base_payload()
        payload["reference"] = {"numeroBonCommande": " EJ-2026-0042 "}

        prepared = prepare_recycle_payload(payload)

        self.assertEqual(
            prepared["reference"],
            {"numeroBonCommande": "EJ-2026-0042"},
        )

    def test_rejects_amount_modification(self) -> None:
        payload = base_payload()
        payload["montantTotal"] = {"montantTtcTotal": 1200}

        with self.assertRaises(InvalidRecyclePayloadError) as context:
            prepare_recycle_payload(payload)

        self.assertEqual(context.exception.field, "montantTotal")

    def test_rejects_vat_modification(self) -> None:
        payload = base_payload()
        payload["reference"] = {"typeTva": "TVA_SUR_DEBIT"}

        with self.assertRaises(InvalidRecyclePayloadError) as context:
            prepare_recycle_payload(payload)

        self.assertEqual(context.exception.field, "reference.typeTva")

    def test_rejects_invoice_number_modification(self) -> None:
        payload = base_payload()
        payload["numeroFacture"] = "FAC-2026-CORRIGEE"

        with self.assertRaises(InvalidRecyclePayloadError) as context:
            prepare_recycle_payload(payload)

        self.assertEqual(context.exception.field, "numeroFacture")

    def test_rejects_arbitrary_comment_at_public_endpoint_boundary(self) -> None:
        payload = base_payload()
        payload["commentaire"] = "Modifier aussi les lignes"

        with self.assertRaises(InvalidRecyclePayloadError) as context:
            prepare_recycle_payload(payload)

        self.assertEqual(context.exception.field, "commentaire")


if __name__ == "__main__":
    unittest.main()
