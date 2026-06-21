"""``IopolePdpProvider`` — implémentation PdpProvider pour Iopole.

Iopole est une Plateforme Agréée (PDP) « API-first » : auth client_credentials
(Keycloak), REST asynchrone, statuts en **Push** (webhooks), formats Factur-X/
UBL/CII/Peppol. Ce provider incarne le **rôle PDP** (dépôt + lifecycle), comme
l'intégration Chorus Pro existante.

Confirmé via l'OpenAPI public ``…/operator/invoicing`` :
- consultation : ``GET /v1.1/invoice/search`` et ``GET /v1/invoice/{invoiceId}`` ;
- header ``customer-id`` (UUID) ; statuts = enum ``INVOICE_STATES``.

⚠️ Le service d'**émission/dépôt** (envoi au destinataire) est auth-gated et non
exposé publiquement : ``deposit()`` reste provisoire (``TODO(api-doc-mapper)``) en
attendant le Swagger authentifié.

Sécurité : aucun token ni contenu de facture journalisé.
"""

from __future__ import annotations

import base64
import logging
from datetime import datetime
from typing import Any
from urllib.parse import urlencode

import requests

from ..base import (
    InvoiceStatus,
    PdpProvider,
    ProviderError,
    ProviderInvoiceRef,
)
from ..oauth import OAuth2TokenManager
from .config import IOPOLE_INVOICING_MOUNT, IopoleConfig

logger = logging.getLogger("providers.iopole")

# Enum de statut confirmé (champ invoice.state).
INVOICE_STATES = (
    "PENDING",
    "VALID",
    "INVALID",
    "DUPLICATED",
    "WRONG_ROUTING",
    "NOT_DELIVERED",
    "DELIVERED",
    "DELIVERY_PENDING",
    "PROCESSING",
    "CONVERTED",
    "CONVERSION_FAILED",
)

# Chemins du service de consultation (montés sous IOPOLE_INVOICING_MOUNT).
_INVOICE_SEARCH_PATH = "/v1.1/invoice/search"
_INVOICE_GET_PATH = "/v1/invoice/{invoice_id}"

# TODO(api-doc-mapper): service d'émission auth-gated -> figer depuis le Swagger.
_EMIT_PATH: str | None = None


class IopolePdpProvider(PdpProvider):
    """Provider PDP Iopole (REST, auth client_credentials Keycloak)."""

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
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        if self._config.customer_id:
            headers["customer-id"] = self._config.customer_id  # header confirmé (UUID)
        return headers

    def _invoicing_url(self, path: str) -> str:
        return f"{self._config.host.rstrip('/')}{IOPOLE_INVOICING_MOUNT}{path}"

    def _request(self, method: str, url: str, *, json_body: dict[str, Any] | None = None) -> Any:
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

    # --- Consultation (confirmé) -------------------------------------------
    def get_lifecycle_status(self, external_id: str) -> InvoiceStatus:
        """Relit le statut lifecycle via ``GET /v1/invoice/{invoiceId}``."""
        body = self._request("GET", self._invoicing_url(_INVOICE_GET_PATH.format(invoice_id=external_id)))
        data = body if isinstance(body, dict) else {}
        invoice = data.get("invoice") if isinstance(data.get("invoice"), dict) else data
        state = invoice.get("state") if isinstance(invoice, dict) else None
        return InvoiceStatus(
            external_id=external_id,
            lifecycle_status=state if isinstance(state, str) else None,
            polled_at=datetime.utcnow(),
            raw=data,
        )

    def search_invoices(
        self,
        *,
        query: str | None = None,
        offset: int = 0,
        limit: int = 50,
        expand: tuple[str, ...] = ("lastStatusData",),
    ) -> list[ProviderInvoiceRef]:
        """Liste/recherche via ``GET /v1.1/invoice/search`` (offset/limit/expand)."""
        params: dict[str, Any] = {"offset": offset, "limit": min(limit, 200)}
        if query:
            params["q"] = query
        for value in expand:
            params.setdefault("expand", [])
            params["expand"].append(value)  # type: ignore[union-attr]
        url = f"{self._invoicing_url(_INVOICE_SEARCH_PATH)}?{urlencode(params, doseq=True)}"
        body = self._request("GET", url)
        items = body.get("items", body.get("data", [])) if isinstance(body, dict) else []
        refs: list[ProviderInvoiceRef] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            invoice = item.get("invoice") if isinstance(item.get("invoice"), dict) else item
            refs.append(
                ProviderInvoiceRef(
                    provider=self.name,
                    external_id=str(invoice.get("invoiceId") or ""),
                    reference=invoice.get("reference"),
                    raw=item,
                )
            )
        return refs

    def health_check(self) -> bool:
        try:
            self.search_invoices(limit=1)
            return True
        except ProviderError:
            return False

    # --- Émission (provisoire) ---------------------------------------------
    def deposit(
        self,
        document: bytes,
        *,
        filename: str,
        format_flux: str,
        syntaxe_flux: str,
    ) -> ProviderInvoiceRef:
        """Dépose un flux pour transmission.

        ⚠️ Le service d'émission est auth-gated : le chemin/contrat exact restent
        à figer via le Swagger authentifié (``TODO(api-doc-mapper)``).
        """
        if _EMIT_PATH is None:
            raise ProviderError(
                "Endpoint d'émission Iopole non encore figé (Swagger authentifié requis).",
                provider=self.name,
            )
        payload = {
            "filename": filename,
            "format": format_flux,
            "syntaxe": syntaxe_flux,
            "content_base64": base64.b64encode(document).decode("ascii"),
        }
        body = self._request("POST", self._invoicing_url(_EMIT_PATH), json_body=payload)
        data = body if isinstance(body, dict) else {}
        external_id = str(data.get("invoiceId") or data.get("id") or "")
        if not external_id:
            raise ProviderError("Réponse Iopole sans identifiant de dépôt.", provider=self.name)
        return ProviderInvoiceRef(
            provider=self.name, external_id=external_id, reference=data.get("reference"), raw=data
        )
