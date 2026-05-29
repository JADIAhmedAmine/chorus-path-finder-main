from __future__ import annotations

from copy import deepcopy
from decimal import Decimal
from typing import Any

from .client import ChorusClient, ChorusUploadAttachmentResult, as_int
from .config import ChorusSettings
from .files import is_signed_pdf_base64, is_signed_pdf_path
from .models import ChorusMinimalInvoiceInput
from .payload import build_minimal_submission_payload
from .soumission import (
    DEFAULT_MODE_DEPOT,
    DEFAULT_PIECE_JOINTE_PRINCIPALE_DESIGNATION,
    SIGNED_PDF_MODE_DEPOT,
    SoumissionFacture,
)


DEFAULT_COMPLEMENTARY_ATTACHMENT_TYPE = "DIVERS"
DEFAULT_SUBMISSION_VAT_TYPE = "TVA_SUR_DEBIT"
COMPLEMENTARY_ATTACHMENT_TYPE_ALIASES = {
    "Attestation": "ATTESTATION",
    "Attestation administrative": "ATTESTATION",
    "Attestation ou certificat administratif": "ATTESTATION",
    "Bon de commande": "BC",
    "Bon de livraison": "BL",
    "Bordereau de suivi": "BORDEREAU_SUIVI",
    "Bordereau de suivi de validation": "BORDEREAU_SUIVI_VALIDATION",
    "Décision d'admission": "DECISION_ADMISSION",
    "Decision d'admission": "DECISION_ADMISSION",
    "Décision de réception": "DECISION_RECEPTION",
    "Decision de réception": "DECISION_RECEPTION",
    "Devis": "DEVIS",
    "Document annexe": "DIVERS",
    "Duplicata Factur-X": "DUPLICATA_FACTUR-X",
    "Échéancier": "ECHEANCIER",
    "Echeancier": "ECHEANCIER",
    "Facture PDF": "FACTURE_PDF",
    "Facture XML": "FACTURE_XML",
    "Ordre de service": "OS",
    "Procès-verbal de service fait": "PVSF",
    "Procès-verbal de service fait ou de réception": "PVSF",
    "Relevé d'identité bancaire": "RIB",
    "BON_COMMANDE": "BC",
    "BON_LIVRAISON": "BL",
    "DOCUMENT_ANNEXE": "DIVERS",
}


