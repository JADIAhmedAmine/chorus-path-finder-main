from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from fastapi.testclient import TestClient  # noqa: E402

import scripts.chorus_submit_server as server  # noqa: E402
import chorus_python.chorus_flux_routes as flux_routes  # noqa: E402
import chorus_python.g2b_annuaire_client as ann  # noqa: E402
import chorus_python.g2b_routes_annuaire as ann_routes  # noqa: E402
from chorus_python.auth import require_submit_permission  # noqa: E402
from chorus_python.config import ChorusSettings  # noqa: E402
from chorus_python.g2b_annuaire_client import (
    G2BAnnuaireError,
    is_active_annuaire_result,
    normalize_siren,
    normalize_siret,
    validate_recipient,
)

ACTIVE_RECORD = {"siret": "70204275500240", "denomination": "MAIRIE DE X", "etatAdministratif": "A",
                 "adresse": {"ligne1": "1 place", "codePostal": "75001", "commune": "Paris"},
                 "gestionCodeService": True, "gestionEngagementJuridique": False}


def _fake_get_siret(http_status: int, raw):
    async def _fake(*args, **kwargs):
        return {"http_status": http_status, "siret": "70204275500240", "raw": raw}
    return _fake


def _fake_settings(environment_override=None):
    return ChorusSettings(base_url="https://x/cpro", api_key="KEY", cpro_account="Y2Y=")


class AnnuaireUnitTests(unittest.TestCase):
    def test_normalize_siren(self) -> None:
        self.assertEqual(normalize_siren("702 042 755"), "702042755")
        with self.assertRaises(G2BAnnuaireError):
            normalize_siren("123")

    def test_normalize_siret(self) -> None:
        self.assertEqual(normalize_siret("702 042 755 00240"), "70204275500240")
        with self.assertRaises(G2BAnnuaireError):
            normalize_siret("70204275500")

    def test_is_active(self) -> None:
        self.assertTrue(is_active_annuaire_result({"etatAdministratif": "A"}))
        self.assertFalse(is_active_annuaire_result({"etatAdministratif": "F"}))
        self.assertTrue(is_active_annuaire_result({"structureActive": True}))

    def test_validate_recipient_active_with_service_warning(self) -> None:
        original = ann.get_siret
        ann.get_siret = _fake_get_siret(200, ACTIVE_RECORD)
        try:
            result = asyncio.run(validate_recipient("https://a", "KEY", "Y2Y=", "70204275500240"))
        finally:
            ann.get_siret = original
        self.assertTrue(result["recipient"]["active"])
        self.assertEqual(result["recipient"]["denomination"], "MAIRIE DE X")
        self.assertTrue(result["recipient"]["rules"]["serviceCodeRequired"])
        # code service requis mais absent => WARNING (non strict)
        self.assertEqual(result["validation"]["severity"], "WARNING")

    def test_validate_recipient_service_required_strict_blocks(self) -> None:
        original = ann.get_siret
        ann.get_siret = _fake_get_siret(200, ACTIVE_RECORD)
        try:
            result = asyncio.run(validate_recipient("https://a", "KEY", "Y2Y=", "70204275500240", strict_service_code=True))
        finally:
            ann.get_siret = original
        self.assertEqual(result["validation"]["severity"], "BLOCKING")

    def test_validate_recipient_inactive_blocks(self) -> None:
        original = ann.get_siret
        ann.get_siret = _fake_get_siret(200, {**ACTIVE_RECORD, "etatAdministratif": "F", "gestionCodeService": False})
        try:
            result = asyncio.run(validate_recipient("https://a", "KEY", "Y2Y=", "70204275500240"))
        finally:
            ann.get_siret = original
        self.assertFalse(result["recipient"]["active"])
        self.assertEqual(result["validation"]["severity"], "BLOCKING")

    def test_validate_recipient_not_found_204(self) -> None:
        original = ann.get_siret
        ann.get_siret = _fake_get_siret(204, None)
        try:
            result = asyncio.run(validate_recipient("https://a", "KEY", "Y2Y=", "70204275500240"))
        finally:
            ann.get_siret = original
        self.assertFalse(result["recipient"]["active"])
        self.assertEqual(result["validation"]["severity"], "BLOCKING")
        self.assertTrue(any("annuaire" in e["message"].lower() for e in result["validation"]["errors"]))


class AnnuaireRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        server.app.dependency_overrides[require_submit_permission] = lambda: {"email": "t@e.com", "roleCode": "ADMINISTRATEUR"}
        self._orig_load = flux_routes.load_chorus_settings
        self._orig_validate = ann_routes.validate_recipient
        flux_routes.load_chorus_settings = _fake_settings
        self.client = TestClient(server.app)

    def tearDown(self) -> None:
        server.app.dependency_overrides.clear()
        flux_routes.load_chorus_settings = self._orig_load
        ann_routes.validate_recipient = self._orig_validate

    def test_validate_recipient_requires_siret(self) -> None:
        r = self.client.post("/api/g2b/annuaire/validate-recipient", json={})
        self.assertEqual(r.status_code, 400)

    def test_validate_recipient_route_ok(self) -> None:
        async def _fake(*args, **kwargs):
            return {"success": True, "recipient": {"siret": "70204275500240", "active": True, "denomination": "MAIRIE", "address": {}, "rules": {}},
                    "validation": {"severity": "OK", "errors": [], "warnings": [], "recommendations": []}, "raw": {}}
        ann_routes.validate_recipient = _fake
        r = self.client.post("/api/g2b/annuaire/validate-recipient", json={"siret": "70204275500240"})
        body = r.json()
        self.assertEqual(r.status_code, 200)
        self.assertTrue(body["recipient"]["active"])
        self.assertEqual(body["validation"]["severity"], "OK")
        # Aucun secret renvoyé.
        import json
        self.assertNotIn("y2y=", json.dumps(body).lower())


if __name__ == "__main__":
    unittest.main()
