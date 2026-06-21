"""``IopolePdpProvider`` — implémentation PdpProvider pour Iopole.

Iopole est une Plateforme Agréée (PDP) « API-first » : auth client_credentials
(Keycloak), REST asynchrone, statuts en **Push** (webhooks) ou **Pull**, formats
Factur-X/UBL/CII/Peppol. Ce provider incarne le **rôle PDP** (dépôt + lifecycle),
comme l'intégration Chorus Pro existante.

Endpoints confirmés via le Swagger « Invoicing operator » (service monté sous
``/v1/api/operator/invoicing``), header ``customer-id`` (UUID) sur chaque appel :
- émission : ``POST /v1/invoice`` (multipart ``file``, pdf/xml) -> ``{type, id}`` ;
- consultation : ``GET /v1.1/invoice/search``, ``GET /v1/invoice/{id}`` ;
- statut : ``GET /v1/invoice/{id}/status-history`` ;
- annuaire : ``GET /v1/directory/french``, ``…/international/check/scheme/{}/value/{}`` ;
- génération : ``POST /v1/tools/{facturx|ubl|cii}/generate`` (depuis le JSON Iopole).

Sécurité : aucun token ni contenu de facture journalisé.
"""

from __future__ import annotations

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

# Enum de statut confirmé (champ state).
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

# Chemins (montés sous IOPOLE_INVOICING_MOUNT).
_SEND = "/v1/invoice"
_SEARCH = "/v1.1/invoice/search"
_GET = "/v1/invoice/{invoice_id}"
_STATUS_HISTORY = "/v1/invoice/{invoice_id}/status-history"
_DOWNLOAD = "/v1/invoice/{invoice_id}/download"
_DOWNLOAD_READABLE = "/v1/invoice/{invoice_id}/download/readable"
_NOT_SEEN = "/v1/invoice/notSeen"
_MARK_SEEN = "/v1/invoice/{invoice_id}/markAsSeen"
_DIRECTORY_FRENCH = "/v1/directory/french"
_DIRECTORY_PEPPOL_CHECK = "/v1/directory/international/check/scheme/{scheme}/value/{value}"
_TOOLS_GENERATE = "/v1/tools/{kind}/generate"

