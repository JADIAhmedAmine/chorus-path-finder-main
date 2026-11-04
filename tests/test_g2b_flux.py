from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from fastapi.testclient import TestClient  # noqa: E402

import scripts.chorus_submit_server as server  # noqa: E402
import chorus_python.chorus_flux_routes as flux_routes  # noqa: E402
import chorus_python.g2b_routes_flux as g2b_routes  # noqa: E402
from chorus_python.auth import require_submit_permission  # noqa: E402
from chorus_python.config import ChorusSettings  # noqa: E402
from chorus_python.g2b_error_explainer import explain_g2b_error  # noqa: E402
from chorus_python.g2b_flux_client import compute_checksum  # noqa: E402
from chorus_python.g2b_recommendation import build_g2b_recommendation, recommend_g2b_code_interface  # noqa: E402

NS = (
    'xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" '
    'xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" '
    'xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"'
)
_ADDR = ("<cac:PostalAddress><cbc:StreetName>1 rue X</cbc:StreetName><cbc:CityName>Paris</cbc:CityName>"
         "<cbc:PostalZone>75001</cbc:PostalZone><cac:Country><cbc:IdentificationCode>FR</cbc:IdentificationCode></cac:Country></cac:PostalAddress>")

UBL_OK = (
    f'<?xml version="1.0"?><Invoice {NS}><cbc:ID>G2B-1</cbc:ID><cbc:IssueDate>2026-05-26</cbc:IssueDate>'
    "<cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>"
    f"<cac:AccountingSupplierParty><cac:Party><cac:PartyIdentification><cbc:ID>32242033407300</cbc:ID></cac:PartyIdentification>"
    f"<cac:PartyName><cbc:Name>ACME</cbc:Name></cac:PartyName>{_ADDR}</cac:Party></cac:AccountingSupplierParty>"
    f"<cac:AccountingCustomerParty><cac:Party><cac:PartyIdentification><cbc:ID>11000201100044</cbc:ID></cac:PartyIdentification>"
    f"<cac:PartyName><cbc:Name>MAIRIE</cbc:Name></cac:PartyName>{_ADDR}</cac:Party></cac:AccountingCustomerParty>"
    '<cac:TaxTotal><cbc:TaxAmount currencyID="EUR">20.00</cbc:TaxAmount>'
    '<cac:TaxSubtotal><cbc:TaxableAmount currencyID="EUR">100.00</cbc:TaxableAmount>'
    '<cbc:TaxAmount currencyID="EUR">20.00</cbc:TaxAmount><cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>20.00</cbc:Percent>'
    '<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>'
    '<cac:LegalMonetaryTotal><cbc:TaxExclusiveAmount currencyID="EUR">100.00</cbc:TaxExclusiveAmount>'
    '<cbc:TaxInclusiveAmount currencyID="EUR">120.00</cbc:TaxInclusiveAmount></cac:LegalMonetaryTotal></Invoice>'
).encode()

UBL_NO_PERCENT = UBL_OK.replace(b"<cbc:Percent>20.00</cbc:Percent>", b"")
PIVOT_XML = b'<?xml version="1.0"?><CPPFacturePivot><x/></CPPFacturePivot>'

SIRET_ALLOWLIST = {
    "allowed_supplier_sirets": ["32242033407300"], "allowed_supplier_internal_ids": [],
    "default_supplier_siret": "32242033407300", "supplier_dp_enabled": True, "strict": False,
}


def _fake_settings(environment_override=None):
    return ChorusSettings(base_url="https://x/cpro", api_key="KEY", cpro_account="Y2Y=")


class G2BUnitTests(unittest.TestCase):
    def test_recommendation_ubl(self) -> None:
        self.assertEqual(recommend_g2b_code_interface("UBL_INVOICE"), "FSO3110A")
        self.assertEqual(build_g2b_recommendation("UBL_INVOICE")["status"], "recommended")

    def test_recommendation_facturx(self) -> None:
        self.assertEqual(recommend_g2b_code_interface("FACTURX_CII"), "FSO3117A")

    def test_recommendation_pdf_generic_blocked(self) -> None:
        self.assertEqual(build_g2b_recommendation("PDF_GENERIC")["status"], "blocked")

    def test_recommendation_business_blocking_overrides(self) -> None:
        reco = build_g2b_recommendation("UBL_INVOICE", business_severity="BLOCKING")
        self.assertEqual(reco["status"], "blocked")
        self.assertEqual(reco["recommendedCodeInterface"], "FSO3110A")

    def test_checksum_modes(self) -> None:
        import base64
        raw = compute_checksum(b"abc", base64.b64encode(b"abc").decode(), "raw")
        b64 = compute_checksum(b"abc", base64.b64encode(b"abc").decode(), "base64")
        self.assertNotEqual(raw, b64)
        self.assertEqual(len(raw), 64)

    def test_explain_404_temporary(self) -> None:
        out = explain_g2b_error({}, http_status=404)
        self.assertEqual(out["severity"], "warning")
        self.assertIn("pas encore traité", out["friendlyMessage"])

    def test_explain_irrecevable(self) -> None:
        out = explain_g2b_error({}, remote_status="IRRECEVABLE")
        self.assertIn("irrecevable", out["friendlyMessage"].lower())

    def test_explain_tax_percent(self) -> None:
        out = explain_g2b_error("L'element TaxTotal.TaxSubtotal.Percent.value est obligatoire.")
        self.assertEqual(out["technicalSource"], "TaxTotal.TaxSubtotal.TaxCategory.Percent")


