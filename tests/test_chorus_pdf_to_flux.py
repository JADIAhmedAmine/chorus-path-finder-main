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
import chorus_python.chorus_flux_routes as flux_routes  # noqa: E402
import chorus_python.chorus_pdf_to_flux_routes as pdf_routes  # noqa: E402
from chorus_python.auth import require_submit_permission  # noqa: E402
from chorus_python.chorus_flux_detector import detect_flux_file  # noqa: E402
from chorus_python.chorus_pdf_invoice_extractor import extract_invoice_draft  # noqa: E402
from chorus_python.chorus_pdf_to_flux_service import detect_pdf_for_flux, validate_draft  # noqa: E402
from chorus_python.chorus_ubl_generator import generate_ubl_invoice  # noqa: E402
from chorus_python.config import ChorusSettings  # noqa: E402


CII_XML = (
    b'<?xml version="1.0" encoding="UTF-8"?>'
    b'<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100">'
    b"</rsm:CrossIndustryInvoice>"
)


def _valid_draft() -> dict:
    return {
        "supplier": {"name": "ACME SARL", "siret": "12345678900012", "vat_number": "FR12345678901", "address": "1 rue X"},
        "customer": {"name": "MAIRIE", "siret": "11000201100044", "service_code": "SVC1", "engagement_number": "ENG9", "address": "2 av Y"},
        "invoice": {
            "invoice_number": "INV-2026-001", "invoice_date": "2026-05-26", "due_date": "2026-06-26",
            "currency": "EUR", "total_ht": 100.0, "total_tva": 20.0, "total_ttc": 120.0, "payment_terms": "30 jours",
        },
        "vat_breakdown": [{"vat_rate": 20.0, "base_amount": 100.0, "vat_amount": 20.0}],
        "lines": [{"description": "Conseil", "quantity": 2, "unit_price": 50.0, "vat_rate": 20.0, "line_total_ht": 100.0}],
        "chorus": {"cadre_facturation": None, "service_code": "SVC1", "engagement_number": "ENG9",
                   "format_flux_target": "IN_DP_E1_STRUCT", "syntaxe_flux_target": "IN_DP_E1_UBL_INVOICE"},
    }


def _make_facturx_pdf(xml_bytes: bytes) -> bytes:
    import fitz

    doc = fitz.open()
    doc.new_page()
    doc.embfile_add("factur-x.xml", xml_bytes)
    data = doc.tobytes()
    doc.close()
    return data


def _make_invoice_pdf(lines: list[str]) -> bytes:
    import fitz

    doc = fitz.open()
    page = doc.new_page()
    y = 72
    for line in lines:
        page.insert_text((72, y), line, fontsize=11)
        y += 20
    data = doc.tobytes()
    doc.close()
    return data


INVOICE_LINES = [
    "ACME SARL",
    "Facture n° INV-2026-001",
    "Date facture : 26/05/2026",
    "SIRET : 123 456 789 00012",
    "Client : MAIRIE DE PARIS",
    "SIRET 110 002 011 00044",
    "Total HT : 100,00 EUR",
    "TVA 20% : 20,00 EUR",
    "Total TTC : 120,00 EUR",
]


