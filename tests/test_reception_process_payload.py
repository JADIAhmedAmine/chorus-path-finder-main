from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from types import ModuleType

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


def _load_handler_module() -> ModuleType:
    """Charge le module handler en évitant son re-exec automatique."""
    module_path = REPO_ROOT / "scripts" / "chorus_submit_server.py"
    spec = importlib.util.spec_from_file_location("chorus_submit_server", module_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["chorus_submit_server"] = module
    # Évite le redémarrage automatique dans l'environnement courant.
    import os

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
class BuildReceptionProcessPayloadTest(unittest.TestCase):
    def setUp(self) -> None:
        assert handler_module is not None
        self.build = handler_module._build_reception_process_payload

    def test_minimal_valid_payload(self) -> None:
        payload, error = self.build({"idFacture": 8429592, "nouveauStatut": "MISE_EN_PAIEMENT"})
        self.assertIsNone(error)
        self.assertEqual(payload["idFacture"], 8429592)
        self.assertEqual(payload["nouveauStatut"], "MISE_EN_PAIEMENT")
        self.assertNotIn("motif", payload)
        self.assertNotIn("numeroDPMandat", payload)
        self.assertNotIn("idUtilisateurCourant", payload)

    def test_lowercase_statut_is_normalized(self) -> None:
        payload, error = self.build({"idFacture": 1, "nouveauStatut": "service_fait"})
        self.assertIsNone(error)
        self.assertEqual(payload["nouveauStatut"], "SERVICE_FAIT")

    def test_rejection_requires_motif(self) -> None:
        payload, error = self.build({"idFacture": 1, "nouveauStatut": "REJETEE"})
        self.assertEqual(payload, {})
        assert error is not None
        self.assertEqual(error["category"], "VALIDATION")
        self.assertIn("motif", error["raw_message"].lower())

    def test_suspension_requires_motif(self) -> None:
        payload, error = self.build({"idFacture": 1, "nouveauStatut": "SUSPENDUE"})
        self.assertEqual(payload, {})
        assert error is not None
        self.assertIn("motif", error["raw_message"].lower())

    def test_rejection_with_motif_is_valid_and_includes_optional_fields(self) -> None:
        payload, error = self.build(
            {
                "idFacture": 8429592,
                "nouveauStatut": "REJETEE",
                "motif": "Pièce jointe manquante",
                "numeroDPMandat": "DPM-001",
                "idUtilisateurCourant": 42,
            }
        )
        self.assertIsNone(error)
        self.assertEqual(payload["motif"], "Pièce jointe manquante")
        self.assertEqual(payload["numeroDPMandat"], "DPM-001")
        self.assertEqual(payload["idUtilisateurCourant"], 42)

    def test_unknown_status_is_rejected(self) -> None:
        payload, error = self.build({"idFacture": 1, "nouveauStatut": "MISE_A_DISPTION"})
        self.assertEqual(payload, {})
        assert error is not None
        self.assertIn("MISE_A_DISPTION", error["raw_message"])

    def test_missing_id_is_rejected(self) -> None:
        payload, error = self.build({"nouveauStatut": "MISE_EN_PAIEMENT"})
        self.assertEqual(payload, {})
        assert error is not None
        self.assertIn("idFacture", error["human_message"])

    def test_camel_case_numerodpmandat_alias(self) -> None:
        payload, error = self.build(
            {"idFacture": 1, "nouveauStatut": "MISE_EN_PAIEMENT", "numeroDpMandat": "DP-002"}
        )
        self.assertIsNone(error)
        self.assertEqual(payload["numeroDPMandat"], "DP-002")


if __name__ == "__main__":
    unittest.main()
