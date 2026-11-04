"""Normalisation des comptes rendus Chorus Pro (consulterCR / consulterCRDetaille).

Module *pur* (aucune dépendance réseau ni base) → testable directement.
Source des contrats : `CHORUS_SPEC_EXTRACT.md` (spec V5.00). Les 9 états officiels
`etatCourantFlux` sont la source de vérité ; aucun champ officiel n'est inventé.
"""

from __future__ import annotations

import unicodedata
from typing import Any, Optional


# (id stable camelCase, libellé officiel FR) — spec V5.00 `etatCourantFlux`.
OFFICIAL_FLUX_STATES: tuple[tuple[str, str], ...] = (
    ("recu", "Reçu"),
    ("traiteSeCpp", "Traité SE CPP"),
    ("enAttenteTraitement", "En attente de traitement"),
    ("enCoursTraitement", "En cours de traitement"),
    ("incidente", "Incidenté"),
    ("rejete", "Rejeté"),
    ("enAttenteRetraitement", "En attente de retraitement"),
    ("integre", "Intégré"),
    ("integrePartiellement", "Intégré partiellement"),
)
LABEL_BY_ID: dict[str, str] = dict(OFFICIAL_FLUX_STATES)


def _slug(text: Any) -> str:
    """Minuscule, sans accents, espaces normalisés (pour matcher les variantes Chorus)."""
    if not isinstance(text, str):
        return ""
    decomposed = unicodedata.normalize("NFKD", text)
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return " ".join(stripped.lower().split())


_ID_BY_SLUG: dict[str, str] = {_slug(label): sid for sid, label in OFFICIAL_FLUX_STATES}


def canonical_etat_courant(text: Any) -> Optional[tuple[str, str]]:
    """Renvoie (id, libellé officiel) pour un état Chorus, ou None si non reconnu."""
    sid = _ID_BY_SLUG.get(_slug(text))
    return (sid, LABEL_BY_ID[sid]) if sid else None


def official_id_for_label(label: Any) -> Optional[str]:
    """Renvoie l'id officiel d'un libellé `etat_courant_flux` stocké (ou None)."""
    result = canonical_etat_courant(label)
    return result[0] if result else None


def _s(value: Any) -> Optional[str]:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def normalize_cr_detaille(raw: Any) -> dict[str, Any]:
    """Normalise une réponse `consulterCRDetaille`.

    Extrait l'état officiel, `listeErreurTechnique` (flux) et `listeErreurDP` (factures
    en erreur, avec `numeroDP` / `libelleErreurDP`). `invoice_count` reste None : le
    nombre total de factures n'est PAS fourni par consulterCRDetaille (cf. spec).
    """
    body = raw if isinstance(raw, dict) else {}
    etat_raw = body.get("etatCourantDepotFlux") or body.get("etatCourantFlux")
    canon = canonical_etat_courant(etat_raw) if etat_raw else None

    technique: list[dict[str, Any]] = []
    for item in _as_list(body.get("listeErreurTechnique")):
        if isinstance(item, dict):
            technique.append(
                {
                    "nature": _s(item.get("natureErreur")),
                    "code": item.get("codeErreur"),
                    "libelle": _s(item.get("libelleErreur")),
                }
            )

    dp_errors: list[dict[str, Any]] = []
    for item in _as_list(body.get("listeErreurDP")):
        if isinstance(item, dict):
            dp_errors.append(
                {
                    "numeroDP": _s(item.get("numeroDP")),
                    "libelle": _s(item.get("libelleErreurDP")),
                    "identifiantFournisseur": item.get("identifiantFournisseur"),
                    "identifiantDestinataire": item.get("identifiantDestinataire"),
                }
            )

    return {
        "etatCourantFluxId": canon[0] if canon else None,
        "etatCourantFlux": canon[1] if canon else _s(etat_raw),
        "etatRecognized": canon is not None,
        "listeErreurTechnique": technique,
        "listeErreurDP": dp_errors,
        "technicalErrorCount": len(technique),
        "dpErrorCount": len(dp_errors),
        "errorCount": len(technique) + len(dp_errors),
        "invoiceCount": None,  # not_available : non fourni par consulterCRDetaille (spec)
        "dateHeureEtat": _s(body.get("dateHeureEtatCourantFlux")),
        "nomFichier": _s(body.get("nomFichier")),
        "codeInterface": _s(body.get("codeInterfaceDepotFlux")),
        "source": "consulterCRDetaille",
    }


def normalize_cr(raw: Any) -> dict[str, Any]:
    """Normalise une réponse `consulterCR` (plus simple : état + code interface)."""
    body = raw if isinstance(raw, dict) else {}
    etat_raw = body.get("etatCourantFlux") or body.get("etatCourantDepotFlux")
    canon = canonical_etat_courant(etat_raw) if etat_raw else None
    return {
        "etatCourantFluxId": canon[0] if canon else None,
        "etatCourantFlux": canon[1] if canon else _s(etat_raw),
        "etatRecognized": canon is not None,
        "listeErreurTechnique": [],
        "listeErreurDP": [],
        "technicalErrorCount": 0,
        "dpErrorCount": 0,
        "errorCount": 0,
        "invoiceCount": None,
        "codeInterface": _s(body.get("codeInterfaceFlux")),
        "hasFichierCr": bool(body.get("fichierCR")),
        "source": "consulterCR",
    }
