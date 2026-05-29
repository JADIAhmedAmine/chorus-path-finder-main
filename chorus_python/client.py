from __future__ import annotations

import os
import re
from dataclasses import dataclass
from decimal import Decimal
import json
from pathlib import Path
from typing import Any
import unicodedata

import requests

from .config import ChorusSettings
from .files import detect_extension, detect_mime_type, pdf_to_base64


TVA_CODE_FALLBACK_BY_PERCENT = {
    Decimal("1.05"): "TVA20",
    Decimal("2.1"): "TVA7",
    Decimal("5"): "TV20",
    Decimal("5.5"): "TVA8",
    Decimal("7"): "TVA9",
    Decimal("8.5"): "TVA4",
    Decimal("10"): "TV10",
    Decimal("13"): "TV11",
    Decimal("16"): "TV21",
    Decimal("19.6"): "TVA5",
    Decimal("20"): "TV12",
    Decimal("20.6"): "TV13",
}

SENSITIVE_DEBUG_KEY_PARTS = (
    "authorization",
    "api_key",
    "apikey",
    "client_secret",
    "password",
    "secret",
    "token",
)

BASE64_DEBUG_KEY_PARTS = (
    "base64",
    "fichierfacture",
    "fichierresultat",
    "file_base64",
    "piecejointefichier",
)


def join_url(base_url: str, path: str) -> str:
    if not path:
        return base_url
    return f"{base_url.rstrip('/')}/{path.lstrip('/')}"


