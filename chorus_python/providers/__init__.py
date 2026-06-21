"""Couche d'intégration multi-provider (ERP / PDP).

Cette couche introduit une interface générique permettant à Chorus Pilot de
parler à plusieurs systèmes externes derrière un contrat commun :

- ``ErpProvider`` : système *source* de factures (ex. Sage Accounting, Cegid…) ;
- ``PdpProvider`` : *plateforme de dématérialisation* de routing (ex. Chorus Pro,
  Sage Network…).

Le routing produit se modélise ensuite sur deux axes : « quel ERP source » ×
« quelle PDP destination ».

Sécurité : aucun secret, token ou contenu de facture n'est journalisé par cette
couche (voir ``ProviderError`` et le token manager).
"""

from __future__ import annotations

from .base import (
    ErpProvider,
    InvoiceStatus,
    PdpProvider,
    Provider,
    ProviderAuthError,
    ProviderError,
    ProviderInvoiceRef,
    ProviderRateLimitError,
    ProviderRole,
    ReferenceResolution,
)
from .oauth import (
    InMemoryTokenStore,
    OAuth2Config,
    OAuth2Token,
    OAuth2TokenManager,
    TokenStore,
)

__all__ = [
    "ErpProvider",
    "InvoiceStatus",
    "PdpProvider",
    "Provider",
    "ProviderAuthError",
    "ProviderError",
    "ProviderInvoiceRef",
    "ProviderRateLimitError",
    "ProviderRole",
    "ReferenceResolution",
    "InMemoryTokenStore",
    "OAuth2Config",
    "OAuth2Token",
    "OAuth2TokenManager",
    "TokenStore",
]
