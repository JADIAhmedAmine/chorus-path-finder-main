from __future__ import annotations

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
from chorus_python.chorus_flux_business_validator import validate_flux_business_rules  # noqa: E402
from chorus_python.chorus_flux_detector import explain_chorus_flux_error  # noqa: E402
from chorus_python.config import ChorusSettings  # noqa: E402

NS = (
    'xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" '
    'xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" '
    'xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"'
)

PERMISSIVE = {"allowed_supplier_sirets": [], "allowed_supplier_internal_ids": [], "default_supplier_siret": None, "supplier_dp_enabled": True, "strict": False}
ALLOWLIST = {"allowed_supplier_sirets": ["32242033407300"], "allowed_supplier_internal_ids": ["26359578"], "default_supplier_siret": "32242033407300", "supplier_dp_enabled": True, "strict": False}
STRICT_ALLOWLIST = {**ALLOWLIST, "strict": True}
INTERNAL_ONLY = {"allowed_supplier_sirets": [], "allowed_supplier_internal_ids": ["26359578"], "default_supplier_siret": None, "supplier_dp_enabled": True, "strict": False}


def _addr(tag_prefix: str) -> str:
    return (
        "<cac:PostalAddress><cbc:StreetName>1 rue X</cbc:StreetName><cbc:CityName>Paris</cbc:CityName>"
        "<cbc:PostalZone>75001</cbc:PostalZone><cac:Country><cbc:IdentificationCode>FR</cbc:IdentificationCode></cac:Country>"
        "</cac:PostalAddress>"
    )


def ubl(supplier_id="32242033407300", supplier_addr=True, customer_id="11000201100044", customer_addr=True) -> bytes:
    sup_id = f"<cac:PartyIdentification><cbc:ID>{supplier_id}</cbc:ID></cac:PartyIdentification>" if supplier_id else ""
    cus_id = f"<cac:PartyIdentification><cbc:ID>{customer_id}</cbc:ID></cac:PartyIdentification>" if customer_id else ""
    return (
        f'<?xml version="1.0" encoding="UTF-8"?><Invoice {NS}>'
        "<cbc:ID>INV-1</cbc:ID><cbc:IssueDate>2026-05-26</cbc:IssueDate>"
        "<cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>"
        f"<cac:AccountingSupplierParty><cac:Party>{sup_id}"
        f"<cac:PartyName><cbc:Name>ACME</cbc:Name></cac:PartyName>{_addr('s') if supplier_addr else ''}"
        "</cac:Party></cac:AccountingSupplierParty>"
        f"<cac:AccountingCustomerParty><cac:Party>{cus_id}"
        f"<cac:PartyName><cbc:Name>MAIRIE</cbc:Name></cac:PartyName>{_addr('c') if customer_addr else ''}"
        "</cac:Party></cac:AccountingCustomerParty>"
        '<cac:TaxTotal><cbc:TaxAmount currencyID="EUR">20.00</cbc:TaxAmount></cac:TaxTotal>'
        '<cac:LegalMonetaryTotal><cbc:TaxExclusiveAmount currencyID="EUR">100.00</cbc:TaxExclusiveAmount>'
        '<cbc:TaxInclusiveAmount currencyID="EUR">120.00</cbc:TaxInclusiveAmount></cac:LegalMonetaryTotal>'
        "</Invoice>"
    ).encode()


