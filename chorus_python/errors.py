"""Normalisation des erreurs Chorus Pro / PISTE.

L'objectif est de convertir les libellés bruts (souvent techniques) en
catégorie + message humain + action recommandée + sévérité, pour qu'ils
puissent être affichés sans jargon dans l'UI ou les logs d'audit.

Module pur : pas d'I/O, pas de dépendance réseau. Testable isolément.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable


Severity = str  # "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"

CATEGORY_STATUS_NOT_ALLOWED = "STATUS_NOT_ALLOWED"
CATEGORY_BUSINESS_REJECTION = "BUSINESS_REJECTION"
CATEGORY_VALIDATION = "VALIDATION"
CATEGORY_AUTH = "AUTH"
CATEGORY_RATE_LIMIT = "RATE_LIMIT"
CATEGORY_NOT_FOUND = "NOT_FOUND"
CATEGORY_NETWORK = "NETWORK"
CATEGORY_UNKNOWN = "UNKNOWN"


@dataclass(frozen=True)
class NormalizedChorusError:
    category: str
    human_message: str
    recommended_action: str
    severity: Severity
    raw_message: str
    code_retour: int | None = None
    chorus_code: str | None = None
    matched_states: tuple[str, ...] = field(default_factory=tuple)

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "category": self.category,
            "human_message": self.human_message,
            "recommended_action": self.recommended_action,
            "severity": self.severity,
            "raw_message": self.raw_message,
        }
        if self.code_retour is not None:
            payload["code_retour"] = self.code_retour
        if self.chorus_code:
            payload["chorus_code"] = self.chorus_code
        if self.matched_states:
            payload["matched_states"] = list(self.matched_states)
        return payload


@dataclass(frozen=True)
class _RuleHit:
    category: str
    severity: Severity
    human_message: str
    recommended_action: str


# Codes Chorus connus (préfixe `XXX_MSG_NN.NNN`) — table volontairement courte,
# on l'étoffera au fur et à mesure des cas rencontrés en production.
_CHORUS_CODE_RULES: dict[str, _RuleHit] = {
    "GDP_MSG_11.001": _RuleHit(
        category=CATEGORY_STATUS_NOT_ALLOWED,
        severity="HIGH",
        human_message=(
            "Cette action est impossible : l'état actuel de la demande de paiement ne l'autorise pas."
        ),
        recommended_action=(
            "Corrigez, recyclez ou créez une nouvelle demande dans Chorus Pro avant de réessayer."
        ),
    ),
    "GCU_MSG_01_000": _RuleHit(
        category=CATEGORY_BUSINESS_REJECTION,
        severity="LOW",
        human_message="Chorus Pro a retourné un avertissement métier sans bloquer l'opération.",
        recommended_action="Vérifier le détail dans l'historique Chorus si l'écart est inattendu.",
    ),
}

# Heuristiques par mots-clés (français). On évite les regex coûteuses : les
# libellés Chorus tournent autour d'un vocabulaire restreint.
_KEYWORD_RULES: tuple[tuple[tuple[str, ...], _RuleHit], ...] = (
    (
        ("rejet", "rejetee"),
        _RuleHit(
            category=CATEGORY_BUSINESS_REJECTION,
            severity="HIGH",
            human_message="La facture est rejetée côté destinataire public.",
            recommended_action=(
                "Vérifier le motif de rejet dans Chorus Pro, corriger les données puis recycler la facture."
            ),
        ),
    ),
    (
        ("siret",),
        _RuleHit(
            category=CATEGORY_VALIDATION,
            severity="MEDIUM",
            human_message="Un SIRET fourni n'est pas reconnu ou n'est plus actif côté Chorus Pro.",
            recommended_action="Mettre à jour le SIRET ou la fiche destinataire et relancer.",
        ),
    ),
    (
        ("token", "oauth", "unauthorized", "401"),
        _RuleHit(
            category=CATEGORY_AUTH,
            severity="CRITICAL",
            human_message="L'authentification PISTE a échoué.",
            recommended_action=(
                "Renouveler le token OAuth ou vérifier les identifiants CHORUS_CLIENT_ID/SECRET."
            ),
        ),
    ),
    (
        ("too many", "rate", "429"),
        _RuleHit(
            category=CATEGORY_RATE_LIMIT,
            severity="MEDIUM",
            human_message="Le quota PISTE est temporairement dépassé.",
            recommended_action="Réessayer après une courte attente (ou réduire la cadence de synchronisation).",
        ),
    ),
    (
        ("introuvable", "not found", "404"),
        _RuleHit(
            category=CATEGORY_NOT_FOUND,
            severity="MEDIUM",
            human_message="La ressource demandée n'a pas été trouvée côté Chorus Pro.",
            recommended_action="Vérifier que l'identifiant facture / structure est correct et actif.",
        ),
    ),
    (
        ("réseau", "reseau", "timeout", "connection", "502", "503", "504"),
        _RuleHit(
            category=CATEGORY_NETWORK,
            severity="MEDIUM",
            human_message="Chorus Pro / PISTE est momentanément injoignable.",
            recommended_action="Réessayer dans quelques minutes ; si le problème persiste, vérifier l'état du service PISTE.",
        ),
    ),
)


# Liste des états de demande de paiement autorisés pour une soumission ; utilisée
# pour enrichir la sortie quand le libellé Chorus mentionne explicitement la
# règle d'état (GDP_MSG_11.001).
_ALLOWED_STATES_FOR_SUBMISSION: tuple[str, ...] = (
    "BROUILLON",
    "ERREUR_FOURNISSEUR_SUR_VALIDEUR",
    "A_RECYCLER",
)


def _extract_chorus_code(raw_message: str) -> str | None:
    """Récupère un code du type `GDP_MSG_11.001` ou `GCU_MSG_01_000`."""
    if not raw_message:
        return None
    for token in raw_message.split():
        stripped = token.strip(" .,;:-—")
        if "_MSG_" in stripped and 8 <= len(stripped) <= 24:
            return stripped
    return None


def _extract_states(raw_message: str) -> tuple[str, ...]:
    if not raw_message:
        return ()
    upper = raw_message.upper()
    return tuple(state for state in _ALLOWED_STATES_FOR_SUBMISSION if state in upper)


def _match_keyword_rule(raw_lower: str) -> _RuleHit | None:
    for keywords, rule in _KEYWORD_RULES:
        if any(keyword in raw_lower for keyword in keywords):
            return rule
    return None


def normalize_chorus_error(
    raw_message: Any,
    *,
    code_retour: int | None = None,
) -> NormalizedChorusError:
    """Transforme un libellé Chorus Pro brut en erreur normalisée.

    Le résultat est volontairement déterministe et sans I/O : on peut le
    consommer côté API ou côté worker sans risque.
    """
    text = str(raw_message).strip() if raw_message is not None else ""
    chorus_code = _extract_chorus_code(text)
    matched_states = _extract_states(text)

    rule: _RuleHit | None = None
    if chorus_code and chorus_code in _CHORUS_CODE_RULES:
        rule = _CHORUS_CODE_RULES[chorus_code]
    if rule is None:
        rule = _match_keyword_rule(text.lower())

    if rule is None:
        return NormalizedChorusError(
            category=CATEGORY_UNKNOWN,
            human_message=(
                "Une erreur Chorus Pro n'a pas pu être interprétée automatiquement."
            ),
            recommended_action=(
                "Consulter le détail technique avec l'équipe support Chorus Pilot pour qualifier le motif."
            ),
            severity="LOW",
            raw_message=text,
            code_retour=code_retour,
            chorus_code=chorus_code,
            matched_states=matched_states,
        )

    return NormalizedChorusError(
        category=rule.category,
        human_message=rule.human_message,
        recommended_action=rule.recommended_action,
        severity=rule.severity,
        raw_message=text,
        code_retour=code_retour,
        chorus_code=chorus_code,
        matched_states=matched_states,
    )


def normalize_chorus_errors(
    items: Iterable[tuple[Any, int | None]],
) -> list[NormalizedChorusError]:
    return [normalize_chorus_error(message, code_retour=code) for message, code in items]
