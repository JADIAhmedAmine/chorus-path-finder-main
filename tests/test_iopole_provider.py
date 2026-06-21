from __future__ import annotations

import sys
import time
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
        # client_credentials : pas de refresh_token dans la réponse.
        return _FakeResponse(200, {"access_token": f"tok-{self.post_calls}", "expires_in": self._expires_in})


class _FakeApiSession:
    def __init__(self, responses):
        self._responses = list(responses)
        self.requests = []

    def request(self, method, url, json=None, headers=None, timeout=None):
        self.requests.append((method, url, json, headers))
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
        token = manager.get_client_credentials_token("conn-1")
        self.assertEqual(token, "tok-1")
        # Deuxième appel : token encore valide -> pas de nouvel appel HTTP.
        self.assertEqual(manager.get_client_credentials_token("conn-1"), "tok-1")
        self.assertEqual(session.post_calls, 1)

    def test_refetch_when_expired(self):
        session = _FakeTokenSession(expires_in=0)  # toujours expiré
        manager = _manager(session)
        manager.get_client_credentials_token("conn-1")
        manager.get_client_credentials_token("conn-1")
        self.assertEqual(session.post_calls, 2)


class IopoleProviderTest(unittest.TestCase):
    def _provider(self, api_session):
        config = IopoleConfig(
            client_id="c", client_secret="s", token_url="https://token.example/token"
        )
        return IopolePdpProvider(
            config,
            _manager(_FakeTokenSession()),
            connection_key="conn-1",
            session=api_session,
        )

    def test_is_pdp_provider(self):
        self.assertTrue(issubclass(IopolePdpProvider, PdpProvider))

    def test_deposit_returns_ref_with_bearer(self):
        api = _FakeApiSession([_FakeResponse(201, {"id": "iop-789", "reference": "INV-1"})])
        provider = self._provider(api)
        ref = provider.deposit(b"%PDF-xxx", filename="f.pdf", format_flux="UBL", syntaxe_flux="UBL_INVOICE")
        self.assertEqual(ref.external_id, "iop-789")
        self.assertEqual(ref.provider, "iopole")
        _, _, _, headers = api.requests[0]
        self.assertTrue(headers["Authorization"].startswith("Bearer "))

    def test_status_sets_lifecycle_not_payment(self):
        api = _FakeApiSession([_FakeResponse(200, {"id": "iop-789", "status": "DELIVERED"})])
        provider = self._provider(api)
        status = provider.get_lifecycle_status("iop-789")
        self.assertEqual(status.lifecycle_status, "DELIVERED")
        self.assertIsNone(status.payment_status)  # rôle PDP, pas ERP


if __name__ == "__main__":
    unittest.main()