def _normalized_debug_key(key: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", (key or "").lower())


def sanitize_debug_value(value: Any, key: str | None = None) -> Any:
    normalized_key = _normalized_debug_key(key)
    if normalized_key and any(part in normalized_key for part in SENSITIVE_DEBUG_KEY_PARTS):
        return "[masque]"

    if isinstance(value, dict):
        return {
            item_key: sanitize_debug_value(item_value, str(item_key))
            for item_key, item_value in value.items()
        }

    if isinstance(value, list):
        return [sanitize_debug_value(item) for item in value]

    if isinstance(value, str) and value:
        if normalized_key and any(part in normalized_key for part in BASE64_DEBUG_KEY_PARTS):
            preview = value[:80]
            return f"[base64 masque, {len(value)} caracteres, apercu: {preview}...]"

    return value


def sanitize_debug_payload(payload: dict[str, Any]) -> dict[str, Any]:
    sanitized = sanitize_debug_value(payload)
    return sanitized if isinstance(sanitized, dict) else {}


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


def chorus_code_retour(value: Any) -> str | None:
    if not isinstance(value, dict) or "codeRetour" not in value:
        return None

    code_retour = value.get("codeRetour")
    if isinstance(code_retour, int):
        return str(code_retour)
    if isinstance(code_retour, str) and code_retour.strip():
        return code_retour.strip()
    return None


def is_success_code_retour(value: str) -> bool:
    try:
        return int(value) == 0
    except ValueError:
        return False


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
        self._access_token_payload: dict[str, Any] | None = None
        self.api_calls: list[dict[str, Any]] = []
        self._attachment_type_cache: dict[tuple[str, str], list[dict[str, Any]]] = {}

    def reset_api_calls(self) -> None:
        self.api_calls = []

    def _sanitize_debug_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        return sanitize_debug_payload(payload)

    def _print_post_debug(self, *, label: str, url: str, payload: dict[str, Any]) -> None:
        print(f"\n[debug] POST Chorus - {label}", flush=True)
        print(f"[debug] URL: {url}", flush=True)
        print("[debug] Body:", flush=True)
        print(
            json.dumps(
                self._sanitize_debug_payload(payload),
                ensure_ascii=False,
                indent=2,
            ),
            flush=True,
        )

    def _print_post_response_debug(
        self,
        *,
        label: str,
        status_code: int,
        body: Any = None,
    ) -> None:
        print(f"[debug] Réponse Chorus - {label}: HTTP {status_code}", flush=True)

        if isinstance(body, dict):
            code_retour = body.get("codeRetour")
            libelle = body.get("libelle")
            if code_retour is not None or libelle is not None:
                print(
                    f"[debug] codeRetour={code_retour} libelle={libelle}",
                    flush=True,
                )
            parametres_retour = body.get("parametresRetour")
            if isinstance(parametres_retour, dict):
                summary = {
                    key: parametres_retour.get(key)
                    for key in ("total", "pageEnCours", "nombreResultats")
                    if parametres_retour.get(key) is not None
                }
                if summary:
                    print(f"[debug] parametresRetour: {summary}", flush=True)

        if body is None or os.environ.get("CHORUS_DEBUG_PRINT_RESPONSE", "true").strip().lower() in {"0", "false", "no", "off"}:
            return

        try:
            serialized = json.dumps(
                self._sanitize_debug_payload(body) if isinstance(body, dict) else body,
                ensure_ascii=False,
                indent=2,
                default=str,
            )
        except (TypeError, ValueError):
            serialized = repr(body)

        max_chars_raw = os.environ.get("CHORUS_DEBUG_RESPONSE_MAX_CHARS", "8000")
        try:
            max_chars = int(max_chars_raw)
        except ValueError:
            max_chars = 8000

        print("[debug] Response body:", flush=True)
        if max_chars > 0 and len(serialized) > max_chars:
            print(serialized[:max_chars], flush=True)
            print(
                f"[debug] ... (tronqué à {max_chars} caractères sur {len(serialized)}; "
                f"CHORUS_DEBUG_RESPONSE_MAX_CHARS=0 pour désactiver la troncature)",
                flush=True,
            )
        else:
            print(serialized, flush=True)

    def fetch_oauth_token_payload(self) -> dict[str, Any]:
        if self._access_token_payload:
            return dict(self._access_token_payload)

        token_payload = {
            "grant_type": "client_credentials",
            "client_id": self.settings.client_id,
            "client_secret": self.settings.client_secret,
            "scope": self.settings.scope or "openid",
        }
        self._print_post_debug(
            label="Récupération du token OAuth2",
            url=self.settings.token_url,
            payload=token_payload,
        )
        response = self.session.post(
            self.settings.token_url,
            data=token_payload,
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
            },
            timeout=self.settings.timeout_seconds,
        )
        self._print_post_response_debug(
            label="Récupération du token OAuth2",
            status_code=response.status_code,
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
        self._access_token_payload = {**body, "access_token": self._access_token}
        return dict(self._access_token_payload)

    def _fetch_oauth_token(self) -> str:
        if self._access_token:
            return self._access_token

        self.fetch_oauth_token_payload()
        if not self._access_token:
            raise ChorusApiError("Réponse OAuth2 invalide: access_token absent.")
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

    def _post_json_raw(self, path: str, payload: dict[str, Any], label: str) -> tuple[int, Any]:
        url = join_url(self.settings.base_url, path)
        headers = self._headers()
        debug_payload = self._sanitize_debug_payload(payload)
        self._print_post_debug(label=label, url=url, payload=payload)
        response = self.session.post(
            url,
            json=payload,
            headers=headers,
            timeout=self.settings.timeout_seconds,
        )
        try:
            body = response.json()
        except ValueError:
            body = response.text.strip()

        self._print_post_response_debug(
            label=label,
            status_code=response.status_code,
            body=body,
        )

        self.api_calls.append(
            {
                "label": label,
                "method": "POST",
                "url": url,
                "requestBody": debug_payload,
                "responseStatus": response.status_code,
                "responseBody": sanitize_debug_value(body),
            }
        )

        return response.status_code, body

    def _post_json(self, path: str, payload: dict[str, Any], label: str) -> Any:
        status_code, body = self._post_json_raw(path, payload, label)

        if status_code >= 400:
            raise ChorusApiError(f"{label} échoué ({status_code}): {body}")

        code_retour = chorus_code_retour(body)
        if code_retour is not None and not is_success_code_retour(code_retour):
            libelle = body.get("libelle") if isinstance(body, dict) else None
            message = f"{label} refusé par Chorus: codeRetour={code_retour}"
            if isinstance(libelle, str) and libelle.strip():
                message += f", libelle={libelle.strip()}"
            raise ChorusApiError(message)

        return body

    def _should_retry_with_modern_upload_schema(self, body: Any) -> bool:
        raw_text = body if isinstance(body, str) else json.dumps(body, ensure_ascii=False)
        return all(keyword in raw_text for keyword in ("fichierFacture", "formatDepot", "nomFichier"))

    @staticmethod
    def _attachment_type_lookup(value: Any) -> str:
        normalized = unicodedata.normalize("NFD", str(value or ""))
        without_accents = "".join(
            character
            for character in normalized
            if unicodedata.category(character) != "Mn"
        )
        return re.sub(r"[^a-z0-9]+", "", without_accents.lower())

    def fetch_attachment_types(
        self,
        *,
        type_objet: str = "FACTURE",
        code_langue: str = "fr",
    ) -> list[dict[str, Any]]:
        cache_key = (type_objet, code_langue)
        if cache_key in self._attachment_type_cache:
            return self._attachment_type_cache[cache_key]

        body = self._post_json(
            "/transverses/v1/recuperer/typespj",
            {
                "codeLangue": code_langue,
                "typeObjet": type_objet,
            },
            f"Récupération des types de pièces jointes ({type_objet})",
        )
        types = body.get("listeTypePieceJointe") if isinstance(body, dict) else None
        result = [item for item in types if isinstance(item, dict)] if isinstance(types, list) else []
        self._attachment_type_cache[cache_key] = result
        return result

    def resolve_attachment_type_code(
        self,
        attachment_type: str,
        *,
        type_objet: str = "FACTURE",
        code_langue: str = "fr",
    ) -> str:
        requested = attachment_type.strip()
        if not requested:
            return requested

        requested_lookup = self._attachment_type_lookup(requested)
        requested_upper = requested.upper()

        for item in self.fetch_attachment_types(type_objet=type_objet, code_langue=code_langue):
            code = str(item.get("codeTypePieceJointe") or "").strip()
            label = str(item.get("libelleTypePieceJointe") or "").strip()
            type_id = str(item.get("idTypePieceJointe") or "").strip()

            if (
                code.upper() == requested_upper
                or self._attachment_type_lookup(label) == requested_lookup
                or (type_id and type_id == requested)
            ):
                # Chorus rejects pieceJointeComplementaireType when given the numeric
                # idTypePieceJointe (codeRetour 20002 / GDP_MSG_11.044
                # "La pièce jointe X de type Y n'existe pas"). Return the string code
                # (codeTypePieceJointe, e.g. "DIVERS", "BC", "BL") instead.
                return code or type_id or requested

        return requested

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

    def download_active_recipient_structures(self) -> Any:
        return self._post_json(
            "/transverses/v1/recuperer/structures/actives/destinataire",
            {},
            "Récupération des structures actives destinataire",
        )

    def fetch_active_recipient_structures(self) -> list[dict[str, Any]]:
        body = self.download_active_recipient_structures()
        return body.get("listeStructures", []) if isinstance(body, dict) else []

    def _active_structure_id(self, structure: Any) -> int | None:
        if not isinstance(structure, dict):
            return None

        for key in ("idStructureCPP", "idStructure", "idFournisseur", "idDestinataireCPP", "idDestinataire"):
            resolved = as_int(structure.get(key))
            if resolved is not None:
                return resolved
        return None

    def resolve_active_recipient_structure_id(
        self,
        preferred_id: int | None = None,
        *,
        additional_preferred_ids: tuple[int, ...] = (),
    ) -> int:
        structures = self.fetch_active_recipient_structures()
        preferred_ids = tuple(
            item
            for item in (preferred_id, *additional_preferred_ids)
            if item is not None
        )

        for candidate_id in preferred_ids:
            for structure in structures:
                resolved = self._active_structure_id(structure)
                if resolved is not None and resolved == candidate_id:
                    return resolved

        for structure in structures:
            resolved = self._active_structure_id(structure)
            if resolved is not None:
                return resolved

        raise ChorusApiError("Aucune structure active destinataire ne contient idStructureCPP/idFournisseur.")

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

    def download_destinataires_annuaire(self) -> Any:
        return self._post_json(
            "/transverses/v1/telecharger/annuaire/destinataire",
            {},
            "Téléchargement de l'annuaire destinataires",
        )

    def consult_siret_information(self, siret_structure: str) -> Any:
        return self._post_json(
            "/transverses/v1/consulter/information/siret",
            {
                "siretStructure": siret_structure,
            },
            "Consultation des informations SIRET",
        )

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

    def upload_attachment_content(
        self,
        *,
        file_name: str,
        file_base64: str,
        mime_type: str,
        operation_label: str = "Upload de la pièce jointe",
    ) -> ChorusUploadAttachmentResult:
        legacy_payload: dict[str, Any] = {
            "pieceJointeExtension": detect_extension(Path(file_name)),
            "pieceJointeFichier": file_base64,
            "pieceJointeNom": file_name,
            "pieceJointeTypeMime": mime_type,
        }

        status_code, body = self._post_json_raw(
            "/transverses/v1/ajouter/fichier",
            legacy_payload,
            operation_label,
        )

        if status_code >= 400 and self._should_retry_with_modern_upload_schema(body):
            modern_payload: dict[str, Any] = {
                "fichierFacture": file_base64,
                "formatDepot": "PDF_NON_SIGNE",
                "nomFichier": file_name,
            }
            status_code, body = self._post_json_raw(
                "/transverses/v1/ajouter/fichier",
                modern_payload,
                f"{operation_label} (fallback formatDepot)",
            )

        if status_code >= 400:
            raise ChorusApiError(f"{operation_label} échoué ({status_code}): {body}")

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

    def upload_attachment(self, pdf_path: Path) -> ChorusUploadAttachmentResult:
        return self.upload_attachment_content(
            file_name=pdf_path.name,
            file_base64=pdf_to_base64(pdf_path),
            mime_type=detect_mime_type(pdf_path),
        )

    def submit_invoice(self, payload: dict[str, Any]) -> Any:
        return self._post_json(
            "/factures/v1/soumettre",
            payload,
            "Soumission de la facture",
        )

    def search_supplier_invoices(self, payload: dict[str, Any]) -> Any:
        return self._post_json(
            "/factures/v1/rechercher/fournisseur",
            payload,
            "Recherche des factures fournisseur",
        )
