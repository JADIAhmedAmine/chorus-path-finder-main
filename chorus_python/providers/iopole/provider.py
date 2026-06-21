"""``IopolePdpProvider`` — implémentation PdpProvider pour Iopole.

Iopole est une Plateforme Agréée (PDP) « API-first » : auth client_credentials,
REST asynchrone, notifications de statut (webhooks), formats Factur-X/UBL/CII/
Peppol. Ce provider incarne le **rôle PDP** (dépôt + lifecycle), exactement comme
l'intégration Chorus Pro existante — qui pourra à terme se ranger derrière la
même interface.

⚠️ Les chemins d'endpoints exacts et le contrat de dépôt (multipart vs base64)
restent à confirmer via ``api-doc-mapper`` sur l'OpenAPI Iopole : marqués
``TODO(api-doc-mapper)``.

Sécurité : aucun token ni contenu de facture journalisé.
"""

from __future__ import annotations

import base64
import logging
from datetime import datetime
from typing import Any

import requests

from ..base import (
    InvoiceStatus,
    PdpProvider,
    ProviderError,
    ProviderInvoiceRef,
)
from ..oauth import OAuth2TokenManager
from .config import IopoleConfig

logger = logging.getLogger("providers.iopole")

# TODO(api-doc-mapper): confirmer les chemins exacts sur l'OpenAPI Iopole.
_EMIT_INVOICE_PATH = "/api/invoices/emit"
_INVOICE_STATUS_PATH = "/api/invoices/{external_id}/status"
_HEALTH_PATH = "/api/ping"


class IopolePdpProvider(PdpProvider):
    """Provider PDP Iopole (REST, auth client_credentials)."""

    name = "iopole"

    def __init__(
        self,
        config: IopoleConfig,
        token_manager: OAuth2TokenManager,
        *,
        connection_key: str,
        session: requests.Session | None = None,
        timeout: float = 30.0,
    ) -> None:
        self._config = config
        self._tokens = token_manager
        self._connection_key = connection_key
        self._session = session or requests.Session()
        self._timeout = timeout

    # --- HTTP --------------------------------------------------------------
    def _headers(self) -> dict[str, str]:
        token = self._tokens.get_client_credentials_token(self._connection_key)
        return {
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: dict[str, Any] | None = None,
    ) -> Any:
        url = path if path.startswith("http") else f"{self._config.base_url.rstrip('/')}/{path.lstrip('/')}"
        try:
            response = self._session.request(
                method,
                url,
                json=json_body,
                headers=self._headers(),
                timeout=self._timeout,
            )
        except requests.RequestException as exc:
            raise ProviderError("Échec réseau lors de l'appel Iopole.", provider=self.name) from exc

        request_id = response.headers.get("X-Request-Id") or response.headers.get("x-request-id")
        if response.status_code >= 400:
            raise ProviderError(
                f"Erreur Iopole {response.status_code}.",
                provider=self.name,
                status_code=response.status_code,
                request_id=request_id,
            )
        if not response.content:
            return None
        return response.json()

    # --- PdpProvider -------------------------------------------------------
    def health_check(self) -> bool:
        try:
            self._request("GET", _HEALTH_PATH)
            return True
        except ProviderError:
            return False

    def deposit(
        self,
        document: bytes,
        *,
        filename: str,
        format_flux: str,
        syntaxe_flux: str,
    ) -> ProviderInvoiceRef:
        """Dépose un flux (UBL/CII/Factur-X) sur Iopole pour transmission.

        TODO(api-doc-mapper): confirmer le contrat exact (multipart vs base64,
        champs de routing/destinataire). Le squelette envoie un JSON base64.
        """
        payload = {
            "filename": filename,
            "format": format_flux,
            "syntaxe": syntaxe_flux,
            "content_base64": base64.b64encode(document).decode("ascii"),
        }
        body = self._request("POST", _EMIT_INVOICE_PATH, json_body=payload)
        data = body if isinstance(body, dict) else {}
        external_id = str(data.get("id") or data.get("invoiceId") or "")
        if not external_id:
            raise ProviderError("Réponse Iopole sans identifiant de dépôt.", provider=self.name)
        return ProviderInvoiceRef(
            provider=self.name,
            external_id=external_id,
            reference=data.get("reference"),
            raw=data,
        )

    def get_lifecycle_status(self, external_id: str) -> InvoiceStatus:
        body = self._request("GET", _INVOICE_STATUS_PATH.format(external_id=external_id))
        data = body if isinstance(body, dict) else {}
        # Rôle PDP : on renseigne lifecycle_status (jamais payment_status).
        # TODO(api-doc-mapper): confirmer le champ exact (status / lifecycleStatus / state).
        lifecycle = data.get("status") or data.get("lifecycleStatus") or data.get("state")
        return InvoiceStatus(
            external_id=external_id,
            lifecycle_status=lifecycle if isinstance(lifecycle, str) else None,
            polled_at=datetime.utcnow(),
            raw=data,
        )
