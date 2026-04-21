from __future__ import annotations

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

        current_user_id = invoice.current_user_id or self.settings.default_current_user_id
        upload_result: ChorusUploadAttachmentResult | None = None
        if invoice.pdf_path is not None:
            if current_user_id is None:
                raise ValueError(
                    "idUtilisateurCourant est requis pour l'upload de la pièce jointe via /transverses/v1/ajouter/fichier."
                )
            upload_result = self.client.upload_attachment(invoice.pdf_path, current_user_id)

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

    def submit_invoice(self, invoice: ChorusMinimalInvoiceInput) -> dict[str, Any]:
        payload, upload_result = self._prepare_submission(invoice)
        response = self.client.submit_invoice(payload)
        result = {
            "payload": payload,
            "response": response,
        }
        if upload_result is not None:
            result["upload"] = {
                "piece_jointe_id": upload_result.piece_jointe_id,
                "response": upload_result.response,
            }
        return result
