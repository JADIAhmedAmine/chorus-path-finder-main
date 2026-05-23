from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from chorus_python.errors import (
    CATEGORY_AUTH,
    CATEGORY_BUSINESS_REJECTION,
    CATEGORY_NETWORK,
    CATEGORY_NOT_FOUND,
    CATEGORY_RATE_LIMIT,
    CATEGORY_STATUS_NOT_ALLOWED,
    CATEGORY_UNKNOWN,
    CATEGORY_VALIDATION,
    normalize_chorus_error,
)


class NormalizeChorusErrorTest(unittest.TestCase):
    def test_status_not_allowed_message_is_recognized(self) -> None:
        raw = (
            "GDP_MSG_11.001 - L'état de la demande de paiement vaut REJETEE. "
            "Les valeurs possibles sont BROUILLON, ERREUR_FOURNISSEUR_SUR_VALIDEUR ou A_RECYCLER"
        )
        normalized = normalize_chorus_error(raw, code_retour=20000)

        self.assertEqual(normalized.category, CATEGORY_STATUS_NOT_ALLOWED)
        self.assertEqual(normalized.severity, "HIGH")
        self.assertEqual(normalized.chorus_code, "GDP_MSG_11.001")
        self.assertEqual(normalized.code_retour, 20000)
        self.assertEqual(
            set(normalized.matched_states),
            {"BROUILLON", "ERREUR_FOURNISSEUR_SUR_VALIDEUR", "A_RECYCLER"},
        )
        payload = normalized.to_dict()
        self.assertIn("recommended_action", payload)
        self.assertEqual(payload["chorus_code"], "GDP_MSG_11.001")

    def test_keyword_rejection_message_falls_back_to_business_rejection(self) -> None:
        normalized = normalize_chorus_error("Facture rejetée par le destinataire public")
        self.assertEqual(normalized.category, CATEGORY_BUSINESS_REJECTION)
        self.assertEqual(normalized.severity, "HIGH")

    def test_siret_message_is_validation(self) -> None:
        normalized = normalize_chorus_error("Le SIRET 12345678900015 n'est pas reconnu.")
        self.assertEqual(normalized.category, CATEGORY_VALIDATION)
        self.assertEqual(normalized.severity, "MEDIUM")

    def test_auth_messages_are_critical(self) -> None:
        for raw in (
            "Token OAuth invalide",
            "401 Unauthorized",
        ):
            normalized = normalize_chorus_error(raw)
            self.assertEqual(normalized.category, CATEGORY_AUTH)
            self.assertEqual(normalized.severity, "CRITICAL")

    def test_rate_limit_message(self) -> None:
        normalized = normalize_chorus_error("HTTP 429 too many requests")
        self.assertEqual(normalized.category, CATEGORY_RATE_LIMIT)

    def test_network_message(self) -> None:
        normalized = normalize_chorus_error("Connection timeout")
        self.assertEqual(normalized.category, CATEGORY_NETWORK)

    def test_not_found_message(self) -> None:
        normalized = normalize_chorus_error("Facture introuvable côté Chorus")
        self.assertEqual(normalized.category, CATEGORY_NOT_FOUND)

    def test_unknown_message_returns_low_severity(self) -> None:
        normalized = normalize_chorus_error("Quelque chose d'inattendu")
        self.assertEqual(normalized.category, CATEGORY_UNKNOWN)
        self.assertEqual(normalized.severity, "LOW")
        self.assertIsNone(normalized.chorus_code)

    def test_none_message_returns_unknown(self) -> None:
        normalized = normalize_chorus_error(None)
        self.assertEqual(normalized.category, CATEGORY_UNKNOWN)
        self.assertEqual(normalized.raw_message, "")


if __name__ == "__main__":
    unittest.main()
