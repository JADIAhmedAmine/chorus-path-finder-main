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
import chorus_python.g2b_routes_flux as g2b_routes  # noqa: E402
from chorus_python.auth import require_submit_permission  # noqa: E402
from chorus_python.chorus_flux_business_validator import load_supplier_config, validate_flux_business_rules  # noqa: E402
from chorus_python.config import ChorusSettings  # noqa: E402
from chorus_python.g2b_diagnostics import build_piste_auth_error, config_diagnostic, piste_config_status  # noqa: E402

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


def _fake_settings(environment_override=None):
    return ChorusSettings(base_url="https://x/cpro", api_key="KEY", cpro_account="Y2Y=", token_url="https://t", client_id="cid", client_secret="sec")


def _codes(items):
    return [i["code"] for i in items]


class ConfigUnionTests(unittest.TestCase):
    def test_chorus_siret_key(self) -> None:
        cfg = load_supplier_config({"CHORUS_ALLOWED_SUPPLIER_SIRETS": "32242033407300"})
        self.assertIn("32242033407300", cfg["allowed_supplier_sirets"])

    def test_g2b_siret_key(self) -> None:
        cfg = load_supplier_config({"G2B_ALLOWED_SUPPLIER_SIRETS": "32242033407300"})
        self.assertIn("32242033407300", cfg["allowed_supplier_sirets"])

    def test_union_of_both(self) -> None:
        cfg = load_supplier_config({"CHORUS_ALLOWED_SUPPLIER_SIRETS": "111", "G2B_ALLOWED_SUPPLIER_SIRETS": "222"})
        self.assertEqual(set(cfg["allowed_supplier_sirets"]), {"111", "222"})

    def test_supplier_siret_configured_no_warning(self) -> None:
        # Avec un SIRET autorisé (clé G2B), pas de SUPPLIER_SIRET_NOT_CONFIGURED.
        cfg = load_supplier_config({"G2B_ALLOWED_SUPPLIER_SIRETS": "32242033407300", "G2B_SUPPLIER_DP_ENABLED": "true"})
        bv = validate_flux_business_rules(UBL_OK, "f.xml", supplier_config=cfg, annuaire_lookup={"11000201100044": {"active": True}})["business_validation"]
        codes = _codes(bv["errors"]) + _codes(bv["warnings"])
        self.assertNotIn("SUPPLIER_SIRET_NOT_CONFIGURED", codes)
        self.assertNotIn("SUPPLIER_SIRET_NOT_ALLOWED", codes)
        self.assertTrue(bv["checks"]["supplier_identifier_known"])

    def test_internal_id_alone_not_used_to_validate(self) -> None:
        cfg = load_supplier_config({"CHORUS_SUPPLIER_INTERNAL_IDS": "26359578"})
        self.assertEqual(cfg["allowed_supplier_sirets"], [])
        self.assertIn("26359578", cfg["allowed_supplier_internal_ids"])
        bv = validate_flux_business_rules(UBL_OK, "f.xml", supplier_config=cfg)["business_validation"]
        codes = _codes(bv["errors"]) + _codes(bv["warnings"])
        self.assertIn("SUPPLIER_SIRET_NOT_CONFIGURED", codes)
        self.assertNotIn("SUPPLIER_SIRET_NOT_ALLOWED", codes)


class DiagnosticUnitTests(unittest.TestCase):
    def test_build_piste_auth_error_no_secret(self) -> None:
        err = build_piste_auth_error("g2b_flux")
        self.assertEqual(err["error_code"], "PISTE_AUTH_FAILED")
        self.assertEqual(err["debug"]["api"], "g2b_flux")
        text = json.dumps(err)
        for key in ("token_url_configured", "client_id_configured", "client_secret_configured"):
            self.assertIn(key, text)
        # uniquement des booléens, pas de valeur
        self.assertIsInstance(err["debug"]["client_secret_configured"], bool)

    def test_config_diagnostic_no_secret_values(self) -> None:
        diag = config_diagnostic()
        text = json.dumps(diag).lower()
        self.assertNotIn("y2y=", text)  # cpro
        self.assertIn("cpro_account_configured", diag)
        self.assertIsInstance(piste_config_status()["client_secret_configured"], bool)


class AuthErrorRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        server.app.dependency_overrides[require_submit_permission] = lambda: {"email": "t@e.com", "roleCode": "ADMINISTRATEUR"}
        self._orig_load = flux_routes.load_chorus_settings
        self._orig_cfg = g2b_routes.load_g2b_supplier_config
        self._orig_resolve = g2b_routes._resolve_settings_and_token
        flux_routes.load_chorus_settings = _fake_settings
        g2b_routes.load_g2b_supplier_config = lambda env=None: {
            "allowed_supplier_sirets": ["32242033407300"], "allowed_supplier_internal_ids": [],
            "default_supplier_siret": "32242033407300", "supplier_dp_enabled": True, "strict": False,
        }
        self.client = TestClient(server.app)

    def tearDown(self) -> None:
        server.app.dependency_overrides.clear()
        flux_routes.load_chorus_settings = self._orig_load
        g2b_routes.load_g2b_supplier_config = self._orig_cfg
        g2b_routes._resolve_settings_and_token = self._orig_resolve

    def test_config_diagnostic_route_no_secret(self) -> None:
        r = self.client.get("/api/g2b/config/diagnostic")
        body = r.json()
        self.assertEqual(r.status_code, 200)
        self.assertTrue(body["success"])
        self.assertNotIn("y2y=", json.dumps(body).lower())
        self.assertIn("piste", body)

    def test_deposit_piste_auth_failed(self) -> None:
        def _raise(environment_override=None):
            raise RuntimeError("OAuth2 token request failed: 401 unauthorized")
        g2b_routes._resolve_settings_and_token = _raise
        r = self.client.post(
            "/api/g2b/flux/deposit",
            data={"code_interface": "FSO3110A", "force": "true"},
            files={"file": ("f.xml", UBL_OK, "application/xml")},
        )
        body = r.json()
        self.assertEqual(body["error_code"], "PISTE_AUTH_FAILED")
        self.assertEqual(body["statusLocal"], "ERROR")
        self.assertNotIn("y2y=", json.dumps(body).lower())


if __name__ == "__main__":
    unittest.main()