_MAX_PAYLOAD_BYTES = 50 * 1024 * 1024  # 413 au-delà (limite serveur Iopole)


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
        timeout: float = 60.0,
    ) -> None:
        self._config = config
        self._tokens = token_manager
        self._connection_key = connection_key
        self._session = session or requests.Session()
        self._timeout = timeout

    # --- HTTP --------------------------------------------------------------
    def _headers(self, *, json_content: bool = True) -> dict[str, str]:
        token = self._tokens.get_client_credentials_token(self._connection_key)
        headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
        if json_content:
            headers["Content-Type"] = "application/json"
        if self._config.customer_id:
            headers["customer-id"] = self._config.customer_id  # header confirmé (UUID)
        return headers

    def _url(self, path: str) -> str:
        # Base réelle = host racine. ``/v1/api/operator/invoicing`` n'est que
        # l'emplacement de publication du spec OpenAPI, pas la base d'API.
        return f"{self._config.host.rstrip('/')}{path}"

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
        files: dict[str, Any] | None = None,
        raw: bool = False,
    ) -> Any:
        try:
            response = self._session.request(
                method,
                self._url(path),
                params=params,
                json=json_body,
                files=files,
                headers=self._headers(json_content=files is None),
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
        if raw:
            return response.content
        if not response.content:
            return None
        return response.json()

    # --- PdpProvider : émission --------------------------------------------
    def deposit(
        self,
        document: bytes,
        *,
        filename: str,
        format_flux: str | None = None,
        syntaxe_flux: str | None = None,
    ) -> ProviderInvoiceRef:
        """Envoie une facture (``POST /v1/invoice``, multipart ``file``).

        Le format (Factur-X PDF / UBL / CII XML) est auto-détecté par Iopole.
        Réponse 201 ``{type, id}`` ; traitement **asynchrone** (id à conserver
        pour rapprocher les statuts). 413 si > 50 Mo.
        """
        if len(document) > _MAX_PAYLOAD_BYTES:
            raise ProviderError("Document > 50 Mo refusé par Iopole (413).", provider=self.name)
        body = self._request("POST", _SEND, files={"file": (filename, document)})
        data = body if isinstance(body, dict) else {}
        external_id = str(data.get("id") or "")
        if not external_id:
            raise ProviderError("Réponse Iopole sans identifiant de facture.", provider=self.name)
        return ProviderInvoiceRef(
            provider=self.name, external_id=external_id, reference=filename, raw=data
        )

    # --- PdpProvider : statut lifecycle ------------------------------------
    def get_lifecycle_status(self, external_id: str) -> InvoiceStatus:
        """État lifecycle (``metadata.state``) via recherche par invoiceId.

        ``metadata.state`` ∈ ``INVOICE_STATES`` (ex. DELIVERED). Pour le détail
        des accusés (codes CDAR type APPROVED), voir ``get_status_history``.
        """
        body = self._request("GET", _SEARCH, params={"q": f'invoice.invoiceId:"{external_id}"', "limit": 1})
        data = body.get("data", []) if isinstance(body, dict) else []
        meta = data[0].get("metadata", {}) if data and isinstance(data[0], dict) else {}
        state = meta.get("state")
        return InvoiceStatus(
            external_id=external_id,
            lifecycle_status=state if isinstance(state, str) else None,
            polled_at=datetime.utcnow(),
            raw=data[0] if data else {},
        )

    def get_status_history(self, external_id: str) -> list[dict[str, Any]]:
        """Historique détaillé des statuts (``GET …/status-history``).

        Chaque entrée : ``{invoiceId, statusId, date, destType, status:{code}, xml}``.
        """
        body = self._request("GET", _STATUS_HISTORY.format(invoice_id=external_id))
        if isinstance(body, list):
            return body
        return body.get("data", []) if isinstance(body, dict) else []

    # --- Recherche / consultation ------------------------------------------
    def search_invoices(
        self,
        *,
        query: str | None = None,
        offset: int = 0,
        limit: int = 50,
        expand: tuple[str, ...] = ("lastStatusData",),
    ) -> list[ProviderInvoiceRef]:
        """``GET /v1.1/invoice/search`` (q Lucene, offset/limit/expand)."""
        params: dict[str, Any] = {"offset": offset, "limit": min(limit, 200)}
        if query:
            params["q"] = query
        if expand:
            params["expand"] = ",".join(expand)  # l'API attend une liste séparée par virgules
        body = self._request("GET", _SEARCH, params=params)
        data = body.get("data", []) if isinstance(body, dict) else []
        refs: list[ProviderInvoiceRef] = []
        for item in data:
            if not isinstance(item, dict):
                continue
            meta = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
            business = item.get("businessData") if isinstance(item.get("businessData"), dict) else {}
            refs.append(
                ProviderInvoiceRef(
                    provider=self.name,
                    external_id=str(meta.get("invoiceId") or ""),
                    reference=business.get("invoiceId"),
                    raw=item,
                )
            )
        return refs

    def get_invoice(self, external_id: str) -> dict[str, Any]:
        """Détail complet (metadata + businessData) — ``GET /v1/invoice/{id}``.

        L'API renvoie un **tableau** (une entrée par version) : on retourne la 1re.
        """
        body = self._request("GET", _GET.format(invoice_id=external_id))
        if isinstance(body, list):
            return body[0] if body and isinstance(body[0], dict) else {}
        return body if isinstance(body, dict) else {}

    def download_invoice(self, external_id: str) -> bytes:
        """Télécharge le fichier original (``GET …/download``)."""
        return self._request("GET", _DOWNLOAD.format(invoice_id=external_id), raw=True)

    def download_readable(self, external_id: str) -> bytes:
        """Télécharge la version lisible Factur-X PDF (``GET …/download/readable``)."""
        return self._request("GET", _DOWNLOAD_READABLE.format(invoice_id=external_id), raw=True)

    # --- Réception (inbound, mode PULL) — parallèle de la réception Chorus ---
    def list_not_seen(self) -> list[str]:
        """IDs des factures reçues non encore vues (``GET /v1/invoice/notSeen``)."""
        body = self._request("GET", _NOT_SEEN)
        return [str(x) for x in body] if isinstance(body, list) else []

    def mark_as_seen(self, external_id: str) -> None:
        """Marque une facture reçue comme intégrée (``PUT …/markAsSeen``)."""
        self._request("PUT", _MARK_SEEN.format(invoice_id=external_id))

    def health_check(self) -> bool:
        try:
            self.search_invoices(limit=1)
            return True
        except ProviderError:
            return False

    # --- Annuaire (routing destinataire) -----------------------------------
    def search_french_directory(self, query: str) -> Any:
        return self._request("GET", _DIRECTORY_FRENCH, params={"q": query})

    def check_peppol_participant(self, scheme: str, value: str) -> Any:
        return self._request(
            "GET", _DIRECTORY_PEPPOL_CHECK.format(scheme=scheme, value=value)
        )

    # --- Génération de flux conforme depuis le JSON Iopole -----------------
    def generate_invoice_document(
        self, iopole_json: dict[str, Any], *, kind: str = "facturx", flavor: str = "EN16931", **query: Any
    ) -> bytes:
        """``POST /v1/tools/{facturx|ubl|cii}/generate`` -> document conforme.

        Permet de produire un Factur-X/UBL/CII validé directement depuis le
        modèle JSON Iopole (alternative au générateur UBL maison).
        """
        params: dict[str, Any] = {"flavor": flavor, **query}
        return self._request(
            "POST", _TOOLS_GENERATE.format(kind=kind), params=params, json_body=iopole_json, raw=True
        )
