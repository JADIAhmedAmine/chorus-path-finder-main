from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from fastapi.testclient import TestClient  # noqa: E402

import scripts.chorus_submit_server as server  # noqa: E402
import chorus_python.chorus_flux_routes as routes  # noqa: E402
from chorus_python.auth import require_submit_permission  # noqa: E402
from chorus_python.config import ChorusSettings  # noqa: E402


UBL_XML = (
    b'<?xml version="1.0"?>'
    b'<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><ID>1</ID></Invoice>'
)
PIVOT_XML = b'<?xml version="1.0"?><CPPFacturePivot><x/></CPPFacturePivot>'


def _fake_settings(environment_override=None):
    return ChorusSettings(base_url="https://x/cpro", api_key="KEY", cpro_account="Y2Y=")


class FluxRoutesTests(unittest.TestCase):
    def setUp(self) -> None:
        server.app.dependency_overrides[require_submit_permission] = lambda: {
            "email": "t@e.com",
            "roleCode": "ADMINISTRATEUR",
        }
        self._orig = {
            "load": routes.load_chorus_settings,
            "formats": routes.recuperer_format_flux,
            "syntaxes": routes.recuperer_syntaxe_flux,
            "deposer": routes.deposer_flux_facture,
        }
        routes.load_chorus_settings = _fake_settings
        self.client = TestClient(server.app)

    def tearDown(self) -> None:
        server.app.dependency_overrides.clear()
        routes.load_chorus_settings = self._orig["load"]
        routes.recuperer_format_flux = self._orig["formats"]
        routes.recuperer_syntaxe_flux = self._orig["syntaxes"]
        routes.deposer_flux_facture = self._orig["deposer"]

    def _set_syntaxes(self, syntaxes):
        async def _fake(format_flux, **kw):
            return {
                "http_status": 200,
                "codeRetour": 0,
                "libelle": "GCU",
                "listeSyntaxeFlux": syntaxes,
                "raw": {},
            }

        routes.recuperer_syntaxe_flux = lambda **kw: _fake(**kw)

    def _set_deposer(self, http_status=200, code_retour=0, raw=None):
        async def _fake(syntaxe_flux, **kw):
            return {
                "http_status": http_status,
                "codeRetour": code_retour,
                "libelle": "TRA_MSG_00.000",
                "dateDepot": "2026-05-26",
                "numeroFluxDepot": "FLX1",
                "syntaxeFlux": syntaxe_flux,
                "raw": raw if raw is not None else {"ok": 1},
            }

        routes.deposer_flux_facture = lambda **kw: _fake(**kw)

    @staticmethod
    def _assert_no_secrets(payload) -> None:
        # The credential VALUES must never be returned. (User-facing guidance may
        # mention the header name "cpro-account" — that is not a leak.)
        text = json.dumps(payload).lower()
        assert "y2y=" not in text  # the fake cpro-account base64 value
        assert "bearer key" not in text  # the fake bearer token
        assert '"authorization"' not in text

    def test_formats(self) -> None:
        async def _fake(**kw):
            return {"http_status": 200, "codeRetour": 0, "libelle": "T",
                    "listeFormatFlux": ["IN_DP_E1_STRUCT", "IN_DP_E2_MIXTE"], "raw": {}}

        routes.recuperer_format_flux = lambda **kw: _fake(**kw)
        r = self.client.post("/api/chorus/flux/formats", json={"environment": "qualif"})
        body = r.json()
        self.assertEqual(r.status_code, 200)
        self.assertTrue(body["success"])
        self.assertEqual(body["formats"], ["IN_DP_E1_STRUCT", "IN_DP_E2_MIXTE"])
        self._assert_no_secrets(body)

    def test_syntaxes_requires_format(self) -> None:
        r = self.client.post("/api/chorus/flux/syntaxes", json={"formatFlux": ""})
        self.assertEqual(r.status_code, 400)

    def test_detect_ubl(self) -> None:
        r = self.client.post(
            "/api/chorus/flux/detect",
            data={"syntaxe_flux": "IN_DP_E1_UBL_INVOICE"},
            files={"file": ("f.xml", UBL_XML, "application/xml")},
        )
        body = r.json()
        self.assertEqual(r.status_code, 200)
        self.assertEqual(body["detected"]["detected_file_type"], "UBL_INVOICE")
        self.assertEqual(body["compatibility"]["severity"], "OK")

    def test_deposer_accepted(self) -> None:
        self._set_syntaxes(["IN_DP_E1_UBL_INVOICE"])
        self._set_deposer(code_retour=0)
        r = self.client.post(
            "/api/chorus/flux/deposer",
            data={"format_flux": "IN_DP_E1_STRUCT", "syntaxe_flux": "IN_DP_E1_UBL_INVOICE"},
            files={"file": ("f.xml", UBL_XML, "application/xml")},
        )
        body = r.json()
        self.assertEqual(r.status_code, 200)
        self.assertEqual(body["status_local"], "ACCEPTED")
        self.assertTrue(body["success"])
        self.assertEqual(body["detected"]["detected_file_type"], "UBL_INVOICE")
        self._assert_no_secrets(body)

    def test_deposer_rejected_code_retour(self) -> None:
        self._set_syntaxes(["IN_DP_E1_UBL_INVOICE"])
        self._set_deposer(code_retour=7)
        r = self.client.post(
            "/api/chorus/flux/deposer",
            data={"format_flux": "IN_DP_E1_STRUCT", "syntaxe_flux": "IN_DP_E1_UBL_INVOICE"},
            files={"file": ("f.xml", UBL_XML, "application/xml")},
        )
        body = r.json()
        self.assertEqual(body["status_local"], "REJECTED")
        self.assertFalse(body["success"])

    def test_deposer_pivot_blocked_locally(self) -> None:
        # Deposer must NOT be called for a pivot output file.
        async def _must_not_call(**kw):  # pragma: no cover
            raise AssertionError("deposer_flux_facture must not be called for pivot")

        routes.deposer_flux_facture = lambda **kw: _must_not_call(**kw)
        r = self.client.post(
            "/api/chorus/flux/deposer",
            data={"format_flux": "IN_DP_E1_STRUCT", "syntaxe_flux": "IN_DP_E1_UBL_INVOICE", "force": "true"},
            files={"file": ("FEN0036A.xml", PIVOT_XML, "application/xml")},
        )
        body = r.json()
        self.assertEqual(r.status_code, 422)
        self.assertEqual(body["status_local"], "BLOCKED_LOCAL_VALIDATION")
        self.assertEqual(body["detected"]["detected_file_type"], "CHORUS_PIVOT_OUTPUT")
        self.assertEqual(body["compatibility"]["severity"], "BLOCKING")

    def test_deposer_family_mismatch_blocked(self) -> None:
        self._set_syntaxes(["IN_DP_E1_CII_16B"])
        r = self.client.post(
            "/api/chorus/flux/deposer",
            data={"format_flux": "IN_DP_E1_STRUCT", "syntaxe_flux": "IN_DP_E1_CII_16B"},
            files={"file": ("f.xml", UBL_XML, "application/xml")},
        )
        body = r.json()
        self.assertEqual(r.status_code, 422)
        self.assertEqual(body["status_local"], "BLOCKED_LOCAL_VALIDATION")

    def test_deposer_http_error_explained(self) -> None:
        self._set_syntaxes(["IN_DP_E1_UBL_INVOICE"])
        self._set_deposer(http_status=401, code_retour=1, raw={"error": "unauthorized"})
        r = self.client.post(
            "/api/chorus/flux/deposer",
            data={"format_flux": "IN_DP_E1_STRUCT", "syntaxe_flux": "IN_DP_E1_UBL_INVOICE"},
            files={"file": ("f.xml", UBL_XML, "application/xml")},
        )
        body = r.json()
        self.assertEqual(body["status_local"], "ERROR")
        self.assertIsNotNone(body["explanation"])
        self.assertEqual(body["explanation"]["category"], "AUTH")
        self._assert_no_secrets(body)


if __name__ == "__main__":
    unittest.main()
