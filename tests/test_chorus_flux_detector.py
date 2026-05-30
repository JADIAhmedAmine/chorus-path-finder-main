from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from chorus_python.chorus_flux_detector import (  # noqa: E402
    CHORUS_LIFECYCLE_STATUS_OUTPUT,
    CHORUS_PIVOT_OUTPUT,
    CII_INVOICE,
    CPP_FACTURE_MIXTE,
    FACTURX_CII,
    PDF_GENERIC,
    SEVERITY_BLOCKING,
    SEVERITY_OK,
    UBL_INVOICE,
    detect_flux_file,
    evaluate_flux_compatibility,
    explain_chorus_flux_error,
)


UBL_XML = (
    b'<?xml version="1.0" encoding="UTF-8"?>'
    b'<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">'
    b"<ID>1</ID></Invoice>"
)
CII_XML = (
    b'<?xml version="1.0" encoding="UTF-8"?>'
    b'<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100">'
    b"</rsm:CrossIndustryInvoice>"
)
CPP_MIXTE_XML = b'<?xml version="1.0"?><CPPFactureMixte><x/></CPPFactureMixte>'
CPP_PIVOT_XML = b'<?xml version="1.0"?><CPPFacturePivot><x/></CPPFacturePivot>'
CPP_STATUT_XML = b'<?xml version="1.0"?><CPPStatut><x/></CPPStatut>'


def _make_facturx_pdf(xml_bytes: bytes) -> bytes:
    import fitz  # PyMuPDF

    doc = fitz.open()
    doc.new_page()
    doc.embfile_add("factur-x.xml", xml_bytes)
    data = doc.tobytes()
    doc.close()
    return data


def _make_plain_pdf() -> bytes:
    import fitz

    doc = fitz.open()
    doc.new_page()
    data = doc.tobytes()
    doc.close()
    return data


class DetectorTests(unittest.TestCase):
    def test_ubl_invoice(self) -> None:
        detected = detect_flux_file(UBL_XML, "FSO1100A.xml")
        self.assertEqual(detected["detected_file_type"], UBL_INVOICE)
        self.assertEqual(detected["root_element"], "Invoice")
        self.assertIn("Invoice-2", detected["namespace"] or "")
        self.assertTrue(detected["is_deposit_compatible"])

    def test_cii_invoice(self) -> None:
        detected = detect_flux_file(CII_XML, "FSO1106A.xml")
        self.assertEqual(detected["detected_file_type"], CII_INVOICE)
        self.assertEqual(detected["root_element"], "CrossIndustryInvoice")

    def test_cpp_facture_mixte(self) -> None:
        detected = detect_flux_file(CPP_MIXTE_XML, "FSO1113A.xml")
        self.assertEqual(detected["detected_file_type"], CPP_FACTURE_MIXTE)

    def test_cpp_facture_pivot_is_output(self) -> None:
        detected = detect_flux_file(CPP_PIVOT_XML, "FEN0036A.xml")
        self.assertEqual(detected["detected_file_type"], CHORUS_PIVOT_OUTPUT)
        self.assertFalse(detected["is_deposit_compatible"])

    def test_cpp_statut_is_output(self) -> None:
        detected = detect_flux_file(CPP_STATUT_XML, "FEN1200A.xml")
        self.assertEqual(detected["detected_file_type"], CHORUS_LIFECYCLE_STATUS_OUTPUT)
        self.assertFalse(detected["is_deposit_compatible"])

    def test_pdf_facturx(self) -> None:
        pdf = _make_facturx_pdf(CII_XML)
        detected = detect_flux_file(pdf, "FSO1117A.pdf")
        self.assertEqual(detected["detected_file_type"], FACTURX_CII)
        self.assertTrue(detected["is_facturx"])
        self.assertEqual(detected["embedded_xml_filename"], "factur-x.xml")
        self.assertEqual(detected["embedded_xml_root"], "CrossIndustryInvoice")

    def test_pdf_without_embedded_xml(self) -> None:
        pdf = _make_plain_pdf()
        detected = detect_flux_file(pdf, "scan.pdf")
        self.assertEqual(detected["detected_file_type"], PDF_GENERIC)
        self.assertFalse(detected["is_deposit_compatible"])


class CompatibilityTests(unittest.TestCase):
    def _sev(self, detected_type: str, syntaxe: str) -> str:
        return evaluate_flux_compatibility(detected_type, None, syntaxe)["severity"]

    def test_matrix(self) -> None:
        self.assertEqual(self._sev(UBL_INVOICE, "IN_DP_E1_UBL_INVOICE"), SEVERITY_OK)
        self.assertEqual(self._sev(UBL_INVOICE, "IN_DP_E1_CII_16B"), SEVERITY_BLOCKING)
        self.assertEqual(self._sev(CII_INVOICE, "IN_DP_E1_CII_16B"), SEVERITY_OK)
        # Raw XML CII must not be deposited as Factur-X.
        self.assertEqual(self._sev(CII_INVOICE, "IN_DP_E2_CII_FACTURX"), SEVERITY_BLOCKING)
        self.assertEqual(self._sev(FACTURX_CII, "IN_DP_E2_CII_FACTURX"), SEVERITY_OK)
        self.assertEqual(self._sev(CPP_FACTURE_MIXTE, "IN_DP_E2_CPP_FACTURE_MIN"), SEVERITY_OK)
        self.assertEqual(self._sev(CPP_FACTURE_MIXTE, "IN_DP_E2_UBL_INVOICE_MIN"), SEVERITY_BLOCKING)
        self.assertEqual(self._sev(CHORUS_PIVOT_OUTPUT, "IN_DP_E1_UBL_INVOICE"), SEVERITY_BLOCKING)
        self.assertEqual(self._sev(CHORUS_LIFECYCLE_STATUS_OUTPUT, "IN_DP_E1_UBL_INVOICE"), SEVERITY_BLOCKING)

    def test_recommended_from_live_list(self) -> None:
        compat = evaluate_flux_compatibility(
            UBL_INVOICE,
            "IN_DP_E1_STRUCT",
            "IN_DP_E1_CII_16B",
            allowed_syntaxes_for_format=["IN_DP_E1_UBL_INVOICE", "IN_DP_E1_CII_16B"],
        )
        self.assertEqual(compat["recommendedSyntaxes"], ["IN_DP_E1_UBL_INVOICE"])


class ExplainErrorTests(unittest.TestCase):
    def test_schema_mismatch(self) -> None:
        result = explain_chorus_flux_error(
            "cvc-elt.1.a: Cannot find the declaration of element 'CPPFacturePivot'"
        )
        self.assertEqual(result["category"], "SCHEMA_MISMATCH")

    def test_http_401(self) -> None:
        self.assertEqual(explain_chorus_flux_error({}, None, http_status=401)["category"], "AUTH")

    def test_http_415(self) -> None:
        self.assertEqual(
            explain_chorus_flux_error({}, None, http_status=415)["category"], "UNSUPPORTED_MEDIA_TYPE"
        )

    def test_code_retour(self) -> None:
        result = explain_chorus_flux_error({"codeRetour": 5}, None, code_retour=5, libelle="X")
        self.assertEqual(result["category"], "CODE_RETOUR")


if __name__ == "__main__":
    unittest.main()
