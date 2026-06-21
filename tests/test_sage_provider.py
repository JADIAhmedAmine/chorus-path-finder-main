from __future__ import annotations

import sys
import threading
import time
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from chorus_python.providers import (  # noqa: E402
    InMemoryTokenStore,
    OAuth2Config,
    OAuth2Token,
    OAuth2TokenManager,
    ReferenceResolution,
)
from chorus_python.providers.sage.config import SageAccountingConfig  # noqa: E402
from chorus_python.providers.sage.provider import (  # noqa: E402
    SageAccountingProvider,
    map_draft_to_sales_invoice,
)


class _FakeResponse:
    def __init__(self, status_code=200, json_body=None, headers=None):
        self.status_code = status_code
        self._json = json_body if json_body is not None else {}
        self.headers = headers or {}
        self.content = b"x" if json_body is not None else b""

    def json(self):
        return self._json


class _FakeTokenSession:
    """Session factice pour le token endpoint ; compte les appels POST."""

    def __init__(self, *, expires_in=3600, delay=0.0):
        self.post_calls = 0
        self._expires_in = expires_in
        self._delay = delay
        self._lock = threading.Lock()

    def post(self, url, data=None, headers=None, timeout=None):
        if self._delay:
            time.sleep(self._delay)
        with self._lock:
            self.post_calls += 1
            n = self.post_calls
        return _FakeResponse(
            200,
            {
                "access_token": f"access-{n}",
                "refresh_token": f"refresh-{n}",
                "expires_in": self._expires_in,
            },
        )


class _FakeApiSession:
    """Session factice pour l'API Sage ; renvoie des réponses programmées."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.requests = []

    def request(self, method, url, params=None, json=None, headers=None, timeout=None):
        self.requests.append((method, url, params, json, headers))
        return self._responses.pop(0)


def _draft():
    return {
        "supplier": {"name": "ACME SARL", "siret": "12345678900012"},
        "customer": {"name": "MAIRIE", "siret": "11000201100044"},
        "invoice": {
            "invoice_number": "INV-2026-001",
            "invoice_date": "2026-05-26",
            "due_date": "2026-06-26",
            "currency": "EUR",
            "total_ht": 100.0,
            "total_tva": 20.0,
            "total_ttc": 120.0,
        },
        "lines": [
            {"description": "Prestation", "quantity": 2, "unit_price": 50.0, "vat_rate": 20.0, "line_total_ht": 100.0},
        ],
    }


def _oauth_manager(session, *, seed_token=None):
    config = OAuth2Config(
        authorization_url="https://auth.example/oauth2/auth",
        token_url="https://token.example/token",
        client_id="cid",
        client_secret="secret",
        redirect_uri="https://app.example/callback",
        scope="full_access",
    )
    store = InMemoryTokenStore()
    if seed_token is not None:
        store.save("tenant-1", seed_token)
    return OAuth2TokenManager(config, store, session=session), store


class MapDraftTest(unittest.TestCase):
    def test_payload_structure(self):
        refs = ReferenceResolution(
            business_id="biz-1",
            contact_id="contact-1",
            ledger_account_id="ledger-1",
            tax_rate_ids={20.0: "tax-20"},
        )
        payload = map_draft_to_sales_invoice(_draft(), refs)
        invoice = payload["sales_invoice"]
        self.assertEqual(invoice["contact_id"], "contact-1")
        self.assertEqual(invoice["reference"], "INV-2026-001")
        self.assertEqual(invoice["date"], "2026-05-26")
        self.assertEqual(len(invoice["invoice_lines"]), 1)
        line = invoice["invoice_lines"][0]
        self.assertEqual(line["ledger_account_id"], "ledger-1")
        self.assertEqual(line["tax_rate_id"], "tax-20")
        self.assertEqual(line["quantity"], 2)
        self.assertEqual(line["unit_price"], 50.0)


class TokenManagerTest(unittest.TestCase):
    def test_cached_token_no_http(self):
        session = _FakeTokenSession()
        valid = OAuth2Token("access-0", "refresh-0", expires_at=time.time() + 3600)
        manager, _ = _oauth_manager(session, seed_token=valid)
        self.assertEqual(manager.get_access_token("tenant-1"), "access-0")
        self.assertEqual(session.post_calls, 0)

    def test_refresh_when_expired_rotates(self):
        session = _FakeTokenSession()
        expired = OAuth2Token("old", "refresh-old", expires_at=time.time() - 10)
        manager, store = _oauth_manager(session, seed_token=expired)
        token = manager.get_access_token("tenant-1")
        self.assertEqual(token, "access-1")
        self.assertEqual(session.post_calls, 1)
        # Le refresh token a tourné et est persisté.
        self.assertEqual(store.load("tenant-1").refresh_token, "refresh-1")

    def test_concurrent_refresh_single_writer(self):
        # Refresh lent : plusieurs threads doivent ne déclencher qu'UN seul POST.
        session = _FakeTokenSession(delay=0.05)
        expired = OAuth2Token("old", "refresh-old", expires_at=time.time() - 10)
        manager, _ = _oauth_manager(session, seed_token=expired)

        results: list[str] = []
        results_lock = threading.Lock()

        def worker():
            tok = manager.get_access_token("tenant-1")
            with results_lock:
                results.append(tok)

        threads = [threading.Thread(target=worker) for _ in range(6)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(session.post_calls, 1)  # single-writer + double-check
        self.assertEqual(set(results), {"access-1"})


class SageProviderTest(unittest.TestCase):
    def _provider(self, api_session):
        config = SageAccountingConfig(client_id="c", client_secret="s", redirect_uri="r")
        valid = OAuth2Token("access-0", "refresh-0", expires_at=time.time() + 3600)
        manager, _ = _oauth_manager(_FakeTokenSession(), seed_token=valid)
        return SageAccountingProvider(
            config,
            manager,
            connection_key="tenant-1",
            business_id="biz-1",
            session=api_session,
        )

    def test_create_invoice_returns_ref(self):
        api = _FakeApiSession([_FakeResponse(201, {"sales_invoice": {"id": "inv-123"}})])
        provider = self._provider(api)
        refs = ReferenceResolution(contact_id="c1", ledger_account_id="l1", tax_rate_ids={20.0: "t20"})
        ref = provider.create_invoice(_draft(), refs)
        self.assertEqual(ref.external_id, "inv-123")
        self.assertEqual(ref.reference, "INV-2026-001")
        # X-Business + Idempotency-Key envoyés.
        _, _, _, _, headers = api.requests[0]
        self.assertEqual(headers["X-Business"], "biz-1")
        self.assertIn("Idempotency-Key", headers)

    def test_status_separates_payment_and_lifecycle(self):
        api = _FakeApiSession([
            _FakeResponse(200, {"sales_invoice": {"id": "inv-123", "status": {"displayed_as": "Unpaid"}}}),
        ])
        provider = self._provider(api)
        status = provider.get_invoice_status("inv-123")
        self.assertEqual(status.payment_status, "Unpaid")
        self.assertIsNone(status.lifecycle_status)  # le lifecycle relève d'une PDP, pas de l'ERP


if __name__ == "__main__":
    unittest.main()
