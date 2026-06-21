"""``SageAccountingProvider`` — implémentation ErpProvider pour Sage Accounting.

Périmètre MVP (``mvp_scope_sage.md``) : créer une facture de vente et relire son
statut. Pas de webhooks Sage -> suivi par polling. Le header ``X-Business`` est
obligatoire sur chaque requête.

⚠️ Les schémas exacts de payload/réponse (noms de champs, énumérations de statut,
champ SIRET du contact) restent à confirmer via ``api-doc-mapper`` sur la spec
OpenAPI Sage : les points concernés sont marqués ``TODO(api-doc-mapper)``.

Sécurité : aucun token ni contenu de facture journalisé ; seul ``x_request_id``
(identifiant de corrélation Sage) peut l'être pour le support.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime
from typing import Any
from urllib.parse import urlencode

import requests

from ..base import (
    ErpProvider,
    InvoiceStatus,
    ProviderError,
    ProviderInvoiceRef,
    ProviderRateLimitError,
    ReferenceResolution,
)
from ..oauth import OAuth2TokenManager
from .config import SageAccountingConfig

logger = logging.getLogger("providers.sage")

_DEFAULT_MAX_RETRIES = 3


def _to_float(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip().replace(" ", "").replace(",", "."))
        except ValueError:
            return None
    return None


def map_draft_to_sales_invoice(
    draft: dict[str, Any], references: ReferenceResolution
) -> dict[str, Any]:
    """Transforme le ``draft`` interne en payload ``sales_invoice`` Sage.

    Fonction pure (testable sans réseau). ``draft`` suit la forme de
    ``chorus_pdf_invoice_extractor.empty_draft``.

    TODO(api-doc-mapper): confirmer les noms de champs exacts et le placement du
    SIRET (objet contact) une fois la spec OpenAPI disponible.
    """
    invoice = draft.get("invoice") if isinstance(draft.get("invoice"), dict) else {}
    raw_lines = draft.get("lines") if isinstance(draft.get("lines"), list) else []

    invoice_lines: list[dict[str, Any]] = []
    for line in raw_lines:
        if not isinstance(line, dict):
            continue
        vat_rate = _to_float(line.get("vat_rate"))
        invoice_lines.append(
            {
                "description": line.get("description"),
                "ledger_account_id": references.ledger_account_id,
                "quantity": _to_float(line.get("quantity")) or 1,
                "unit_price": _to_float(line.get("unit_price")),
                "tax_rate_id": references.tax_rate_ids.get(vat_rate) if vat_rate is not None else None,
            }
        )

    return {
        "sales_invoice": {
            "contact_id": references.contact_id,
            "date": invoice.get("invoice_date"),
            "due_date": invoice.get("due_date"),
            "reference": invoice.get("invoice_number"),
            "invoice_lines": invoice_lines,
        }
    }


class SageAccountingProvider(ErpProvider):
    """Provider ERP Sage Accounting (API REST v3.1)."""

    name = "sage_accounting"

    def __init__(
        self,
        config: SageAccountingConfig,
        token_manager: OAuth2TokenManager,
        *,
        connection_key: str,
        business_id: str | None = None,
        session: requests.Session | None = None,
        timeout: float = 30.0,
    ) -> None:
        self._config = config
        self._tokens = token_manager
        self._connection_key = connection_key
        self._business_id = business_id
        self._session = session or requests.Session()
        self._timeout = timeout

    # --- HTTP --------------------------------------------------------------
    def _headers(self, *, idempotency_key: str | None = None) -> dict[str, str]:
        access_token = self._tokens.get_access_token(self._connection_key)
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        if self._business_id:
            headers["X-Business"] = self._business_id  # obligatoire sur chaque requête
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        return headers

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
        max_retries: int = _DEFAULT_MAX_RETRIES,
    ) -> Any:
        url = path if path.startswith("http") else f"{self._config.base_url.rstrip('/')}/{path.lstrip('/')}"

        attempt = 0
        while True:
            attempt += 1
            try:
                response = self._session.request(
                    method,
                    url,
                    params=params,
                    json=json_body,
                    headers=self._headers(idempotency_key=idempotency_key),
                    timeout=self._timeout,
                )
            except requests.RequestException as exc:
                raise ProviderError("Échec réseau lors de l'appel Sage.", provider=self.name) from exc

            request_id = response.headers.get("x_request_id") or response.headers.get("X-Request-Id")

            # 429 : backoff puis retry (jusqu'à max_retries).
            if response.status_code == 429:
                retry_after = _to_float(response.headers.get("Retry-After")) or float(2**attempt)
                if attempt >= max_retries:
                    raise ProviderRateLimitError(
                        "Limite de débit Sage atteinte (429).",
                        provider=self.name,
                        status_code=429,
                        request_id=request_id,
                        retry_after=retry_after,
                    )
                logger.warning("Sage 429 (x_request_id=%s), backoff %.1fs", request_id, retry_after)
                time.sleep(retry_after)
                continue

            if response.status_code >= 400:
                raise ProviderError(
                    f"Erreur Sage {response.status_code}.",
                    provider=self.name,
                    status_code=response.status_code,
                    request_id=request_id,
                )

            if not response.content:
                return None
            return response.json()

    # --- ErpProvider -------------------------------------------------------
    def health_check(self) -> bool:
        try:
            self._request("GET", "/businesses")
            return True
        except ProviderError:
            return False

    def resolve_references(self, draft: dict[str, Any]) -> ReferenceResolution:
        """Résout business / contact / compte INCOME / taux TVA.

        Squelette : la résolution réelle (création de contact CUSTOMER, choix du
        compte INCOME par défaut, mapping des taux FR) sera complétée une fois
        les schémas figés par ``api-doc-mapper``.
        """
        references = ReferenceResolution(business_id=self._business_id)

        # TODO(api-doc-mapper): GET /contacts (filtrer CUSTOMER par SIRET/nom) ou POST création.
        # TODO(api-doc-mapper): GET /ledger_accounts -> compte du groupe INCOME (défaut configurable).
        # TODO(api-doc-mapper): GET /tax_rates -> remplir references.tax_rate_ids {20.0: id, 10.0: id, 5.5: id}.
        references.warnings.append(
            "resolve_references: résolution provider non encore implémentée (en attente du schéma OpenAPI)."
        )
        return references

    def create_invoice(
        self, draft: dict[str, Any], references: ReferenceResolution
    ) -> ProviderInvoiceRef:
        payload = map_draft_to_sales_invoice(draft, references)
        invoice = draft.get("invoice") if isinstance(draft.get("invoice"), dict) else {}
        reference = invoice.get("invoice_number")
        # Clé d'idempotence stable pour éviter les doublons en cas de retry/polling.
        idempotency_key = f"{self._connection_key}:{reference}" if reference else None

        body = self._request(
            "POST",
            "/sales_invoices",
            json_body=payload,
            idempotency_key=idempotency_key,
        )
        data = body.get("sales_invoice", body) if isinstance(body, dict) else {}
        external_id = str(data.get("id") or "")
        if not external_id:
            raise ProviderError("Réponse Sage sans identifiant de facture.", provider=self.name)
        return ProviderInvoiceRef(
            provider=self.name,
            external_id=external_id,
            reference=reference,
            raw=data if isinstance(data, dict) else {},
        )

    def get_invoice_status(self, external_id: str) -> InvoiceStatus:
        body = self._request("GET", f"/sales_invoices/{external_id}")
        data = body.get("sales_invoice", body) if isinstance(body, dict) else {}
        # NB : statut de PAIEMENT côté ERP, distinct du lifecycle PDP.
        # TODO(api-doc-mapper): confirmer le champ exact (status_id / payment_status / displayed_as).
        payment_status = None
        if isinstance(data, dict):
            status = data.get("status") if isinstance(data.get("status"), dict) else None
            payment_status = (
                (status or {}).get("displayed_as")
                or data.get("status_id")
                or data.get("payment_status")
            )
        return InvoiceStatus(
            external_id=external_id,
            payment_status=payment_status,
            polled_at=datetime.utcnow(),
            raw=data if isinstance(data, dict) else {},
        )

    def list_invoices(
        self, updated_since: datetime | None = None
    ) -> list[ProviderInvoiceRef]:
        """Liste les factures, polling incrémental + pagination ``$next``."""
        params: dict[str, Any] = {}
        if updated_since is not None:
            params["updated_or_created_since"] = updated_since.strftime("%Y-%m-%dT%H:%M:%SZ")

        path = "/sales_invoices" + (f"?{urlencode(params)}" if params else "")
        refs: list[ProviderInvoiceRef] = []
        while path:
            body = self._request("GET", path)
            if not isinstance(body, dict):
                break
            for item in body.get("$items", body.get("items", [])):
                if not isinstance(item, dict):
                    continue
                refs.append(
                    ProviderInvoiceRef(
                        provider=self.name,
                        external_id=str(item.get("id") or ""),
                        reference=item.get("reference"),
                        raw=item,
                    )
                )
            # Pagination : suivre l'URL $next fournie (jamais d'offset manuel).
            path = body.get("$next") or ""
        return refs
