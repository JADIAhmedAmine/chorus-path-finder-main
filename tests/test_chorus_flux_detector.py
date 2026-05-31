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
    extract_flux_metadata,
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

UBL_FULL_XML = (
    b'<?xml version="1.0" encoding="UTF-8"?>'
    b'<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"'
    b' xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"'
    b' xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">'
    b"<cbc:ID>INV-2026-001</cbc:ID><cbc:IssueDate>2026-05-26</cbc:IssueDate>"
    b"<cbc:DueDate>2026-06-26</cbc:DueDate><cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>"
    b"<cac:AccountingSupplierParty><cac:Party>"
    b"<cac:PartyName><cbc:Name>ACME SARL</cbc:Name></cac:PartyName>"
    b"<cac:PartyLegalEntity><cbc:RegistrationName>ACME SARL</cbc:RegistrationName>"
    b"<cbc:CompanyID>12345678900012</cbc:CompanyID></cac:PartyLegalEntity>"
    b"</cac:Party></cac:AccountingSupplierParty>"
    b"<cac:AccountingCustomerParty><cac:Party><cac:PartyLegalEntity>"
    b"<cbc:RegistrationName>MINISTERE</cbc:RegistrationName>"
    b"<cbc:CompanyID>11000201100044</cbc:CompanyID></cac:PartyLegalEntity>"
    b"</cac:Party></cac:AccountingCustomerParty>"
    b'<cac:TaxTotal><cbc:TaxAmount currencyID="EUR">20.00</cbc:TaxAmount></cac:TaxTotal>'
    b"<cac:LegalMonetaryTotal>"
    b'<cbc:TaxExclusiveAmount currencyID="EUR">100.00</cbc:TaxExclusiveAmount>'
    b'<cbc:TaxInclusiveAmount currencyID="EUR">120.00</cbc:TaxInclusiveAmount>'
    b"</cac:LegalMonetaryTotal></Invoice>"
)

CII_FULL_XML = (
    b'<?xml version="1.0" encoding="UTF-8"?>'
    b'<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"'
    b' xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"'
    b' xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">'
    b"<rsm:ExchangedDocument><ram:ID>CII-2026-7</ram:ID>"
    b'<ram:IssueDateTime><udt:DateTimeString format="102">20260526</udt:DateTimeString></ram:IssueDateTime>'
    b"</rsm:ExchangedDocument><rsm:SupplyChainTradeTransaction>"
    b"<ram:ApplicableHeaderTradeAgreement>"
    b"<ram:SellerTradeParty><ram:Name>Vendeur CII</ram:Name>"
    b'<ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">98765432100018</ram:ID>'
    b"</ram:SpecifiedLegalOrganization></ram:SellerTradeParty>"
    b"<ram:BuyerTradeParty><ram:Name>Acheteur Public</ram:Name></ram:BuyerTradeParty>"
    b"</ram:ApplicableHeaderTradeAgreement><ram:ApplicableHeaderTradeSettlement>"
    b"<ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>"
    b"<ram:SpecifiedTradeSettlementHeaderMonetarySummation>"
    b"<ram:TaxBasisTotalAmount>200.00</ram:TaxBasisTotalAmount>"
    b'<ram:TaxTotalAmount currencyID="EUR">40.00</ram:TaxTotalAmount>'
    b"<ram:GrandTotalAmount>240.00</ram:GrandTotalAmount>"
    b"</ram:SpecifiedTradeSettlementHeaderMonetarySummation>"
    b"</ram:ApplicableHeaderTradeSettlement></rsm:SupplyChainTradeTransaction>"
    b"</rsm:CrossIndustryInvoice>"
)


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


class MetadataTests(unittest.TestCase):
    def test_ubl_invoice_fields(self) -> None:
        meta = extract_flux_metadata(UBL_FULL_XML, "ubl.xml")
        self.assertEqual(meta["document"]["kind"], "xml")
        self.assertEqual(meta["document"]["encoding"], "UTF-8")
        self.assertEqual(meta["xml"]["source"], "file")
        self.assertEqual(meta["xml"]["root_element"], "Invoice")
        invoice = meta["invoice"]
        self.assertEqual(invoice["invoice_number"], "INV-2026-001")
        self.assertEqual(invoice["issue_date"], "2026-05-26")
        self.assertEqual(invoice["due_date"], "2026-06-26")
        self.assertEqual(invoice["currency"], "EUR")
        self.assertEqual(invoice["seller_name"], "ACME SARL")
        self.assertEqual(invoice["seller_id"], "12345678900012")
        self.assertEqual(invoice["buyer_name"], "MINISTERE")
        self.assertEqual(invoice["buyer_id"], "11000201100044")
        self.assertEqual(invoice["total_ht"], 100.0)
        self.assertEqual(invoice["total_tva"], 20.0)
        self.assertEqual(invoice["total_ttc"], 120.0)

    def test_cii_invoice_fields_with_compact_date(self) -> None:
        meta = extract_flux_metadata(CII_FULL_XML, "cii.xml")
        invoice = meta["invoice"]
        self.assertEqual(invoice["invoice_number"], "CII-2026-7")
        self.assertEqual(invoice["issue_date"], "2026-05-26")  # 20260526 normalisé
        self.assertEqual(invoice["seller_name"], "Vendeur CII")
        self.assertEqual(invoice["seller_id"], "98765432100018")
        self.assertEqual(invoice["total_ht"], 200.0)
        self.assertEqual(invoice["total_tva"], 40.0)
        self.assertEqual(invoice["total_ttc"], 240.0)

    def test_facturx_pdf_metadata_and_embedded_invoice(self) -> None:
        pdf = _make_facturx_pdf(CII_FULL_XML)
        detected = detect_flux_file(pdf, "facturx.pdf")
        meta = extract_flux_metadata(pdf, "facturx.pdf", detected)
        self.assertEqual(meta["document"]["kind"], "pdf")
        self.assertEqual(meta["document"]["page_count"], 1)
        self.assertEqual(meta["document"]["pdf_version"], "1.7")
        names = [a["name"] for a in meta["document"]["attachments"]]
        self.assertIn("factur-x.xml", names)
        self.assertEqual(meta["xml"]["source"], "embedded")
        self.assertEqual(meta["xml"]["root_element"], "CrossIndustryInvoice")
        # Les champs facture proviennent du XML CII embarqué.
        self.assertEqual(meta["invoice"]["invoice_number"], "CII-2026-7")
        self.assertEqual(meta["invoice"]["total_ttc"], 240.0)

    def test_plain_pdf_has_document_metadata_without_invoice(self) -> None:
        meta = extract_flux_metadata(_make_plain_pdf(), "scan.pdf")
        self.assertEqual(meta["document"]["kind"], "pdf")
        self.assertEqual(meta["document"]["page_count"], 1)
        self.assertIsNone(meta["xml"])
        self.assertIsNone(meta["invoice"])


if __name__ == "__main__":
    unittest.main()