# ---------------------------------------------------------------------------
# Unitaires : détection / extraction / validation / génération
# ---------------------------------------------------------------------------
class PdfToFluxUnitTests(unittest.TestCase):
    def test_detect_facturx(self) -> None:
        result = detect_pdf_for_flux(_make_facturx_pdf(CII_XML), "invoice.pdf")
        self.assertEqual(result["pdf_type"], "FACTURX_CII")
        self.assertTrue(result["is_facturx"])
        self.assertTrue(result["direct_deposit_possible"])
        self.assertFalse(result["conversion_required"])

    def test_detect_normal_pdf(self) -> None:
        result = detect_pdf_for_flux(_make_invoice_pdf(INVOICE_LINES), "invoice.pdf")
        self.assertEqual(result["pdf_type"], "PDF_GENERIC")
        self.assertFalse(result["is_facturx"])
        self.assertTrue(result["conversion_required"])
        self.assertFalse(result["direct_deposit_possible"])

    def test_detect_invalid_file_raises(self) -> None:
        with self.assertRaises(ValueError):
            detect_pdf_for_flux(b"not a pdf at all", "note.txt")

    def test_extraction_fields(self) -> None:
        payload = extract_invoice_draft(_make_invoice_pdf(INVOICE_LINES), "invoice.pdf")
        draft = payload["draft"]
        self.assertEqual(draft["invoice"]["invoice_number"], "INV-2026-001")
        self.assertEqual(draft["invoice"]["invoice_date"], "2026-05-26")
        self.assertEqual(draft["supplier"]["siret"], "12345678900012")
        self.assertEqual(draft["customer"]["siret"], "11000201100044")
        self.assertEqual(draft["invoice"]["total_ht"], 100.0)
        self.assertEqual(draft["invoice"]["total_tva"], 20.0)
        self.assertEqual(draft["invoice"]["total_ttc"], 120.0)
        self.assertEqual(len(draft["lines"]), 1)  # ligne de repli

    def test_extraction_missing_customer_siret_warns(self) -> None:
        lines = ["ACME SARL", "Facture n° INV-1", "SIRET : 123 456 789 00012", "Total HT : 50,00"]
        payload = extract_invoice_draft(_make_invoice_pdf(lines), "invoice.pdf")
        self.assertIsNone(payload["draft"]["customer"]["siret"])
        self.assertTrue(any("client" in w.lower() for w in payload["warnings"]))

    def test_validate_valid_draft(self) -> None:
        result = validate_draft(_valid_draft())
        self.assertTrue(result["valid"])
        self.assertEqual(result["errors"], [])

    def test_validate_missing_customer_siret(self) -> None:
        draft = _valid_draft()
        draft["customer"]["siret"] = None
        result = validate_draft(draft)
        self.assertFalse(result["valid"])
        self.assertTrue(any(e["field"] == "customer.siret" for e in result["errors"]))

    def test_validate_inconsistent_totals(self) -> None:
        draft = _valid_draft()
        draft["invoice"]["total_ttc"] = 999.0
        result = validate_draft(draft)
        self.assertFalse(result["valid"])
        self.assertTrue(any(e["field"] == "invoice.total_ttc" for e in result["errors"]))

    def test_validate_no_lines_warns_but_valid(self) -> None:
        draft = _valid_draft()
        draft["lines"] = []
        result = validate_draft(draft)
        self.assertTrue(result["valid"])
        self.assertTrue(any(w["field"] == "lines" for w in result["warnings"]))

    def test_generate_ubl_detects_as_ubl(self) -> None:
        xml = generate_ubl_invoice(_valid_draft())
        detected = detect_flux_file(xml.encode("utf-8"), "generated_invoice_ubl.xml")
        self.assertEqual(detected["detected_file_type"], "UBL_INVOICE")
        self.assertEqual(detected["root_element"], "Invoice")
        self.assertIn("Invoice-2", detected["namespace"] or "")

    def test_generated_ubl_contains_tax_percent(self) -> None:
        xml = generate_ubl_invoice(_valid_draft())
        self.assertIn("<cbc:Percent>20.00</cbc:Percent>", xml)


# ---------------------------------------------------------------------------
# Intégration : routes FastAPI
# ---------------------------------------------------------------------------
def _fake_settings(environment_override=None):
    return ChorusSettings(base_url="https://x/cpro", api_key="KEY", cpro_account="Y2Y=")


class PdfToFluxRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        server.app.dependency_overrides[require_submit_permission] = lambda: {
            "email": "t@e.com", "roleCode": "ADMINISTRATEUR",
        }
        self._orig_load = flux_routes.load_chorus_settings
        self._orig_syntaxes = pdf_routes.recuperer_syntaxe_flux
        self._orig_deposer = pdf_routes.deposer_flux_facture
        flux_routes.load_chorus_settings = _fake_settings
        self.client = TestClient(server.app)
        self.valid_xml = generate_ubl_invoice(_valid_draft())

    def tearDown(self) -> None:
        server.app.dependency_overrides.clear()
        flux_routes.load_chorus_settings = self._orig_load
        pdf_routes.recuperer_syntaxe_flux = self._orig_syntaxes
        pdf_routes.deposer_flux_facture = self._orig_deposer

    def _set_syntaxes(self, syntaxes):
        async def _fake(format_flux, **kw):
            return {"http_status": 200, "codeRetour": 0, "libelle": "GCU", "listeSyntaxeFlux": syntaxes, "raw": {}}

        pdf_routes.recuperer_syntaxe_flux = lambda **kw: _fake(**kw)

    def _set_deposer(self, http_status=200, code_retour=0, raw=None):
        async def _fake(syntaxe_flux, **kw):
            return {
                "http_status": http_status, "codeRetour": code_retour, "libelle": "TRA_MSG_00.000",
                "dateDepot": "2026-05-26", "numeroFluxDepot": "FLX1", "syntaxeFlux": syntaxe_flux,
                "raw": raw if raw is not None else {"ok": 1},
            }

        pdf_routes.deposer_flux_facture = lambda **kw: _fake(**kw)

    @staticmethod
    def _assert_no_secrets(payload) -> None:
        text = json.dumps(payload).lower()
        assert "y2y=" not in text
        assert "bearer key" not in text
        assert '"authorization"' not in text

    def test_route_detect_normal_pdf(self) -> None:
        r = self.client.post(
            "/api/chorus/pdf-to-flux/detect",
            files={"file": ("invoice.pdf", _make_invoice_pdf(INVOICE_LINES), "application/pdf")},
        )
        body = r.json()
        self.assertEqual(r.status_code, 200)
        self.assertTrue(body["conversion_required"])
        self.assertFalse(body["direct_deposit_possible"])

    def test_route_detect_facturx(self) -> None:
        r = self.client.post(
            "/api/chorus/pdf-to-flux/detect",
            files={"file": ("invoice.pdf", _make_facturx_pdf(CII_XML), "application/pdf")},
        )
        body = r.json()
        self.assertTrue(body["is_facturx"])
        self.assertTrue(body["direct_deposit_possible"])

    def test_route_extract_fills_draft(self) -> None:
        r = self.client.post(
            "/api/chorus/pdf-to-flux/extract",
            files={"file": ("invoice.pdf", _make_invoice_pdf(INVOICE_LINES), "application/pdf")},
        )
        body = r.json()
        self.assertTrue(body["success"])
        self.assertEqual(body["draft"]["invoice"]["invoice_number"], "INV-2026-001")

    def test_route_validate_draft(self) -> None:
        r = self.client.post("/api/chorus/pdf-to-flux/validate-draft", json={"draft": _valid_draft()})
        self.assertTrue(r.json()["valid"])

    def test_route_generate_xml(self) -> None:
        r = self.client.post(
            "/api/chorus/pdf-to-flux/generate-xml",
            json={"draft": _valid_draft(), "target": {"formatFlux": "IN_DP_E1_STRUCT", "syntaxeFlux": "IN_DP_E1_UBL_INVOICE"}},
        )
        body = r.json()
        self.assertTrue(body["success"])
        self.assertEqual(body["generated"]["detected_file_type"], "UBL_INVOICE")
        self.assertIn("<Invoice", body["generated"]["xml_preview"])

    def test_route_generate_xml_blocks_invalid_draft(self) -> None:
        draft = _valid_draft()
        draft["customer"]["siret"] = None
        r = self.client.post(
            "/api/chorus/pdf-to-flux/generate-xml",
            json={"draft": draft, "target": {"formatFlux": "IN_DP_E1_STRUCT", "syntaxeFlux": "IN_DP_E1_UBL_INVOICE"}},
        )
        self.assertEqual(r.status_code, 422)
        self.assertFalse(r.json()["success"])

    def test_route_generate_xml_blocks_when_vat_rate_missing(self) -> None:
        # TVA due (20) mais aucun taux disponible (ventilation + lignes sans taux).
        draft = _valid_draft()
        draft["vat_breakdown"] = []
        draft["lines"] = [{"description": "x", "quantity": 1, "unit_price": 100.0, "vat_rate": None, "line_total_ht": 100.0}]
        r = self.client.post(
            "/api/chorus/pdf-to-flux/generate-xml",
            json={"draft": draft, "target": {"formatFlux": "IN_DP_E1_STRUCT", "syntaxeFlux": "IN_DP_E1_UBL_INVOICE"}},
        )
        self.assertEqual(r.status_code, 422)
        self.assertIn("taux de TVA", r.json()["error"])

    def test_route_validate_xml_ubl_ok(self) -> None:
        r = self.client.post(
            "/api/chorus/pdf-to-flux/validate-xml",
            json={"xml": self.valid_xml, "syntaxeFlux": "IN_DP_E1_UBL_INVOICE"},
        )
        body = r.json()
        self.assertTrue(body["valid"])
        self.assertEqual(body["detected"]["detected_file_type"], "UBL_INVOICE")

    def test_route_validate_xml_cii_syntax_blocked(self) -> None:
        r = self.client.post(
            "/api/chorus/pdf-to-flux/validate-xml",
            json={"xml": self.valid_xml, "syntaxeFlux": "IN_DP_E1_CII_16B"},
        )
        self.assertFalse(r.json()["valid"])

    def test_route_deposer_generated_accepted(self) -> None:
        self._set_syntaxes(["IN_DP_E1_UBL_INVOICE"])
        self._set_deposer(code_retour=0)
        r = self.client.post(
            "/api/chorus/pdf-to-flux/deposer-generated",
            json={"xml": self.valid_xml, "formatFlux": "IN_DP_E1_STRUCT", "syntaxeFlux": "IN_DP_E1_UBL_INVOICE"},
        )
        body = r.json()
        self.assertEqual(r.status_code, 200)
        self.assertEqual(body["status_local"], "ACCEPTED")
        self.assertEqual(body["numeroFluxDepot"], "FLX1")
        self._assert_no_secrets(body)

    def test_route_deposer_generated_rejected(self) -> None:
        self._set_syntaxes(["IN_DP_E1_UBL_INVOICE"])
        self._set_deposer(code_retour=7)
        r = self.client.post(
            "/api/chorus/pdf-to-flux/deposer-generated",
            json={"xml": self.valid_xml, "formatFlux": "IN_DP_E1_STRUCT", "syntaxeFlux": "IN_DP_E1_UBL_INVOICE"},
        )
        self.assertEqual(r.json()["status_local"], "REJECTED")

    def test_route_deposer_generated_blocks_non_ubl(self) -> None:
        async def _must_not_call(**kw):  # pragma: no cover
            raise AssertionError("deposer must not be called for non-UBL xml")

        pdf_routes.deposer_flux_facture = lambda **kw: _must_not_call(**kw)
        pivot = '<?xml version="1.0"?><CPPFacturePivot><x/></CPPFacturePivot>'
        r = self.client.post(
            "/api/chorus/pdf-to-flux/deposer-generated",
            json={"xml": pivot, "formatFlux": "IN_DP_E1_STRUCT", "syntaxeFlux": "IN_DP_E1_UBL_INVOICE"},
        )
        self.assertEqual(r.status_code, 422)
        self.assertEqual(r.json()["status_local"], "BLOCKED_LOCAL_VALIDATION")

    def test_route_deposer_generated_http_error_explained(self) -> None:
        self._set_syntaxes(["IN_DP_E1_UBL_INVOICE"])
        self._set_deposer(http_status=401, code_retour=1, raw={"error": "unauthorized"})
        r = self.client.post(
            "/api/chorus/pdf-to-flux/deposer-generated",
            json={"xml": self.valid_xml, "formatFlux": "IN_DP_E1_STRUCT", "syntaxeFlux": "IN_DP_E1_UBL_INVOICE"},
        )
        body = r.json()
        self.assertEqual(body["status_local"], "ERROR")
        self.assertEqual(body["explanation"]["category"], "AUTH")
        self._assert_no_secrets(body)


if __name__ == "__main__":
    unittest.main()
