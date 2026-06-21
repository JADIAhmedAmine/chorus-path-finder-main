"""Contrats génériques de la couche provider (ERP / PDP).

Conçu pour être indépendant de tout fournisseur : Sage, Cegid, Docaposte ou
Chorus Pro implémentent ces interfaces. Les DTO restent volontairement simples
(dataclasses) et alignés sur le ``draft`` produit par l'extraction PDF existante
(``chorus_python.chorus_pdf_invoice_extractor.empty_draft``).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Optional


class ProviderRole(str, Enum):
    """Rôle d'un provider dans la chaîne e-facturation."""

    ERP = "erp"  # source de factures
    PDP = "pdp"  # plateforme de routing / dématérialisation


# ---------------------------------------------------------------------------
# Erreurs (ne fuitent jamais secrets/tokens/contenu)
# ---------------------------------------------------------------------------
class ProviderError(Exception):
    """Erreur générique d'un provider.

    ``message`` ne doit jamais contenir de secret, de token ni de contenu de
    facture. ``request_id`` permet le support sans exposer de données.
    """

    def __init__(
        self,
        message: str,
        *,
        provider: str | None = None,
        status_code: int | None = None,
        request_id: str | None = None,
    ) -> None:
        super().__init__(message)
        self.provider = provider
        self.status_code = status_code
        self.request_id = request_id


class ProviderAuthError(ProviderError):
    """Connexion absente, expirée ou refresh invalidé (chaîne rompue)."""


class ProviderRateLimitError(ProviderError):
    """HTTP 429 — le provider impose un backoff."""

    def __init__(self, message: str, *, retry_after: float | None = None, **kwargs: Any) -> None:
        super().__init__(message, **kwargs)
        self.retry_after = retry_after


# ---------------------------------------------------------------------------
# DTO
# ---------------------------------------------------------------------------
@dataclass
class ProviderInvoiceRef:
    """Référence d'une facture côté provider après création/dépôt."""

    provider: str
    external_id: str
    reference: str | None = None  # numéro de facture côté Chorus Pilot
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass
class InvoiceStatus:
    """État d'une facture.

    Distinction structurante : ``payment_status`` provient de l'ERP (impayé /
    partiel / payé) tandis que ``lifecycle_status`` provient d'une PDP (déposé /
    rejeté / accepté). Les deux ne doivent jamais être confondus.
    """

    external_id: str
    payment_status: str | None = None
    lifecycle_status: str | None = None
    polled_at: datetime | None = None
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass
class ReferenceResolution:
    """Identifiants côté provider nécessaires pour construire un payload facture.

    Pour Sage Accounting : ``business_id`` (header X-Business), ``contact_id``
    (client CUSTOMER), ``ledger_account_id`` (compte INCOME) et la table
    ``tax_rate_ids`` (taux TVA en % -> identifiant de taux côté provider).
    """

    business_id: str | None = None
    contact_id: str | None = None
    ledger_account_id: str | None = None
    tax_rate_ids: dict[float, str] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Interfaces
# ---------------------------------------------------------------------------
class Provider(ABC):
    """Contrat commun minimal à tout provider."""

    name: str
    role: ProviderRole

    @abstractmethod
    def health_check(self) -> bool:
        """Vérifie que la connexion au provider est exploitable."""


class ErpProvider(Provider):
    """Système source de factures (création + suivi de statut de paiement)."""

    role = ProviderRole.ERP

    @abstractmethod
    def resolve_references(self, draft: dict[str, Any]) -> ReferenceResolution:
        """Résout les identifiants provider (client, compte, taux) depuis un draft."""

    @abstractmethod
    def create_invoice(
        self, draft: dict[str, Any], references: ReferenceResolution
    ) -> ProviderInvoiceRef:
        """Crée une facture de vente dans l'ERP à partir d'un draft validé."""

    @abstractmethod
    def get_invoice_status(self, external_id: str) -> InvoiceStatus:
        """Relit le statut (de paiement) d'une facture créée."""

    @abstractmethod
    def list_invoices(
        self, updated_since: datetime | None = None
    ) -> list[ProviderInvoiceRef]:
        """Liste/synchronise les factures (polling incrémental, pas de webhooks)."""


class PdpProvider(Provider):
    """Plateforme de dématérialisation (dépôt + suivi du lifecycle e-facture).

    Chorus Pro est déjà incarné par les modules ``chorus_flux_*`` : à terme cet
    existant sera formalisé derrière cette interface, sans réécriture.
    """

    role = ProviderRole.PDP

    @abstractmethod
    def deposit(
        self,
        document: bytes,
        *,
        filename: str,
        format_flux: str,
        syntaxe_flux: str,
    ) -> ProviderInvoiceRef:
        """Dépose un flux (UBL/CII/Factur-X) sur la PDP."""

    @abstractmethod
    def get_lifecycle_status(self, external_id: str) -> InvoiceStatus:
        """Relit le statut lifecycle (déposé / rejeté / accepté / …)."""
