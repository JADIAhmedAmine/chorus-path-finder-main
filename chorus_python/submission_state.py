"""Validation de l'état de la demande de paiement avant soumission Chorus Pro.

Chorus Pro retourne le code `GDP_MSG_11.001` lorsqu'on tente de soumettre
une demande de paiement dont l'état courant n'est pas compatible avec
l'action ciblée. La soumission générique est réservée à `BROUILLON` et
`ERREUR_FOURNISSEUR_SUR_VALIDEUR`. `A_RECYCLER` doit passer par l'action
de recyclage dédiée, limitée aux données d'acheminement.
"""
from __future__ import annotations

from typing import Any


ALLOWED_SUBMISSION_STATES: frozenset[str] = frozenset(
    {
        "BROUILLON",
        "ERREUR_FOURNISSEUR_SUR_VALIDEUR",
    }
)

ERROR_CODE = "INVALID_PAYMENT_REQUEST_STATE"

# Clés top-level acceptées dans le corps de requête pour véhiculer l'état courant.
PAYMENT_REQUEST_STATE_BODY_KEYS: tuple[str, ...] = (
    "currentState",
    "paymentRequestState",
    "statutCourant",
    "statutCourantCode",
)


class InvalidPaymentRequestStateError(Exception):
    """État de la demande de paiement incompatible avec la soumission."""

    def __init__(self, *, current_state: str | None, reason: str) -> None:
        self.current_state = current_state
        self.reason = reason
        self.allowed_states: list[str] = sorted(ALLOWED_SUBMISSION_STATES)
        super().__init__(self._build_message())

    def _build_message(self) -> str:
        allowed = ", ".join(self.allowed_states)
        if self.reason == "rejected":
            return (
                "La demande de paiement ne peut pas être soumise car son état "
                f"est {self.current_state}. Les états autorisés sont {allowed}."
            )
        if self.reason == "recyclable":
            return (
                "La demande de paiement est à recycler. Utilisez l'action de "
                "recyclage dédiée pour corriger uniquement son acheminement."
            )
        if self.reason == "missing":
            return (
                "État de la demande de paiement absent. "
                f"Les états autorisés pour la soumission sont {allowed}."
            )
        return (
            f"État de la demande de paiement inconnu : {self.current_state}. "
            f"Les états autorisés pour la soumission sont {allowed}."
        )

    def to_error_payload(self) -> dict[str, Any]:
        return {
            "success": False,
            "error_code": ERROR_CODE,
            "current_state": self.current_state,
            "allowed_states": list(self.allowed_states),
            "reason": self.reason,
            "message": str(self),
        }


def normalize_payment_request_state(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().upper()
    return normalized or None


def extract_payment_request_state(body: dict[str, Any] | None) -> tuple[bool, str | None]:
    """Retourne (présent, valeur normalisée).

    `présent=True` signifie que l'appelant a explicitement renseigné une
    clé d'état (même vide). `valeur` peut être `None` si la clé est vide.
    """
    if not isinstance(body, dict):
        return False, None
    for key in PAYMENT_REQUEST_STATE_BODY_KEYS:
        if key in body:
            return True, normalize_payment_request_state(body.get(key))
    return False, None


def validate_payment_request_state(state: Any) -> str:
    """Vérifie que `state` autorise la soumission.

    Lève `InvalidPaymentRequestStateError` si l'état est `REJETEE`,
    `A_RECYCLER`, absent ou inconnu. Retourne l'état normalisé en cas de succès.
    """
    normalized = normalize_payment_request_state(state)
    if normalized is None:
        raise InvalidPaymentRequestStateError(current_state=None, reason="missing")
    if normalized == "REJETEE":
        raise InvalidPaymentRequestStateError(current_state=normalized, reason="rejected")
    if normalized == "A_RECYCLER":
        raise InvalidPaymentRequestStateError(current_state=normalized, reason="recyclable")
    if normalized not in ALLOWED_SUBMISSION_STATES:
        raise InvalidPaymentRequestStateError(current_state=normalized, reason="unknown")
    return normalized
