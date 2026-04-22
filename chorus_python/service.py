from __future__ import annotations

from copy import deepcopy
from decimal import Decimal
from typing import Any

from .client import ChorusClient, ChorusUploadAttachmentResult
from .config import ChorusSettings
from .models import ChorusMinimalInvoiceInput
from .payload import build_minimal_submission_payload


class ChorusSubmissionService:
    def __init__(self, settings: ChorusSettings, client: ChorusClient | None = None) -> None:
        self.settings = settings
        self.client = client or ChorusClient(settings)

    def _prepare_submission(self, invoice: ChorusMinimalInvoiceInput) -> tuple[dict[str, Any], ChorusUploadAttachmentResult | None]:
        supplier_id = self.client.resolve_supplier_id(
            invoice.supplier_id or self.settings.default_supplier_id
        )
        recipient_code = invoice.recipient_code or self.settings.default_code_destinataire
        if not recipient_code:
            raise ValueError("codeDestinataire manquant.")

        recipient_match = self.client.resolve_recipient_and_service(
            recipient_code,
            invoice.service_executant_code or self.settings.default_code_service_executant,
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

        upload_result: ChorusUploadAttachmentResult | None = None
        if invoice.pdf_path is not None:
            upload_result = self.client.upload_attachment(invoice.pdf_path)

        payload = build_minimal_submission_payload(
            invoice,
            self.settings.fixed,
            supplier_id=supplier_id,
            code_destinataire=recipient_match.code_destinataire,
            code_service_executant=recipient_match.code_service_executant,
            tva_code_by_rate=tva_code_by_rate,
            uploaded_piece_jointe_id=upload_result.piece_jointe_id if upload_result else None,
            bank_account_code=bank_account_code,
        )
        return payload, upload_result

    def prepare_payload(self, invoice: ChorusMinimalInvoiceInput) -> dict[str, Any]:
        payload, _upload_result = self._prepare_submission(invoice)
        return payload

    def submit_prepared_payload(
        self,
        payload: dict[str, Any],
        *,
        main_file: dict[str, Any] | None = None,
        attachments: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        self.client.reset_api_calls()
        final_payload = deepcopy(payload)
        main_upload_result: ChorusUploadAttachmentResult | None = None
        additional_uploads: list[tuple[dict[str, Any], ChorusUploadAttachmentResult]] = []

        if main_file is not None:
            main_upload_result = self.client.upload_attachment_content(
                file_name=str(main_file["name"]),
                file_base64=str(main_file["base64"]),
                mime_type=str(main_file.get("mimeType") or "application/pdf"),
            )
            final_payload["pieceJointePrincipale"] = [
                {
                    "pieceJointePrincipaleDesignation": str(main_file["name"]),
                    "pieceJointePrincipaleId": main_upload_result.piece_jointe_id,
                }
            ]

        existing_additional_attachments = final_payload.get("pieceJointeComplementaire")
        if not isinstance(existing_additional_attachments, list):
            existing_additional_attachments = []

        for attachment in attachments or []:
            upload_result = self.client.upload_attachment_content(
                file_name=str(attachment["name"]),
                file_base64=str(attachment["base64"]),
                mime_type=str(attachment.get("mimeType") or "application/octet-stream"),
            )
            existing_additional_attachments.append(
                {
                    "pieceJointeComplementaireDesignation": str(attachment["name"]),
                    "pieceJointeComplementaireId": upload_result.piece_jointe_id,
                }
            )
            additional_uploads.append((attachment, upload_result))

        final_payload["pieceJointeComplementaire"] = existing_additional_attachments

        response = self.client.submit_invoice(final_payload)
        uploaded_files: list[dict[str, Any]] = []
        if main_upload_result is not None and main_file is not None:
            uploaded_files.append(
                {
                    "id": str(main_upload_result.piece_jointe_id),
                    "filename": str(main_file["name"]),
                    "response": main_upload_result.response,
                }
            )
        for attachment, upload_result in additional_uploads:
            uploaded_files.append(
                {
                    "id": str(upload_result.piece_jointe_id),
                    "filename": str(attachment["name"]),
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