def ubl_with_subtotal(tax_category_inner: str) -> bytes:
    """UBL complet avec un cac:TaxSubtotal dont le contenu de TaxCategory varie."""
    addr = ("<cac:PostalAddress><cbc:StreetName>1 rue X</cbc:StreetName><cbc:CityName>Paris</cbc:CityName>"
            "<cbc:PostalZone>75001</cbc:PostalZone><cac:Country><cbc:IdentificationCode>FR</cbc:IdentificationCode></cac:Country></cac:PostalAddress>")
    return (
        f'<?xml version="1.0"?><Invoice {NS}><cbc:ID>TST-BV-OK-002</cbc:ID><cbc:IssueDate>2026-05-26</cbc:IssueDate>'
        "<cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>"
        f"<cac:AccountingSupplierParty><cac:Party><cac:PartyIdentification><cbc:ID>32242033407300</cbc:ID></cac:PartyIdentification>"
        f"<cac:PartyName><cbc:Name>ACME</cbc:Name></cac:PartyName>{addr}</cac:Party></cac:AccountingSupplierParty>"
        f"<cac:AccountingCustomerParty><cac:Party><cac:PartyIdentification><cbc:ID>11000201100044</cbc:ID></cac:PartyIdentification>"
        f"<cac:PartyName><cbc:Name>MAIRIE</cbc:Name></cac:PartyName>{addr}</cac:Party></cac:AccountingCustomerParty>"
        '<cac:TaxTotal><cbc:TaxAmount currencyID="EUR">20.00</cbc:TaxAmount>'
        '<cac:TaxSubtotal><cbc:TaxableAmount currencyID="EUR">100.00</cbc:TaxableAmount>'
        f'<cbc:TaxAmount currencyID="EUR">20.00</cbc:TaxAmount><cac:TaxCategory><cbc:ID>S</cbc:ID>{tax_category_inner}'
        '<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>'
        '<cac:LegalMonetaryTotal><cbc:TaxExclusiveAmount currencyID="EUR">100.00</cbc:TaxExclusiveAmount>'
        '<cbc:TaxInclusiveAmount currencyID="EUR">120.00</cbc:TaxInclusiveAmount></cac:LegalMonetaryTotal></Invoice>'
    ).encode()


CII_XML = (
    b'<?xml version="1.0" encoding="UTF-8"?>'
    b'<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"'
    b' xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100">'
    b"<rsm:ExchangedDocument><ram:ID>CII-1</ram:ID></rsm:ExchangedDocument></rsm:CrossIndustryInvoice>"
)


def _codes(items):
    return [item["code"] for item in items]