def normalize_complementary_attachment_type(value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        return DEFAULT_COMPLEMENTARY_ATTACHMENT_TYPE

    attachment_type = value.strip()
    return COMPLEMENTARY_ATTACHMENT_TYPE_ALIASES.get(attachment_type, attachment_type)


def resolve_complementary_attachment_type(client: ChorusClient, value: Any) -> str:
    fallback_type = normalize_complementary_attachment_type(value)
    resolver = getattr(client, "resolve_attachment_type_code", None)
    if not callable(resolver):
        return fallback_type

    try:
        return resolver(fallback_type, type_objet="FACTURE") or fallback_type
    except Exception as exc:
        print(
            f"Warning: récupération des types de pièces jointes Chorus impossible, "
            f"fallback sur {fallback_type}: {exc}"
        )
        return fallback_type


def normalize_submission_vat_type(value: Any) -> str:
    return DEFAULT_SUBMISSION_VAT_TYPE if value == "TVA_SUR_ENCAISSEMENT" else str(value or DEFAULT_SUBMISSION_VAT_TYPE)


def enforce_submission_vat_type(payload: dict[str, Any]) -> None:
    references = payload.get("references")
    if not isinstance(references, dict):
        references = {}
        payload["references"] = references

    references["typeTva"] = normalize_submission_vat_type(references.get("typeTva"))


def enforce_recycle_vat_type(payload: dict[str, Any]) -> None:
    reference = payload.get("reference")
    if not isinstance(reference, dict):
        reference = {}
        payload["reference"] = reference

    reference["typeTva"] = normalize_submission_vat_type(reference.get("typeTva"))


def mode_depot_for_pdf(is_signed: bool) -> str:
    return SIGNED_PDF_MODE_DEPOT if is_signed else DEFAULT_MODE_DEPOT


class ChorusSubmissionService:
    def __init__(self, settings: ChorusSettings, client: ChorusClient | None = None) -> None:
        self.settings = settings
        self.client = client or ChorusClient(settings)

    def _resolve_real_supplier_id(self, *preferred_ids: int | None) -> int:
        preferred_id = next((item for item in preferred_ids if item is not None), None)
        additional_preferred_ids = tuple(
            item
            for item in preferred_ids
            if item is not None and item != preferred_id
        )
        return self.client.resolve_active_recipient_structure_id(
            preferred_id,
            additional_preferred_ids=additional_preferred_ids,
        )

    def _prepare_submission(self, invoice: ChorusMinimalInvoiceInput) -> tuple[dict[str, Any], ChorusUploadAttachmentResult | None]:
        supplier_id = self._resolve_real_supplier_id(invoice.supplier_id, self.settings.default_supplier_id)
        recipient_code = invoice.recipient_code or self.settings.default_code_destinataire
        if not recipient_code:
            raise ValueError("codeDestinataire manquant.")

        upload_result: ChorusUploadAttachmentResult | None = None
        if invoice.pdf_path is not None:
            upload_result = self.client.upload_attachment(invoice.pdf_path)

        if upload_result is not None:
            mode_depot = mode_depot_for_pdf(
                is_signed_pdf_path(invoice.pdf_path) if invoice.pdf_path is not None else False
            )
            payload = SoumissionFacture.from_invoice(
                invoice,
                code_destinataire=recipient_code,
                id_fournisseur=supplier_id,
                piece_jointe_principale_id=upload_result.piece_jointe_id,
                piece_jointe_principale_designation=(
                    invoice.pdf_designation or DEFAULT_PIECE_JOINTE_PRINCIPALE_DESIGNATION
                ),
                mode_depot=mode_depot,
            ).to_payload()
            return payload, upload_result

        requested_service_code = invoice.service_executant_code or self.settings.default_code_service_executant
        recipient_match = (
            self.client.resolve_recipient_and_service(recipient_code, requested_service_code)
            if requested_service_code
            else None
        )

        requested_bank_account_code = (
            invoice.bank_account_code
            if invoice.bank_account_code is not None
            else self.settings.default_bank_account_code
        )
        bank_account_code = None
        if requested_bank_account_code is not None:
            bank_account_code = self.client.resolve_bank_account_code(
                supplier_id,
                requested_bank_account_code,
            )

        tva_code_by_rate: dict[Decimal, str] = {}
        for line in invoice.lines:
            rate = line.vat_rate_decimal.normalize()
            if line.manual_tva_code:
                tva_code_by_rate[rate] = line.manual_tva_code
                continue

            if rate not in tva_code_by_rate:
                tva_code_by_rate[rate] = self.client.resolve_tva_code(rate)

        payload = build_minimal_submission_payload(
            invoice,
            self.settings.fixed,
            supplier_id=supplier_id,
            code_destinataire=recipient_match.code_destinataire if recipient_match else recipient_code,
            code_service_executant=recipient_match.code_service_executant if recipient_match else None,
            tva_code_by_rate=tva_code_by_rate,
            uploaded_piece_jointe_id=None,
            bank_account_code=bank_account_code,
        )
        return payload, upload_result

    def prepare_payload(self, invoice: ChorusMinimalInvoiceInput) -> dict[str, Any]:
        payload, _upload_result = self._prepare_submission(invoice)
        return payload

    def _enforce_configured_supplier_id(self, payload: dict[str, Any]) -> dict[str, Any]:
        fournisseur = payload.get("fournisseur")
        if not isinstance(fournisseur, dict):
            fournisseur = {}
            payload["fournisseur"] = fournisseur

        supplier_id = self._resolve_real_supplier_id(
            self.settings.default_supplier_id,
            as_int(fournisseur.get("idFournisseur")),
        )

        fournisseur["idFournisseur"] = supplier_id
        return payload

    def submit_prepared_payload(
        self,
        payload: dict[str, Any],
        *,
        main_file: dict[str, Any] | None = None,
        attachments: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        self.client.reset_api_calls()
        final_payload = self._enforce_configured_supplier_id(deepcopy(payload))
        enforce_submission_vat_type(final_payload)
        main_upload_result: ChorusUploadAttachmentResult | None = None
        additional_uploads: list[tuple[dict[str, Any], ChorusUploadAttachmentResult]] = []

        if main_file is not None:
            main_upload_result = self.client.upload_attachment_content(
                file_name=str(main_file["name"]),
                file_base64=str(main_file["base64"]),
                mime_type=str(main_file.get("mimeType") or "application/pdf"),
                operation_label="Upload de la pièce jointe principale",
            )
            existing_main_attachment = final_payload.get("pieceJointePrincipale")
            existing_designation = None
            if isinstance(existing_main_attachment, list) and existing_main_attachment:
                maybe_attachment = existing_main_attachment[0]
                if isinstance(maybe_attachment, dict):
                    raw_designation = maybe_attachment.get("pieceJointePrincipaleDesignation")
                    if isinstance(raw_designation, str) and raw_designation.strip():
                        existing_designation = raw_designation.strip()

            final_payload["modeDepot"] = mode_depot_for_pdf(is_signed_pdf_base64(str(main_file["base64"])))
            final_payload["pieceJointePrincipale"] = [
                {
                    "pieceJointePrincipaleDesignation": (
                        existing_designation or DEFAULT_PIECE_JOINTE_PRINCIPALE_DESIGNATION
                    ),
                    "pieceJointePrincipaleId": main_upload_result.piece_jointe_id,
                }
            ]

        existing_additional_attachments = final_payload.get("pieceJointeComplementaire")
        if not isinstance(existing_additional_attachments, list):
            existing_additional_attachments = []

        for attachment in attachments or []:
            designation = str(attachment.get("designation") or attachment["name"]).strip()
            attachment_payload: dict[str, Any] = {
                "pieceJointeComplementaireDesignation": designation,
            }
            attachment_payload["pieceJointeComplementaireType"] = resolve_complementary_attachment_type(
                self.client,
                attachment.get("type"),
            )

            line_number = attachment.get("lineNumber")
            if line_number not in (None, ""):
                attachment_payload["pieceJointeComplementaireNumeroLigneFacture"] = int(line_number)

            liaison_id = attachment.get("liaisonId")
            if liaison_id not in (None, ""):
                attachment_payload["pieceJointeComplementaireIdLiaison"] = int(liaison_id)

            upload_result = self.client.upload_attachment_content(
                file_name=str(attachment["name"]),
                file_base64=str(attachment["base64"]),
                mime_type=str(attachment.get("mimeType") or "application/octet-stream"),
                operation_label=f"Upload de la pièce jointe complémentaire ({designation})",
            )
            attachment_payload["pieceJointeComplementaireId"] = upload_result.piece_jointe_id
            existing_additional_attachments.append(attachment_payload)
            additional_uploads.append((attachment, upload_result))

        if existing_additional_attachments:
            final_payload["pieceJointeComplementaire"] = existing_additional_attachments
        else:
            final_payload.pop("pieceJointeComplementaire", None)

        response = self.client.submit_invoice(final_payload)
        uploaded_files: list[dict[str, Any]] = []
        if main_upload_result is not None and main_file is not None:
            uploaded_files.append(
                {
                    "id": str(main_upload_result.piece_jointe_id),
                    "filename": str(main_file["name"]),
                    "role": "MAIN",
                    "response": main_upload_result.response,
                }
            )
        for attachment, upload_result in additional_uploads:
            uploaded_files.append(
                {
                    "id": str(upload_result.piece_jointe_id),
                    "filename": str(attachment["name"]),
                    "role": "COMPLEMENTARY",
                    "designation": str(attachment.get("designation") or attachment["name"]),
                    "type": attachment.get("type"),
                    "lineNumber": attachment.get("lineNumber"),
                    "liaisonId": attachment.get("liaisonId"),
                    "response": upload_result.response,
                }
            )

        result = {
            "ok": True,
            "payload": final_payload,
            "response": response,
            "apiCalls": list(self.client.api_calls),
            "uploadedFiles": uploaded_files,
        }
        if main_upload_result is not None:
            result["upload"] = {
                "piece_jointe_id": main_upload_result.piece_jointe_id,
                "response": main_upload_result.response,
            }
        return result

    def recycle_invoice(self, payload: dict[str, Any]) -> dict[str, Any]:
        self.client.reset_api_calls()
        final_payload = deepcopy(payload)
        response = self.client.recycle_invoice(final_payload)
        return {
            "ok": True,
            "payload": final_payload,
            "response": response,
            "apiCalls": list(self.client.api_calls),
            "uploadedFiles": [],
        }

    def correct_invoice_validator(self, payload: dict[str, Any]) -> dict[str, Any]:
        self.client.reset_api_calls()
        final_payload = deepcopy(payload)
        response = self.client.correct_invoice_validator(final_payload)
        return {
            "ok": True,
            "payload": final_payload,
            "response": response,
            "apiCalls": list(self.client.api_calls),
            "uploadedFiles": [],
        }

    def consult_invoice_history(self, payload: dict[str, Any]) -> dict[str, Any]:
        self.client.reset_api_calls()
        final_payload = deepcopy(payload)
        response = self.client.consult_invoice_history(final_payload)
        return {
            "ok": True,
            "payload": final_payload,
            "response": response,
            "apiCalls": list(self.client.api_calls),
            "uploadedFiles": [],
        }

    def submit_invoice(self, invoice: ChorusMinimalInvoiceInput) -> dict[str, Any]:
        self.client.reset_api_calls()
        payload, upload_result = self._prepare_submission(invoice)
        response = self.client.submit_invoice(payload)
        result = {
            "ok": True,
            "payload": payload,
            "response": response,
            "apiCalls": list(self.client.api_calls),
            "uploadedFiles": [],
        }
        if upload_result is not None:
            result["upload"] = {
                "piece_jointe_id": upload_result.piece_jointe_id,
                "response": upload_result.response,
            }
            result["uploadedFiles"] = [
                {
                    "id": str(upload_result.piece_jointe_id),
                    "filename": invoice.pdf_path.name if invoice.pdf_path is not None else (invoice.pdf_designation or "facture.pdf"),
                    "response": upload_result.response,
                }
            ]
        return result
