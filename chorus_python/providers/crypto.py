"""Chiffrement symétrique des secrets/tokens providers (au repos).

Basé sur Fernet (AES-128-CBC + HMAC). La clé vient de l'environnement
(``PROVIDERS_ENCRYPTION_KEY``) — jamais en dur, jamais commitée. Générer une clé :

    python -c "from chorus_python.providers.crypto import TokenCipher; print(TokenCipher.generate_key())"

Sécurité : on ne journalise jamais clé, secret ni token en clair.
"""

from __future__ import annotations

import os

from cryptography.fernet import Fernet


class TokenCipher:
    """Chiffre/déchiffre des chaînes (secrets clients, tokens OAuth)."""

    def __init__(self, key: str | bytes) -> None:
        self._fernet = Fernet(key if isinstance(key, bytes) else key.encode())

    def encrypt(self, plaintext: str) -> str:
        return self._fernet.encrypt(plaintext.encode()).decode()

    def decrypt(self, ciphertext: str) -> str:
        return self._fernet.decrypt(ciphertext.encode()).decode()

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "TokenCipher":
        environ = env if env is not None else dict(os.environ)
        key = environ.get("PROVIDERS_ENCRYPTION_KEY", "").strip()
        if not key:
            raise RuntimeError(
                "PROVIDERS_ENCRYPTION_KEY manquant : indispensable pour chiffrer les "
                "credentials providers au repos (multi-tenant)."
            )
        return cls(key)

    @staticmethod
    def generate_key() -> str:
        """Génère une clé Fernet (à stocker en secret manager / .env.local)."""
        return Fernet.generate_key().decode()