class BusinessValidatorUnitTests(unittest.TestCase):
    def test_missing_supplier_address_blocks(self) -> None:
        bv = validate_flux_business_rules(ubl(supplier_addr=False), "f.xml", supplier_config=ALLOWLIST)["business_validation"]
        self.assertFalse(bv["valid"])
        self.assertEqual(bv["severity"], "BLOCKING")
        self.assertIn("SUPPLIER_ADDRESS_MISSING", _codes(bv["errors"]))
        self.assertFalse(bv["checks"]["supplier_address_present"])

    def test_missing_customer_address_blocks(self) -> None:
        bv = validate_flux_business_rules(ubl(customer_addr=False), "f.xml", supplier_config=ALLOWLIST)["business_validation"]
        self.assertIn("CUSTOMER_ADDRESS_MISSING", _codes(bv["errors"]))

    # Scénario A : SIRET du XML autorisé -> contrôle fournisseur OK.
    def test_a_supplier_siret_allowed_ok(self) -> None:
        bv = validate_flux_business_rules(ubl(supplier_id="32242033407300"), "f.xml", supplier_config=STRICT_ALLOWLIST,
                                          annuaire_lookup={"11000201100044": {"active": True}})["business_validation"]
        supplier_codes = [c for c in _codes(bv["errors"]) + _codes(bv["warnings"]) if c.startswith("SUPPLIER_ID") or c.startswith("SUPPLIER_SIRET")]
        self.assertEqual(supplier_codes, [])
        self.assertTrue(bv["checks"]["supplier_identifier_known"])
        self.assertEqual(bv["extracted"]["supplier_identifier_type"], "SIRET")
        self.assertEqual(bv["extracted"]["supplier_business_identifier"], "32242033407300")
        self.assertEqual(bv["extracted"]["supplier_sirets_configured"], ["32242033407300"])

    # Scénario B : seul un ID interne est configuré -> avertissement, jamais SUPPLIER_SIRET_NOT_ALLOWED.
    def test_b_only_internal_id_warns_not_blocking(self) -> None:
        bv = validate_flux_business_rules(ubl(supplier_id="32242033407300"), "f.xml", supplier_config=INTERNAL_ONLY)["business_validation"]
        self.assertIn("SUPPLIER_SIRET_NOT_CONFIGURED", _codes(bv["warnings"]))
        self.assertNotIn("SUPPLIER_SIRET_NOT_ALLOWED", _codes(bv["errors"]))
        self.assertNotIn("SUPPLIER_SIRET_NOT_ALLOWED", _codes(bv["warnings"]))
        self.assertEqual(bv["extracted"]["supplier_internal_ids_configured"], ["26359578"])

    # Scénario C : SIRET inconnu + mode strict -> blocage SUPPLIER_SIRET_NOT_ALLOWED.
    def test_c_wrong_siret_strict_blocks(self) -> None:
        bv = validate_flux_business_rules(ubl(supplier_id="99999999999999"), "f.xml", supplier_config=STRICT_ALLOWLIST)["business_validation"]
        self.assertEqual(bv["severity"], "BLOCKING")
        self.assertIn("SUPPLIER_SIRET_NOT_ALLOWED", _codes(bv["errors"]))

    # Scénario D : identifiant fournisseur absent -> blocage SUPPLIER_ID_MISSING.
    def test_d_missing_supplier_id_blocks(self) -> None:
        bv = validate_flux_business_rules(ubl(supplier_id=None), "f.xml", supplier_config=STRICT_ALLOWLIST)["business_validation"]
        self.assertIn("SUPPLIER_ID_MISSING", _codes(bv["errors"]))

    # TVA : TaxSubtotal sans Percent -> blocage TAX_SUBTOTAL_PERCENT_MISSING.
    def test_tax_subtotal_percent_missing_blocks(self) -> None:
        bv = validate_flux_business_rules(ubl_with_subtotal(""), "f.xml", supplier_config=ALLOWLIST)["business_validation"]
        self.assertEqual(bv["severity"], "BLOCKING")
        codes = _codes(bv["errors"])
        self.assertIn("TAX_SUBTOTAL_PERCENT_MISSING", codes)
        err = next(e for e in bv["errors"] if e["code"] == "TAX_SUBTOTAL_PERCENT_MISSING")
        self.assertEqual(err["xml_path"], "Invoice.TaxTotal.TaxSubtotal.TaxCategory.Percent")
        self.assertTrue(err["suggested_fix"])

    def test_tax_subtotal_percent_present_ok(self) -> None:
        bv = validate_flux_business_rules(ubl_with_subtotal("<cbc:Percent>20.00</cbc:Percent>"), "f.xml",
                                          supplier_config=ALLOWLIST, annuaire_lookup={"11000201100044": {"active": True}})["business_validation"]
        self.assertNotIn("TAX_SUBTOTAL_PERCENT_MISSING", _codes(bv["errors"]))
        self.assertEqual(bv["extracted"]["tax_percentages"], ["20.00"])

    def test_tax_subtotal_percent_invalid_blocks(self) -> None:
        bv = validate_flux_business_rules(ubl_with_subtotal("<cbc:Percent>abc</cbc:Percent>"), "f.xml", supplier_config=ALLOWLIST)["business_validation"]
        self.assertEqual(bv["severity"], "BLOCKING")
        self.assertIn("TAX_PERCENT_INVALID", _codes(bv["errors"]))

    # Identifiant fournisseur non-SIRET -> avertissement de format (pas de comparaison aux IDs internes).
    def test_non_siret_supplier_id_warns(self) -> None:
        bv = validate_flux_business_rules(ubl(supplier_id="DEMO_SUPPLIER"), "f.xml", supplier_config=ALLOWLIST)["business_validation"]
        self.assertIn("SUPPLIER_ID_NOT_SIRET", _codes(bv["warnings"]))
        self.assertEqual(bv["extracted"]["supplier_identifier_type"], "NON_SIRET")
        self.assertNotIn("SUPPLIER_SIRET_NOT_ALLOWED", _codes(bv["errors"]))

    def test_customer_not_found_in_annuaire_strict_blocks(self) -> None:
        lookup = {"99999999999999": {"active": True}}  # ne contient pas le débiteur
        bv = validate_flux_business_rules(ubl(), "f.xml", supplier_config=STRICT_ALLOWLIST, annuaire_lookup=lookup)["business_validation"]
        self.assertIn("CUSTOMER_ID_NOT_FOUND", _codes(bv["errors"]))

    def test_customer_not_found_in_annuaire_non_strict_warns(self) -> None:
        lookup = {"99999999999999": {"active": True}}
        bv = validate_flux_business_rules(ubl(), "f.xml", supplier_config=ALLOWLIST, annuaire_lookup=lookup)["business_validation"]
        self.assertIn("CUSTOMER_ID_NOT_FOUND", _codes(bv["warnings"]))
        self.assertNotIn("CUSTOMER_ID_NOT_FOUND", _codes(bv["errors"]))

    def test_valid_invoice_is_ok(self) -> None:
        lookup = {"11000201100044": {"active": True}}
        bv = validate_flux_business_rules(ubl(), "f.xml", supplier_config=ALLOWLIST, annuaire_lookup=lookup)["business_validation"]
        self.assertTrue(bv["valid"])
        self.assertEqual(bv["severity"], "OK")
        self.assertEqual(bv["extracted"]["supplier_identifier"], "32242033407300")

    def test_cii_partial_warning(self) -> None:
        bv = validate_flux_business_rules(CII_XML, "cii.xml", supplier_config=PERMISSIVE)["business_validation"]
        self.assertIn("CII_PARTIAL", _codes(bv["warnings"]))


