"""Règles métier applicables au recyclage d'une facture Chorus Pro."""
from __future__ import annotations

from typing import Any


ERROR_CODE = "INVALID_RECYCLE_PAYLOAD"


class InvalidRecyclePayloadError(ValueError):
    """Le payload tente de modifier une donnée hors acheminement."""

    def __init__(self, message: str, *, field: str | None = None) -> None:
        self.field = field
        super().__init__(message)

    def to_error_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "ok": False,
            "error_code": ERROR_CODE,
            "error": str(self),
        }
        if self.field:
            payload["field"] = self.field
        return payload


def _reject_unknown_fields(
    value: dict[str, Any],
    *,
    allowed: set[str],
    prefix: str = "",
) -> None:
    unknown = sorted(set(value) - allowed)
    if not unknown:
        return

    field = f"{prefix}{unknown[0]}"
    raise InvalidRecyclePayloadError(
        f"Le champ {field} ne peut pas être modifié lors d'un recyclage.",
        field=field,
    )


def _optional_text(value: Any, *, field: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise InvalidRecyclePayloadError(
            f"Le champ {field} doit être une chaîne de caractères.",
            field=field,
        )
    normalized = value.strip()
    return normalized or None


def prepare_recycle_payload(
    payload: dict[str, Any],
    *,
    allow_comment: bool = False,
) -> dict[str, Any]:
    """Valide et réduit un payload aux seules données de routage autorisées."""
    if not isinstance(payload, dict):
        raise InvalidRecyclePayloadError("Le payload de recyclage doit être un objet JSON.")

    allowed_top_level = {"identifiantFactureCPP", "destinataire", "reference"}
    if allow_comment:
        allowed_top_level.add("commentaire")
    _reject_unknown_fields(payload, allowed=allowed_top_level)

    invoice_id = payload.get("identifiantFactureCPP")
    if isinstance(invoice_id, bool) or not isinstance(invoice_id, int) or invoice_id <= 0:
        raise InvalidRecyclePayloadError(
            "Le champ identifiantFactureCPP doit être un entier positif.",
            field="identifiantFactureCPP",
        )

    destinataire = payload.get("destinataire")
    if not isinstance(destinataire, dict):
        raise InvalidRecyclePayloadError(
            "Le champ destinataire est obligatoire et doit être un objet JSON.",
            field="destinataire",
        )
    _reject_unknown_fields(
        destinataire,
        allowed={"codeDestinataire", "codeServiceExecutant"},
        prefix="destinataire.",
    )

    recipient_code = _optional_text(
        destinataire.get("codeDestinataire"),
        field="destinataire.codeDestinataire",
    )
    if not recipient_code:
        raise InvalidRecyclePayloadError(
            "Le SIRET ou code destinataire Chorus est obligatoire.",
            field="destinataire.codeDestinataire",
        )

    prepared: dict[str, Any] = {
        "destinataire": {"codeDestinataire": recipient_code},
        "identifiantFactureCPP": invoice_id,
    }

    service_code = _optional_text(
        destinataire.get("codeServiceExecutant"),
        field="destinataire.codeServiceExecutant",
    )
    if service_code:
        prepared["destinataire"]["codeServiceExecutant"] = service_code

    reference = payload.get("reference")
    if reference is not None:
        if not isinstance(reference, dict):
            raise InvalidRecyclePayloadError(
                "Le champ reference doit être un objet JSON.",
                field="reference",
            )
        _reject_unknown_fields(
            reference,
            allowed={"numeroBonCommande"},
            prefix="reference.",
        )
        commitment_number = _optional_text(
            reference.get("numeroBonCommande"),
            field="reference.numeroBonCommande",
        )
        if commitment_number:
            prepared["reference"] = {"numeroBonCommande": commitment_number}

    if allow_comment:
        comment = _optional_text(payload.get("commentaire"), field="commentaire")
        if comment:
            prepared["commentaire"] = comment

    return prepared
