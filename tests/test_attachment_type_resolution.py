from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from chorus_python.client import ChorusClient
from chorus_python.config import ChorusSettings


FIXTURE_PATH = REPO_ROOT / "tests" / "fixtures" / "chorus_attachment_types_facture.json"


def _load_fixture() -> dict:
    with FIXTURE_PATH.open("r", encoding="utf-8") as fixture_file:
        return json.load(fixture_file)


def _build_client() -> ChorusClient:
    return ChorusClient(
        ChorusSettings(
            base_url="https://sandbox-api.piste.gouv.fr/cpro/factures",
            api_key="test-token",
            cpro_account="dGVzdDp0ZXN0",
        )
    )


class AttachmentTypeResolutionTest(unittest.TestCase):
    """Resolves UI codes against the real /v1/recuperer/typespj payload.

    Uses a fixture sampled from the live Chorus Pro response so resolution
    stays anchored to the actual codeTypePieceJointe and idTypePieceJointe
    values returned for typeObjet=FACTURE.
    """

    def setUp(self) -> None:
        self.fixture = _load_fixture()
        self.client = _build_client()

    def _resolve(self, value: str) -> str:
        with patch.object(
            ChorusClient,
            "_post_json",
            return_value=self.fixture,
        ):
            return self.client.resolve_attachment_type_code(value)

    def test_ui_codes_resolve_to_chorus_string_codes(self) -> None:
        cases = {
            "DIVERS": "DIVERS",
            "ATTESTATION": "ATTESTATION",
            "BC": "BC",
            "BL": "BL",
            "BORDEREAU_SUIVI": "BORDEREAU_SUIVI",
            "BORDEREAU_SUIVI_VALIDATION": "BORDEREAU_SUIVI_VALIDATION",
            "DEVIS": "DEVIS",
            "ECHEANCIER": "ECHEANCIER",
            "OS": "OS",
            "PVSF": "PVSF",
            "RIB": "RIB",
        }
        for ui_code, expected_code in cases.items():
            with self.subTest(ui_code=ui_code):
                self.assertEqual(self._resolve(ui_code), expected_code)

    def test_french_label_resolves_via_label_lookup(self) -> None:
        self.assertEqual(self._resolve("Bon de commande"), "BC")
        self.assertEqual(self._resolve("Document annexe"), "DIVERS")
        self.assertEqual(self._resolve("Procès-verbal de service fait ou de réception"), "PVSF")

    def test_label_lookup_ignores_accents_and_case(self) -> None:
        self.assertEqual(self._resolve("ECHEANCIER"), "ECHEANCIER")
        self.assertEqual(self._resolve("echeancier"), "ECHEANCIER")
        self.assertEqual(self._resolve("Echéancier"), "ECHEANCIER")

    def test_numeric_id_resolves_to_string_code(self) -> None:
        self.assertEqual(self._resolve("29"), "DIVERS")
        self.assertEqual(self._resolve("11003"), "PVSF")

    def test_unknown_value_is_returned_unchanged(self) -> None:
        self.assertEqual(self._resolve("UNKNOWN_TYPE"), "UNKNOWN_TYPE")

    def test_empty_value_returns_empty_without_calling_chorus(self) -> None:
        with patch.object(ChorusClient, "_post_json") as post:
            self.assertEqual(self.client.resolve_attachment_type_code(""), "")
            self.assertEqual(self.client.resolve_attachment_type_code("   "), "")
            post.assert_not_called()

    def test_attachment_types_are_cached_between_calls(self) -> None:
        with patch.object(
            ChorusClient,
            "_post_json",
            return_value=self.fixture,
        ) as post:
            self.client.resolve_attachment_type_code("BC")
            self.client.resolve_attachment_type_code("BL")
            self.client.resolve_attachment_type_code("DIVERS")
            self.assertEqual(post.call_count, 1)


if __name__ == "__main__":
    unittest.main()