class G2BRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        server.app.dependency_overrides[require_submit_permission] = lambda: {"email": "t@e.com", "roleCode": "ADMINISTRATEUR"}
        self._orig_load = flux_routes.load_chorus_settings
        self._orig_cfg = g2b_routes.load_g2b_supplier_config
        self._orig_deposit = g2b_routes.deposit_g2b_flux
        self._orig_status = g2b_routes.get_g2b_flux_status
        flux_routes.load_chorus_settings = _fake_settings
        g2b_routes.load_g2b_supplier_config = lambda env=None: dict(SIRET_ALLOWLIST)
        self.client = TestClient(server.app)

    def tearDown(self) -> None:
        server.app.dependency_overrides.clear()
        flux_routes.load_chorus_settings = self._orig_load
        g2b_routes.load_g2b_supplier_config = self._orig_cfg
        g2b_routes.deposit_g2b_flux = self._orig_deposit
        g2b_routes.get_g2b_flux_status = self._orig_status

    def _set_deposit(self, http_status=200, uid="uid-123"):
        async def _fake(*args, **kwargs):
            return {"http_status": http_status, "uidFlux": uid, "checksum": "abc", "checksumMode": "raw", "codeInterface": args[5] if len(args) > 5 else "FSO3110A", "raw": {"uidFlux": uid}}
        g2b_routes.deposit_g2b_flux = _fake

    def _set_status(self, http_status=200, statut="RECEVABLE"):
        async def _fake(*args, **kwargs):
            return {"http_status": http_status, "statut": statut, "dateMajStatut": "2026-05-31T17:35:23Z", "nomFlux": "f", "raw": {"statut": statut}}
        g2b_routes.get_g2b_flux_status = _fake

    def test_detect_ubl_recommends_fso3110a(self) -> None:
        r = self.client.post("/api/g2b/flux/detect", files={"file": ("f.xml", UBL_OK, "application/xml")})
        body = r.json()
        self.assertEqual(body["detected"]["fileType"], "UBL_INVOICE")
        self.assertEqual(body["recommendation"]["recommendedCodeInterface"], "FSO3110A")

    def test_detect_pivot_blocked(self) -> None:
        r = self.client.post("/api/g2b/flux/detect", files={"file": ("f.xml", PIVOT_XML, "application/xml")})
        self.assertEqual(r.json()["recommendation"]["status"], "blocked")

    def test_business_validate_reports_missing_percent(self) -> None:
        r = self.client.post("/api/g2b/flux/business-validate", files={"file": ("f.xml", UBL_NO_PERCENT, "application/xml")})
        body = r.json()
        codes = [e["code"] for e in body["businessValidation"]["errors"]]
        self.assertIn("TAX_SUBTOTAL_PERCENT_MISSING", codes)

    def test_deposit_blocked_missing_percent(self) -> None:
        async def _must_not_call(*a, **k):  # pragma: no cover
            raise AssertionError("deposit must not be called when business BLOCKING")
        g2b_routes.deposit_g2b_flux = _must_not_call
        r = self.client.post("/api/g2b/flux/deposit", data={"code_interface": "FSO3110A"}, files={"file": ("f.xml", UBL_NO_PERCENT, "application/xml")})
        self.assertEqual(r.status_code, 422)
        self.assertEqual(r.json()["statusLocal"], "BLOCKED_BUSINESS_VALIDATION")

    def test_deposit_blocked_pivot(self) -> None:
        r = self.client.post("/api/g2b/flux/deposit", data={"code_interface": "FSO3110A"}, files={"file": ("f.xml", PIVOT_XML, "application/xml")})
        self.assertEqual(r.status_code, 422)
        self.assertEqual(r.json()["statusLocal"], "BLOCKED_LOCAL_VALIDATION")

    def test_deposit_unknown_code_interface(self) -> None:
        r = self.client.post("/api/g2b/flux/deposit", data={"code_interface": "FSO9999Z"}, files={"file": ("f.xml", UBL_OK, "application/xml")})
        self.assertEqual(r.status_code, 400)

    def test_deposit_success_with_force(self) -> None:
        # Annuaire indisponible -> WARNING ; force=true autorise le dépôt.
        self._set_deposit(uid="uid-OK")
        r = self.client.post("/api/g2b/flux/deposit", data={"code_interface": "FSO3110A", "force": "true"}, files={"file": ("f.xml", UBL_OK, "application/xml")})
        body = r.json()
        self.assertEqual(r.status_code, 200)
        self.assertEqual(body["statusLocal"], "SUBMITTED")
        self.assertEqual(body["uidFlux"], "uid-OK")
        self.assertNotIn("y2y=", __import__("json").dumps(body).lower())

    def test_status_404_temporary(self) -> None:
        self._set_status(http_status=404, statut=None)
        r = self.client.get("/api/g2b/flux/uid-1/status")
        body = r.json()
        self.assertTrue(body["temporary"])
        self.assertEqual(body["status"], "PROCESSING_NOT_AVAILABLE_YET")

    def test_status_recevable(self) -> None:
        self._set_status(http_status=200, statut="RECEVABLE")
        r = self.client.get("/api/g2b/flux/uid-1/status")
        self.assertEqual(r.json()["status"], "RECEVABLE")

    def test_status_irrecevable_explained(self) -> None:
        self._set_status(http_status=200, statut="IRRECEVABLE")
        body = self.client.get("/api/g2b/flux/uid-1/status").json()
        self.assertEqual(body["status"], "IRRECEVABLE")
        self.assertIn("explanation", body)


if __name__ == "__main__":
    unittest.main()