class ExplainErrorBusinessTests(unittest.TestCase):
    REJECTION = (
        "Facture n°TSTF1104_2016001: "
        "L'identifiant fournisseur de la demande de paiement (balise: AccountingSupplierParty.Party.PartyIdentification.ID.value) "
        "n'est pas référencé dans notre système. "
        "La structure n'utilise pas l'application \"Demandes de paiement\". "
        "Vous devez renseigner au moins une ligne d'adresse pour le fournisseur. "
        "Vous devez renseigner au moins une ligne d'adresse pour le débiteur. "
        "L'identifiant débiteur de la demande de paiement n'est pas référencé dans notre système."
    )

    def test_maps_all_business_phrases(self) -> None:
        result = explain_chorus_flux_error(self.REJECTION, None, code_retour=1)
        self.assertEqual(result["category"], "BUSINESS_VALIDATION")
        msg = result["message"]
        self.assertIn("fournisseur indiqué dans le XML n'est pas reconnu", msg)
        self.assertIn("Demandes de paiement", msg)
        self.assertIn("adresse fournisseur est obligatoire", msg)
        self.assertIn("adresse du débiteur", msg)
        self.assertIn("débiteur/client indiqué dans le XML n'est pas reconnu", msg)

    def test_maps_tax_subtotal_percent(self) -> None:
        result = explain_chorus_flux_error("L'element TaxTotal.TaxSubtotal.Percent.value est obligatoire.", None, code_retour=1)
        self.assertEqual(result["category"], "BUSINESS_VALIDATION")
        self.assertEqual(result["source"], "TaxTotal.TaxSubtotal.TaxCategory.Percent")
        self.assertIn("taux de TVA est manquant", result["message"])
        self.assertTrue(any(d["source"] == "TaxTotal.TaxSubtotal.TaxCategory.Percent" for d in result["details"]))


def _fake_settings(environment_override=None):
    return ChorusSettings(base_url="https://x/cpro", api_key="KEY", cpro_account="Y2Y=")


class BusinessRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        server.app.dependency_overrides[require_submit_permission] = lambda: {"email": "t@e.com", "roleCode": "ADMINISTRATEUR"}
        self._orig_load = routes.load_chorus_settings
        self._orig_cfg = routes.load_supplier_config
        self._orig_syntaxes = routes.recuperer_syntaxe_flux
        self._orig_deposer = routes.deposer_flux_facture
        self._orig_lookup = routes._try_annuaire_lookup
        routes.load_chorus_settings = _fake_settings
        routes.load_supplier_config = lambda env=None: dict(ALLOWLIST)
        self.client = TestClient(server.app)

    def tearDown(self) -> None:
        server.app.dependency_overrides.clear()
        routes.load_chorus_settings = self._orig_load
        routes.load_supplier_config = self._orig_cfg
        routes.recuperer_syntaxe_flux = self._orig_syntaxes
        routes.deposer_flux_facture = self._orig_deposer
        routes._try_annuaire_lookup = self._orig_lookup

    def test_business_validate_route_blocks(self) -> None:
        r = self.client.post(
            "/api/chorus/flux/business-validate",
            files={"file": ("f.xml", ubl(supplier_addr=False, customer_addr=False), "application/xml")},
        )
        body = r.json()
        self.assertEqual(r.status_code, 200)
        self.assertEqual(body["business_validation"]["severity"], "BLOCKING")
        self.assertIn("SUPPLIER_ADDRESS_MISSING", _codes(body["business_validation"]["errors"]))

    def test_deposer_blocked_by_business_validation_does_not_call_chorus(self) -> None:
        async def _must_not_call(**kw):  # pragma: no cover
            raise AssertionError("deposer_flux_facture must not be called when business BLOCKING")

        routes.deposer_flux_facture = lambda **kw: _must_not_call(**kw)
        routes.recuperer_syntaxe_flux = lambda **kw: (_ for _ in ()).throw(AssertionError("syntaxe lookup must not run"))
        r = self.client.post(
            "/api/chorus/flux/deposer",
            data={"format_flux": "IN_DP_E1_STRUCT", "syntaxe_flux": "IN_DP_E1_UBL_INVOICE", "force": "true"},
            files={"file": ("f.xml", ubl(supplier_addr=False, customer_addr=False), "application/xml")},
        )
        body = r.json()
        self.assertEqual(r.status_code, 422)
        self.assertEqual(body["status_local"], "BLOCKED_BUSINESS_VALIDATION")
        self.assertIn("business_validation", body)

    def test_prepare_correction_suggests_fixes(self) -> None:
        r = self.client.post(
            "/api/chorus/flux/prepare-correction",
            data={"supplier_identifier": "32242033407300"},
            files={"file": ("f.xml", ubl(supplier_id="DEMO", supplier_addr=False, customer_addr=False), "application/xml")},
        )
        body = r.json()
        self.assertTrue(body["success"])
        fields = {s["field"] for s in body["suggestions"]}
        self.assertIn("AccountingSupplierParty.Party.PostalAddress", fields)
        self.assertIn("AccountingCustomerParty.Party.PostalAddress", fields)

    def test_prepare_correction_awaits_annuaire_lookup(self) -> None:
        async def _fake_lookup(file_bytes, filename, detected):
            self.assertTrue(file_bytes)
            self.assertEqual(filename, "f.xml")
            self.assertEqual(detected["detected_file_type"], "UBL_INVOICE")
            return {"11000201100044": {"active": True}}

        routes._try_annuaire_lookup = _fake_lookup
        r = self.client.post(
            "/api/chorus/flux/prepare-correction",
            files={"file": ("f.xml", ubl(), "application/xml")},
        )
        body = r.json()
        self.assertEqual(r.status_code, 200)
        self.assertTrue(body["success"])
        fields = {s["field"] for s in body["suggestions"]}
        self.assertNotIn("AccountingCustomerParty.Party.PartyIdentification.ID", fields)


if __name__ == "__main__":
    unittest.main()
