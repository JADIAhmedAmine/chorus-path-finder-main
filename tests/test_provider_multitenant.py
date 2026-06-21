from __future__ import annotations

import sys
import time
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from chorus_python.providers.connections import (  # noqa: E402
    EncryptedTokenStore,
    InMemoryConnectionStore,
    ProviderConnection,
    ProviderRegistry,
)
from chorus_python.providers.crypto import TokenCipher  # noqa: E402
from chorus_python.providers.iopole.provider import IopolePdpProvider  # noqa: E402
from chorus_python.providers.oauth import OAuth2Token  # noqa: E402


class CryptoTest(unittest.TestCase):
    def test_round_trip(self):
        cipher = TokenCipher(TokenCipher.generate_key())
        secret = "019ee9b9-4f9a-727b-836b-5fd11a24c9fd"
        enc = cipher.encrypt(secret)
        self.assertNotEqual(enc, secret)  # bien chiffré
        self.assertEqual(cipher.decrypt(enc), secret)

    def test_from_env_requires_key(self):
        with self.assertRaises(RuntimeError):
            TokenCipher.from_env({})


class EncryptedTokenStoreTest(unittest.TestCase):
    def test_save_load_encrypted(self):
        backend: dict[str, str] = {}
        store = EncryptedTokenStore(TokenCipher(TokenCipher.generate_key()), backend=backend)
        tok = OAuth2Token("access-xyz", "refresh-abc", expires_at=time.time() + 3600)
        store.save("tenant-A:iopole", tok)
        # Le backend ne contient PAS le token en clair.
        self.assertNotIn("access-xyz", backend["tenant-A:iopole"])
        loaded = store.load("tenant-A:iopole")
        self.assertEqual(loaded.access_token, "access-xyz")
        self.assertEqual(loaded.refresh_token, "refresh-abc")

    def test_missing_key_returns_none(self):
        store = EncryptedTokenStore(TokenCipher(TokenCipher.generate_key()))
        self.assertIsNone(store.load("absent"))


class ProviderRegistryTest(unittest.TestCase):
    def _registry(self):
        connections = InMemoryConnectionStore()
        connections.put(ProviderConnection(
            tenant_id="tenant-A", provider="iopole", environment="ppd",
            customer_id="cust-A", client_id="cid-A", client_secret="sec-A",
        ))
        connections.put(ProviderConnection(
            tenant_id="tenant-B", provider="iopole", environment="ppd",
            customer_id="cust-B", client_id="cid-B", client_secret="sec-B",
        ))
        store = EncryptedTokenStore(TokenCipher(TokenCipher.generate_key()))
        return ProviderRegistry(connections, store)

    def test_builds_tenant_scoped_provider(self):
        reg = self._registry()
        pa = reg.iopole_for("tenant-A")
        self.assertIsInstance(pa, IopolePdpProvider)
        self.assertEqual(pa._config.customer_id, "cust-A")
        self.assertEqual(pa._connection_key, "tenant-A:iopole")

    def test_tenants_are_isolated(self):
        reg = self._registry()
        pa = reg.iopole_for("tenant-A")
        pb = reg.iopole_for("tenant-B")
        # Clés de token distinctes => pas de fuite de contexte entre tenants.
        self.assertNotEqual(pa._connection_key, pb._connection_key)
        self.assertNotEqual(pa._config.customer_id, pb._config.customer_id)

    def test_unknown_tenant_raises(self):
        reg = self._registry()
        with self.assertRaises(Exception):
            reg.iopole_for("tenant-UNKNOWN")


if __name__ == "__main__":
    unittest.main()
