from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from chorus_python.providers import (  # noqa: E402
    InMemoryTokenStore,
    OAuth2Config,
    OAuth2TokenManager,
    PdpProvider,
)
from chorus_python.providers.iopole.config import IopoleConfig  # noqa: E402
from chorus_python.providers.iopole.provider import IopolePdpProvider  # noqa: E402


class _FakeResponse:
    def __init__(self, status_code=200, json_body=None, headers=None):
        self.status_code = status_code
        self._json = json_body if json_body is not None else {}
        self.headers = headers or {}
        self.content = b"x" if json_body is not None else b""

    def json(self):
        return self._json


class _FakeTokenSession:
    def __init__(self, *, expires_in=3600):
        self.post_calls = 0
        self._expires_in = expires_in

    def post(self, url, data=None, headers=None, timeout=None):
        self.post_calls += 1
        return _FakeResponse(200, {"access_token": f"tok-{self.post_calls}", "expires_in": self._expires_in})


class _FakeApiSession:
    def __init__(self, responses):
        self._responses = list(responses)
        self.requests = []

    def request(self, method, url, params=None, json=None, files=None, headers=None, timeout=None):
        self.requests.append({"method": method, "url": url, "params": params, "json": json, "files": files, "headers": headers})
        return self._responses.pop(0)


def _manager(token_session):
    config = OAuth2Config(
        authorization_url="https://auth.example/auth",
        token_url="https://token.example/token",
        client_id="cid",
        client_secret="secret",
        redirect_uri="https://app.example/cb",
    )
    return OAuth2TokenManager(config, InMemoryTokenStore(), session=token_session)


class ClientCredentialsTest(unittest.TestCase):
    def test_no_refresh_token_required(self):
        session = _FakeTokenSession()
        manager = _manager(session)
        self.assertEqual(manager.get_client_credentials_token("conn-1"), "tok-1")
        self.assertEqual(manager.get_client_credentials_token("conn-1"), "tok-1")
        self.assertEqual(session.post_calls, 1)

    def test_refetch_when_expired(self):
        session = _FakeTokenSession(expires_in=0)
        manager = _manager(session)
        manager.get_client_credentials_token("conn-1")
        manager.get_client_credentials_token("conn-1")
        self.assertEqual(session.post_calls, 2)


class IopoleProviderTest(unittest.TestCase):
    def _provider(self, api_session):
        config = IopoleConfig(
            client_id="c",
            client_secret="s",
            customer_id="cust-123",
            token_url="https://auth.preprod.iopole.fr/realms/iopole/protocol/openid-connect/token",
        )
        return IopolePdpProvider(
            config,
            _manager(_FakeTokenSession()),
            connection_key="conn-1",
            session=api_session,
        )

    def test_is_pdp_provider(self):
        self.assertTrue(issubclass(IopolePdpProvider, PdpProvider))

    def test_deposit_sends_multipart_file(self):
        api = _FakeApiSession([_FakeResponse(201, {"type": "INVOICE", "id": "f47ac10b"})])
        provider = self._provider(api)
        ref = provider.deposit(b"%PDF-data", filename="facture.pdf", format_flux="FACTURX")
        self.assertEqual(ref.external_id, "f47ac10b")
        req = api.requests[0]
        self.assertEqual(req["method"], "POST")
        self.assertTrue(req["url"].endswith("/v1/invoice"))
        self.assertIn("file", req["files"])  # multipart
        self.assertNotIn("Content-Type", req["headers"])  # laissé à requests (boundary)
        self.assertEqual(req["headers"]["customer-id"], "cust-123")

    def test_status_via_metadata_state(self):
        api = _FakeApiSession([_FakeResponse(200, {
            "data": [{"metadata": {"invoiceId": "inv-1", "state": "DELIVERED"}}],
            "meta": {"count": 1},
        })])
        provider = self._provider(api)
        status = provider.get_lifecycle_status("inv-1")
        self.assertEqual(status.lifecycle_status, "DELIVERED")
        self.assertIsNone(status.payment_status)  # rôle PDP, pas ERP
        self.assertIn("/v1.1/invoice/search", api.requests[0]["url"])
        self.assertEqual(api.requests[0]["params"]["q"], 'invoice.invoiceId:"inv-1"')

    def test_search_parses_metadata(self):
        api = _FakeApiSession([_FakeResponse(200, {
            "data": [{"metadata": {"invoiceId": "abc", "state": "VALID"}, "businessData": {"invoiceId": "INV-9"}}],
            "meta": {"offset": 0, "limit": 50, "count": 1},
        })])
        provider = self._provider(api)
        refs = provider.search_invoices(limit=1)
        self.assertEqual(len(refs), 1)
        self.assertEqual(refs[0].external_id, "abc")
        self.assertEqual(refs[0].reference, "INV-9")
        self.assertIn("/v1.1/invoice/search", api.requests[0]["url"])

    def test_get_invoice_takes_first_of_array(self):
        # L'API renvoie un tableau ; get_invoice doit retourner la 1re entrée.
        api = _FakeApiSession([_FakeResponse(200, [{"invoiceId": "x", "way": "EMITTED"}])])
        inv = self._provider(api).get_invoice("x")
        self.assertEqual(inv["invoiceId"], "x")
        self.assertTrue(api.requests[0]["url"].endswith("/v1/invoice/x"))

    def test_list_not_seen(self):
        api = _FakeApiSession([_FakeResponse(200, ["a", "b"])])
        self.assertEqual(self._provider(api).list_not_seen(), ["a", "b"])

    def test_mark_as_seen_uses_put(self):
        api = _FakeApiSession([_FakeResponse(204, None)])
        self._provider(api).mark_as_seen("x")
        self.assertEqual(api.requests[0]["method"], "PUT")
        self.assertTrue(api.requests[0]["url"].endswith("/v1/invoice/x/markAsSeen"))


class IopoleMappingTest(unittest.TestCase):
    def test_map_draft_to_iopole_json(self):
        from chorus_python.providers.iopole.mapping import map_draft_to_iopole_json

        draft = {
            "supplier": {"name": "ACME", "siret": "41314262100045", "vat_number": "FR93413142621"},
            "customer": {"name": "MAIRIE", "siret": "39421116300012"},
            "invoice": {"invoice_number": "INV-1", "invoice_date": "2026-06-21", "currency": "EUR",
                        "total_ht": 1000, "total_tva": 200, "total_ttc": 1200},
            "lines": [{"description": "Conseil", "quantity": 1, "unit_price": 1000, "vat_rate": 20, "line_total_ht": 1000}],
            "vat_breakdown": [{"vat_rate": 20, "base_amount": 1000, "vat_amount": 200}],
        }
        out = map_draft_to_iopole_json(draft)
        self.assertEqual(out["invoiceId"], "INV-1")
        self.assertEqual(out["seller"]["siren"], "413142621")
        self.assertEqual(out["seller"]["electronicAddress"], "0225:413142621")
        self.assertEqual(out["seller"]["vatNumber"], "FR93413142621")
        self.assertEqual(out["buyer"]["siren"], "394211163")
        self.assertEqual(out["monetary"]["payableAmount"]["amount"], 1200)
        self.assertEqual(len(out["lines"]), 1)


if __name__ == "__main__":
    unittest.main()
