from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any

import requests

from .config import ChorusSettings
from .files import detect_extension, detect_mime_type, pdf_to_base64


TVA_CODE_FALLBACK_BY_PERCENT = {
    Decimal("20"): "TV12",
}


def join_url(base_url: str, path: str) -> str:
    if not path:
        return base_url
    return f"{base_url.rstrip('/')}/{path.lstrip('/')}"


def parse_rate_percent(label: str | None) -> Decimal | None:
    if not label:
        return None
    match = re.search(r"(\d+(?:[.,]\d+)?)\s*%", label)
    if not match:
        return None
    return Decimal(match.group(1).replace(",", "."))


def as_int(value: Any) -> int | None:
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str) and value.strip():
        try:
            return int(value)
        except ValueError:
            return None
    return None


def find_first_integer(value: Any, candidate_keys: tuple[str, ...]) -> int | None:
    if isinstance(value, dict):
        for key in candidate_keys:
            maybe = as_int(value.get(key))
            if maybe is not None and maybe > 0:
                return maybe

        for nested in value.values():
            maybe = find_first_integer(nested, candidate_keys)
            if maybe is not None:
                return maybe

    if isinstance(value, list):
        for item in value:
            maybe = find_first_integer(item, candidate_keys)
            if maybe is not None:
                return maybe

    return None


@dataclass(slots=True)
class ChorusRecipientMatch:
    code_destinataire: str
    code_service_executant: str
    id_structure_cpp: int | None = None


@dataclass(slots=True)
class ChorusUploadAttachmentResult:
    piece_jointe_id: int
    response: Any


class ChorusApiError(RuntimeError):
    pass


