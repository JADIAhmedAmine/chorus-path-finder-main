from __future__ import annotations

import importlib.util
import os
import sys
import unittest
from pathlib import Path
from types import ModuleType

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


def _load_handler_module() -> ModuleType:
    module_path = REPO_ROOT / "scripts" / "chorus_submit_server.py"
    spec = importlib.util.spec_from_file_location("chorus_submit_server", module_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["chorus_submit_server"] = module
    os.environ["CHORUS_BRIDGE_SKIP_REEXEC"] = "1"
    spec.loader.exec_module(module)
    return module


try:
    handler_module = _load_handler_module()
except Exception as load_error:  # noqa: BLE001
    handler_module = None
    _LOAD_ERROR = load_error
else:
    _LOAD_ERROR = None


@unittest.skipIf(handler_module is None, f"chorus_submit_server indisponible: {_LOAD_ERROR}")
class BuildReceptionCompletePayloadTest(unittest.TestCase):
    def setUp(self) -> None:
        assert handler_module is not None
        self.build = handler_module._build_reception_complete_payload

    def test_minimal_comment_payload(self) -> None:
        payload, error = self.build({
            "identifiantFactureCPP": 8426157,
            "commentaire": "Complément depuis Chorus Pilot",
        })

        self.assertIsNone(error)
        self.assertEqual(payload, {
            "identifiantFactureCPP": 8426157,
            "commentaire": "Complément depuis Chorus Pilot",
        })

    def test_missing_identifier_is_rejected(self) -> None:
        payload, error = self.build({"commentaire": "test"})

        self.assertEqual(payload, {})
        assert error is not None
        self.assertEqual(error["category"], "VALIDATION")
        self.assertIn("identifiantFactureCPP", error["human_message"])

    def test_comment_or_attachment_is_required(self) -> None:
        payload, error = self.build({"identifiantFactureCPP": 8426157, "commentaire": "   "})

        self.assertEqual(payload, {})
        assert error is not None
        self.assertEqual(error["category"], "VALIDATION")
        self.assertIn("commentaire", error["raw_message"])

    def test_complementary_attachments_are_normalized(self) -> None:
        payload, error = self.build({
            "identifiantFactureCPP": 8426157,
            "pieceJointeComplementaire": [
                {
                    "pieceJointeComplementaireDesignation": "Justificatif complémentaire",
                    "pieceJointeComplementaireId": "10856620",
                    "pieceJointeComplementaireNumeroLigneFacture": "0",
                    "pieceJointeComplementaireType": "AUTRE",
                }
            ],
        })

        self.assertIsNone(error)
        self.assertEqual(payload["pieceJointeComplementaire"], [
            {
                "pieceJointeComplementaireDesignation": "Justificatif complémentaire",
                "pieceJointeComplementaireId": 10856620,
                "pieceJointeComplementaireNumeroLigneFacture": 0,
                "pieceJointeComplementaireType": "AUTRE",
            }
        ])

    def test_id_utilisateur_is_passed_through(self) -> None:
        payload, error = self.build({
            "identifiantFactureCPP": 8426157,
            "commentaire": "test",
            "idUtilisateurCourant": 42,
        })

        self.assertIsNone(error)
        self.assertEqual(payload["idUtilisateurCourant"], 42)

    def test_invalid_attachment_is_rejected(self) -> None:
        payload, error = self.build({
            "identifiantFactureCPP": 8426157,
            "pieceJointeComplementaire": [
                {
                    "pieceJointeComplementaireDesignation": "PJ",
                    "pieceJointeComplementaireType": "AUTRE",
                }
            ],
        })

        self.assertEqual(payload, {})
        assert error is not None
        self.assertEqual(error["category"], "VALIDATION")
        self.assertIn("pieceJointeComplementaireId", error["raw_message"])


if __name__ == "__main__":
    unittest.main()
