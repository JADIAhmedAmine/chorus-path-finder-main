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
class BuildTelechargerGroupePayloadTest(unittest.TestCase):
    def setUp(self) -> None:
        assert handler_module is not None
        self.build = handler_module._build_telecharger_groupe_payload

    def test_single_id_default_format_is_pdf(self) -> None:
        payload, error = self.build({"idFacture": 8429592})
        self.assertIsNone(error)
        self.assertEqual(payload["format"], "PDF")
        self.assertEqual(payload["listeFacture"], [{"idFacture": 8429592}])
        # Par défaut, "Voir PDF" doit rester un PDF inline, sans archive de PJ.
        self.assertEqual(payload["avecPiecesJointesComplementaires"], "Non")

    def test_lowercase_format_is_uppercased(self) -> None:
        payload, error = self.build({"idFacture": 1, "format": "xml"})
        self.assertIsNone(error)
        self.assertEqual(payload["format"], "PIVOT")

    def test_zip_format_maps_to_pdf_with_attachments(self) -> None:
        payload, error = self.build({"idFacture": 1, "format": "ZIP"})
        self.assertIsNone(error)
        self.assertEqual(payload["format"], "PDF")
        self.assertEqual(payload["avecPiecesJointesComplementaires"], "Oui")

    def test_liste_facture_form_is_accepted(self) -> None:
        payload, error = self.build({"listeFacture": [{"idFacture": 1}, {"idFacture": 2}]})
        self.assertIsNone(error)
        self.assertEqual(payload["listeFacture"], [{"idFacture": 1}, {"idFacture": 2}])

    def test_missing_id_is_rejected(self) -> None:
        payload, error = self.build({"format": "PDF"})
        self.assertEqual(payload, {})
        assert error is not None
        self.assertEqual(error["category"], "VALIDATION")
        self.assertIn("idFacture", error["human_message"])

    def test_unknown_format_is_rejected(self) -> None:
        payload, error = self.build({"idFacture": 1, "format": "DOCX"})
        self.assertEqual(payload, {})
        assert error is not None
        self.assertIn("DOCX", error["human_message"])

    def test_optional_id_espace_and_user_are_passed_through(self) -> None:
        payload, error = self.build(
            {"idFacture": 1, "format": "PDF", "idEspace": 7, "idUtilisateurCourant": 42}
        )
        self.assertIsNone(error)
        self.assertEqual(payload["idEspace"], 7)
        self.assertEqual(payload["idUtilisateurCourant"], 42)

    def test_string_avec_pj_normalization(self) -> None:
        payload_true, _ = self.build({"idFacture": 1, "avecPiecesJointesComplementaires": "true"})
        payload_false, _ = self.build({"idFacture": 1, "avecPiecesJointesComplementaires": "Non"})
        self.assertEqual(payload_true["avecPiecesJointesComplementaires"], "Oui")
        self.assertEqual(payload_false["avecPiecesJointesComplementaires"], "Non")


if __name__ == "__main__":
    unittest.main()