class ChorusClient:
    def __init__(self, settings: ChorusSettings, session: requests.Session | None = None) -> None:
        self.settings = settings
        self.session = session or requests.Session()
        self._access_token: str | None = None

    def _fetch_oauth_token(self) -> str:
        if self._access_token:
            return self._access_token

        response = self.session.post(
            self.settings.token_url,
            data={
                "grant_type": "client_credentials",
                "client_id": self.settings.client_id,
                "client_secret": self.settings.client_secret,
                "scope": self.settings.scope or "openid",
            },
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
            },
            timeout=self.settings.timeout_seconds,
        )

        try:
            body = response.json()
        except ValueError:
            body = response.text.strip()

        if not response.ok:
            raise ChorusApiError(f"Récupération du token OAuth2 échouée ({response.status_code}): {body}")

        access_token = body.get("access_token") if isinstance(body, dict) else None
        if not isinstance(access_token, str) or not access_token.strip():
            raise ChorusApiError("Réponse OAuth2 invalide: access_token absent.")

        self._access_token = access_token.strip()
        return self._access_token

    def _authorization_header(self) -> str:
        if self.settings.api_key.strip():
            return self.settings.authorization_header()
        return f"Bearer {self._fetch_oauth_token()}"

    def _headers(self) -> dict[str, str]:
        self.settings.validate_for_api_access()
        return {
            "Authorization": self._authorization_header(),
            "Accept": "application/json;charset=utf-8",
            "Content-Type": "application/json;charset=utf-8",
            "cpro-account": self.settings.cpro_account,
        }

    def _post_json(self, path: str, payload: dict[str, Any], label: str) -> Any:
        response = self.session.post(
            join_url(self.settings.base_url, path),
            json=payload,
            headers=self._headers(),
            timeout=self.settings.timeout_seconds,
        )

        try:
            body = response.json()
        except ValueError:
            body = response.text.strip()

        if not response.ok:
            raise ChorusApiError(f"{label} échoué ({response.status_code}): {body}")

        return body

    def fetch_tva_rates(self, code_langue: str = "FR") -> list[dict[str, Any]]:
        body = self._post_json(
            "/transverses/v1/recuperer/tauxtva",
            {"codeLangue": code_langue},
            "Récupération des taux TVA",
        )
        return body.get("listeTauxTva", []) if isinstance(body, dict) else []

    def resolve_tva_code(self, vat_rate_percent: Decimal) -> str:
        normalized_rate = vat_rate_percent.normalize()
        for item in self.fetch_tva_rates():
            code = str(item.get("codeTauxTva") or "").strip()
            label = str(item.get("libelleTauxTva") or "").strip()
            rate = parse_rate_percent(label)
            if code and rate is not None and rate.normalize() == normalized_rate:
                return code

        # TODO: keep only API-driven resolution once the TVA catalog is always available in the target environment.
        fallback = TVA_CODE_FALLBACK_BY_PERCENT.get(normalized_rate)
        if fallback:
            return fallback

        raise ChorusApiError(f"Aucun code TVA Chorus trouvé pour le taux {vat_rate_percent}%.")

    def fetch_active_supplier_structures(self) -> list[dict[str, Any]]:
        body = self._post_json(
            "/transverses/v1/recuperer/structures/actives/fournisseur",
            {},
            "Récupération des structures actives fournisseur",
        )
        return body.get("listeStructures", []) if isinstance(body, dict) else []

    def resolve_supplier_id(self, supplier_id: int | None) -> int:
        if supplier_id is not None:
            return supplier_id

        structures = self.fetch_active_supplier_structures()
        if len(structures) == 1:
            resolved = as_int(structures[0].get("idStructureCPP"))
            if resolved is not None:
                return resolved

        raise ChorusApiError(
            "Impossible de déduire idFournisseur automatiquement. "
            "Renseigne supplier_id ou CHORUS_SUPPLIER_ID."
        )

    def search_recipients(self, code_destinataire: str) -> list[dict[str, Any]]:
        body = self._post_json(
            "/transverses/v1/rechercher/destinataire",
            {
                "identifiant": code_destinataire,
                "nomVilleCodePostal": None,
                "typeStructure": "PUBLIQUE",
                "parametresRecherche": {
                    "pageResultatDemandee": 1,
                    "nbResultatsParPage": 10,
                    "triSens": "Ascendant",
                    "triColonne": "NomDestinataire",
                },
            },
            "Recherche du destinataire",
        )
        return body.get("listeDestinataires", []) if isinstance(body, dict) else []

    def search_operating_services(self, id_destinataire_cpp: int, code_service_executant: str | None = None) -> list[dict[str, Any]]:
        body = self._post_json(
            "/transverses/v1/rechercher/serviceexecutant",
            {
                "idDestinataireCPP": id_destinataire_cpp,
                "codeServiceExecutant": code_service_executant or None,
                "nomServiceExecutant": None,
                "actif": True,
                "parametresRecherche": {
                    "pageResultatDemandee": 1,
                    "nbResultatsParPage": 20,
                    "triSens": "Descendant",
                    "triColonne": "NomServiceExecutant",
                },
            },
            "Recherche du service exécutant",
        )
        return body.get("listeServices", []) if isinstance(body, dict) else []

    def resolve_recipient_and_service(
        self,
        code_destinataire: str,
        code_service_executant: str | None,
    ) -> ChorusRecipientMatch:
        if code_service_executant:
            return ChorusRecipientMatch(
                code_destinataire=code_destinataire,
                code_service_executant=code_service_executant,
                id_structure_cpp=None,
            )

        recipients = self.search_recipients(code_destinataire)
        matched = None
        for item in recipients:
            identifier = str(item.get("siret") or "").replace(" ", "")
            if identifier == code_destinataire.replace(" ", ""):
                matched = item
                break

        if matched is None and len(recipients) == 1:
            matched = recipients[0]

        if matched is None:
            raise ChorusApiError(
                "Impossible de déterminer le destinataire Chorus automatiquement. "
                "Renseigne codeDestinataire et codeServiceExecutant explicitement."
            )

        id_structure_cpp = as_int(matched.get("idStructureCPP"))
        if id_structure_cpp is None:
            raise ChorusApiError("Le destinataire trouvé ne contient pas idStructureCPP.")

        services = self.search_operating_services(id_structure_cpp)
        available_codes = [
            str(item.get("codeServiceExecutant") or "").strip()
            for item in services
            if str(item.get("codeServiceExecutant") or "").strip()
        ]

        if len(available_codes) == 1:
            return ChorusRecipientMatch(
                code_destinataire=code_destinataire,
                code_service_executant=available_codes[0],
                id_structure_cpp=id_structure_cpp,
            )

        raise ChorusApiError(
            "Impossible de choisir automatiquement codeServiceExecutant. "
            "Renseigne-le explicitement dans la commande ou via CHORUS_SERVICE_EXECUTANT_CODE."
        )

    def fetch_valid_bank_accounts(self, supplier_id: int) -> list[dict[str, Any]]:
        body = self._post_json(
            "/transverses/v1/recuperer/coordbanc/valides",
            {"idStructure": supplier_id},
            "Récupération des coordonnées bancaires valides",
        )
        return body.get("listeCoordonneeBancaire", []) if isinstance(body, dict) else []

    def resolve_bank_account_code(self, supplier_id: int, bank_account_code: int | None) -> int | None:
        if bank_account_code is not None:
            return bank_account_code

        bank_accounts = self.fetch_valid_bank_accounts(supplier_id)
        if len(bank_accounts) == 1:
            return as_int(bank_accounts[0].get("idCoordonneeBancaire"))

        # TODO: if several accounts exist, branch a real business selection rule.
        return None

    def upload_attachment(self, pdf_path: Path, current_user_id: int) -> ChorusUploadAttachmentResult:
        payload = {
            "idUtilisateurCourant": current_user_id,
            "pieceJointeExtension": detect_extension(pdf_path),
            "pieceJointeFichier": pdf_to_base64(pdf_path),
            "pieceJointeNom": pdf_path.name,
            "pieceJointeTypeMime": detect_mime_type(pdf_path),
        }
        body = self._post_json(
            "/transverses/v1/ajouter/fichier",
            payload,
            "Upload de la pièce jointe principale",
        )

        piece_jointe_id = find_first_integer(
            body,
            (
                "pieceJointeId",
                "idPieceJointe",
                "pieceJointePrincipaleId",
                "idFichier",
                "pieceJointe",
                "id",
            ),
        )
        if piece_jointe_id is None:
            raise ChorusApiError(
                "La réponse de /transverses/v1/ajouter/fichier ne contient pas d'identifiant de pièce jointe exploitable."
            )

        return ChorusUploadAttachmentResult(
            piece_jointe_id=piece_jointe_id,
            response=body,
        )

    def submit_invoice(self, payload: dict[str, Any]) -> Any:
        return self._post_json(
            "/factures/v1/soumettre",
            payload,
            "Soumission de la facture",
        )
