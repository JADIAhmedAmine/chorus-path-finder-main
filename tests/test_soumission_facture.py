from __future__ import annotations

import base64
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from chorus_python import ChorusMinimalInvoiceInput, ChorusSettings, ChorusSubmissionService, InvoiceLineInput, SoumissionFacture
from chorus_python.client import ChorusUploadAttachmentResult


class FakeChorusClient:
    def __init__(self, active_recipient_structure_id: int = 26359578) -> None:
        self.active_recipient_structure_id = active_recipient_structure_id
        self.active_recipient_calls: list[dict[str, object]] = []
        self.api_calls: list[dict[str, object]] = []
        self.uploaded_paths: list[Path] = []
        self.uploaded_content: list[dict[str, str]] = []
        self.resolved_attachment_types: list[dict[str, str]] = []
        self.submitted_payload: dict[str, object] | None = None

    def reset_api_calls(self) -> None:
        self.api_calls = []

    def resolve_supplier_id(self, supplier_id: int | None) -> int:
        return supplier_id or 26359578

    def resolve_active_recipient_structure_id(
        self,
        preferred_id: int | None = None,
        *,
        additional_preferred_ids: tuple[int, ...] = (),
    ) -> int:
        self.active_recipient_calls.append(
            {
                "preferred_id": preferred_id,
                "additional_preferred_ids": additional_preferred_ids,
            }
        )
        return self.active_recipient_structure_id

    def upload_attachment(self, pdf_path: Path) -> ChorusUploadAttachmentResult:
        self.uploaded_paths.append(pdf_path)
        return ChorusUploadAttachmentResult(
            piece_jointe_id=10851208,
            response={
                "pieceJointeId": 10851208,
                "nomFichier": pdf_path.name,
            },
        )

    def upload_attachment_content(
        self,
        *,
        file_name: str,
        file_base64: str,
        mime_type: str,
        operation_label: str = "Upload de la pièce jointe",
    ) -> ChorusUploadAttachmentResult:
        self.uploaded_content.append(
            {
                "file_name": file_name,
                "file_base64": file_base64,
                "mime_type": mime_type,
                "operation_label": operation_label,
            }
        )
        return ChorusUploadAttachmentResult(
            piece_jointe_id=10851519,
            response={
                "pieceJointeId": 10851519,
                "nomFichier": file_name,
            },
        )

    def submit_invoice(self, payload: dict[str, object]) -> dict[str, str]:
        self.submitted_payload = payload
        return {
            "invoiceId": "CHORUS-TEST-001",
        }

    def resolve_attachment_type_code(
        self,
        attachment_type: str,
        *,
        type_objet: str = "FACTURE",
        code_langue: str = "fr",
    ) -> str:
        self.resolved_attachment_types.append(
            {
                "attachment_type": attachment_type,
                "type_objet": type_objet,
                "code_langue": code_langue,
            }
        )
        return {
            "BORDEREAU_SUIVI_VALIDATION": "18",
            "BL": "19",
            "DIVERS": "20",
        }.get(attachment_type, attachment_type)


class SoumissionFactureTest(unittest.TestCase):
    maxDiff = None

    def test_pdf_upload_then_submission_uses_soumission_facture(self) -> None:
        settings = ChorusSettings(
            base_url="https://sandbox-api.piste.gouv.fr/cpro/factures",
            api_key="test-token",
            cpro_account="dGVzdDp0ZXN0",
            default_supplier_id=26359578,
            default_code_destinataire="00000000113495",
        )
        fake_client = FakeChorusClient()
        service = ChorusSubmissionService(settings, fake_client)

        invoice = ChorusMinimalInvoiceInput(
            invoice_number="KLFFZ",
            recipient_code="00000000113495",
            supplier_id=26359578,
            invoice_date="2025-11-05",
            pdf_path=Path("facture.pdf"),
            lines=[
                InvoiceLineInput(
                    description="Licence",
                    unit_price_ht="16.6667",
                    quantity=1,
                    reference="votil_licence",
                    vat_rate_percent=20,
                    unit="licence",
                    discount_ht=0,
                )
            ],
        )

        result = service.submit_invoice(invoice)
        self.assertEqual(fake_client.uploaded_paths, [Path("facture.pdf")])
        self.assertEqual(result["upload"]["piece_jointe_id"], 10851208)

        expected_submission = SoumissionFacture(
            numero_facture_saisi="KLFFZ",
            date_facture="2025-11-05",
            code_destinataire="00000000113495",
            id_fournisseur=26359578,
            piece_jointe_principale_id=10851208,
            ligne_poste=[
                InvoiceLineInput(
                    description="Licence",
                    unit_price_ht="16.6667",
                    quantity=1,
                    reference="votil_licence",
                    vat_rate_percent=20,
                    unit="licence",
                    discount_ht=0,
                )
            ],
        ).to_payload()

        self.assertEqual(result["payload"], expected_submission)
        self.assertEqual(fake_client.submitted_payload, expected_submission)
        self.assertEqual(result["uploadedFiles"], [
            {
                "id": "10851208",
                "filename": "facture.pdf",
                "response": {
                    "pieceJointeId": 10851208,
                    "nomFichier": "facture.pdf",
                },
            }
        ])
        self.assertEqual(result["response"], {"invoiceId": "CHORUS-TEST-001"})

    def test_submit_prepared_payload_forces_depot_pdf_api_when_main_file_is_uploaded(self) -> None:
        settings = ChorusSettings(
            base_url="https://sandbox-api.piste.gouv.fr/cpro/factures",
            api_key="test-token",
            cpro_account="dGVzdDp0ZXN0",
            default_supplier_id=26359578,
            default_code_destinataire="00000000113495",
        )
        fake_client = FakeChorusClient()
        service = ChorusSubmissionService(settings, fake_client)

        prepared_payload = {
            "numeroFactureSaisi": "2026-003-00565",
            "dateFacture": "2026-03-16",
            "cadreDeFacturation": {
                "codeCadreFacturation": "A1_FACTURE_FOURNISSEUR",
            },
            "destinataire": {
                "codeDestinataire": "00000000380342",
            },
            "fournisseur": {
                "idFournisseur": 32242033407300,
            },
            "lignePoste": [
                {
                    "lignePosteDenomination": "Facture 2026-003-00565",
                    "lignePosteMontantRemiseHT": 0,
                    "lignePosteMontantUnitaireHT": 45903.52,
                    "lignePosteNumero": 1,
                    "lignePosteQuantite": 1,
                    "lignePosteReference": "2026-003-00565",
                    "lignePosteTauxTva": "TV12",
                    "lignePosteUnite": "UNITE",
                }
            ],
            "ligneTva": [
                {
                    "ligneTvaMontantBaseHtParTaux": 45903.52,
                    "ligneTvaMontantTvaParTaux": 9180.7,
                    "ligneTvaTaux": "TV12",
                }
            ],
            "modeDepot": "SAISIE_API",
            "montantTotal": {
                "montantAPayer": 55084.22,
                "montantHtTotal": 45903.52,
                "montantRemiseGlobaleTTC": 0,
                "montantTVA": 9180.7,
                "montantTtcTotal": 55084.22,
            },
            "numeroFactureSaisi": "2026-003-00565",
            "pieceJointePrincipale": [],
            "pieceJointeComplementaire": [],
            "references": {
                "deviseFacture": "EUR",
                "modePaiement": "ESPECE",
                "typeFacture": "FACTURE",
                "typeTva": "TVA_SUR_DEBIT",
            },
        }

        result = service.submit_prepared_payload(
            prepared_payload,
            main_file={
                "name": "2026-003-00565 (3).pdf",
                "mimeType": "application/pdf",
                "base64": "JVBERi0xLjQK",
            },
            attachments=[],
        )

        self.assertEqual(fake_client.uploaded_content, [
            {
                "file_name": "2026-003-00565 (3).pdf",
                "file_base64": "JVBERi0xLjQK",
                "mime_type": "application/pdf",
                "operation_label": "Upload de la pièce jointe principale",
            }
        ])
        self.assertEqual(result["payload"]["modeDepot"], "DEPOT_PDF_API")
        self.assertEqual(result["payload"]["fournisseur"]["idFournisseur"], 26359578)
        self.assertEqual(result["payload"]["pieceJointePrincipale"], [
            {
                "pieceJointePrincipaleDesignation": "GCU_MSG_01_000",
                "pieceJointePrincipaleId": 10851519,
            }
        ])
        self.assertNotIn("pieceJointeComplementaire", result["payload"])

    def test_submit_prepared_payload_uses_signed_pdf_mode_when_signature_markers_are_present(self) -> None:
        settings = ChorusSettings(
            base_url="https://sandbox-api.piste.gouv.fr/cpro/factures",
            api_key="test-token",
            cpro_account="dGVzdDp0ZXN0",
            default_supplier_id=26359578,
            default_code_destinataire="00000000113495",
        )
        fake_client = FakeChorusClient()
        service = ChorusSubmissionService(settings, fake_client)
        signed_pdf_base64 = base64.b64encode(
            b"%PDF-1.7\n1 0 obj\n<< /Type /Sig /ByteRange [0 10 20 30] >>\nendobj\n%%EOF"
        ).decode("ascii")

        result = service.submit_prepared_payload(
            {
                "numeroFactureSaisi": "SIGNED-001",
                "dateFacture": "2026-03-16",
                "cadreDeFacturation": {
                    "codeCadreFacturation": "A1_FACTURE_FOURNISSEUR",
                },
                "destinataire": {
                    "codeDestinataire": "00000000380342",
                },
                "fournisseur": {
                    "idFournisseur": 32242033407300,
                },
                "lignePoste": [],
                "ligneTva": [],
                "modeDepot": "SAISIE_API",
                "montantTotal": {
                    "montantAPayer": 0,
                    "montantHtTotal": 0,
                    "montantRemiseGlobaleTTC": 0,
                    "montantTVA": 0,
                    "montantTtcTotal": 0,
                },
                "pieceJointePrincipale": [],
                "references": {
                    "deviseFacture": "EUR",
                    "modePaiement": "ESPECE",
                    "typeFacture": "FACTURE",
                    "typeTva": "TVA_SUR_DEBIT",
                },
            },
            main_file={
                "name": "signed.pdf",
                "mimeType": "application/pdf",
                "base64": signed_pdf_base64,
            },
            attachments=[],
        )

        self.assertEqual(result["payload"]["modeDepot"], "DEPOT_PDF_SIGNE_API")

    def test_submit_prepared_payload_normalizes_validation_tracking_slip_attachment_type(self) -> None:
        settings = ChorusSettings(
            base_url="https://sandbox-api.piste.gouv.fr/cpro/factures",
            api_key="test-token",
            cpro_account="dGVzdDp0ZXN0",
            default_supplier_id=26359578,
            default_code_destinataire="00000000113495",
        )
        fake_client = FakeChorusClient()
        service = ChorusSubmissionService(settings, fake_client)

        result = service.submit_prepared_payload(
            {
                "numeroFactureSaisi": "ATTACHMENT-001",
                "dateFacture": "2026-03-16",
                "cadreDeFacturation": {
                    "codeCadreFacturation": "A1_FACTURE_FOURNISSEUR",
                },
                "destinataire": {
                    "codeDestinataire": "00000000380342",
                },
                "fournisseur": {
                    "idFournisseur": 32242033407300,
                },
                "lignePoste": [],
                "ligneTva": [],
                "modeDepot": "SAISIE_API",
                "montantTotal": {
                    "montantAPayer": 0,
                    "montantHtTotal": 0,
                    "montantRemiseGlobaleTTC": 0,
                    "montantTVA": 0,
                    "montantTtcTotal": 0,
                },
                "pieceJointePrincipale": [],
                "references": {
                    "deviseFacture": "EUR",
                    "modePaiement": "VIREMENT",
                    "typeFacture": "FACTURE",
                    "typeTva": "TVA_SUR_DEBIT",
                },
            },
            attachments=[
                {
                    "name": "bordereau-validation.pdf",
                    "mimeType": "application/pdf",
                    "base64": "JVBERi0xLjQK",
                    "type": "Bordereau de suivi de validation",
                }
            ],
        )

        self.assertEqual(
            result["payload"]["pieceJointeComplementaire"][0]["pieceJointeComplementaireType"],
            "18",
        )
        self.assertEqual(
            fake_client.resolved_attachment_types[0],
            {
                "attachment_type": "BORDEREAU_SUIVI_VALIDATION",
                "type_objet": "FACTURE",
                "code_langue": "fr",
            },
        )
        self.assertEqual(
            fake_client.uploaded_content[0]["operation_label"],
            "Upload de la pièce jointe complémentaire (bordereau-validation.pdf)",
        )

    def test_submit_prepared_payload_maps_delivery_note_attachment_type_to_code(self) -> None:
        settings = ChorusSettings(
            base_url="https://sandbox-api.piste.gouv.fr/cpro/factures",
            api_key="test-token",
            cpro_account="dGVzdDp0ZXN0",
            default_supplier_id=26359578,
            default_code_destinataire="00000000113495",
        )
        fake_client = FakeChorusClient()
        service = ChorusSubmissionService(settings, fake_client)

        result = service.submit_prepared_payload(
            {
                "numeroFactureSaisi": "ATTACHMENT-002",
                "dateFacture": "2026-03-16",
                "cadreDeFacturation": {
                    "codeCadreFacturation": "A1_FACTURE_FOURNISSEUR",
                },
                "destinataire": {
                    "codeDestinataire": "00000000380342",
                },
                "fournisseur": {
                    "idFournisseur": 32242033407300,
                },
                "lignePoste": [],
                "ligneTva": [],
                "modeDepot": "SAISIE_API",
                "montantTotal": {
                    "montantAPayer": 0,
                    "montantHtTotal": 0,
                    "montantRemiseGlobaleTTC": 0,
                    "montantTVA": 0,
                    "montantTtcTotal": 0,
                },
                "pieceJointePrincipale": [],
                "references": {
                    "deviseFacture": "EUR",
                    "modePaiement": "VIREMENT",
                    "typeFacture": "FACTURE",
                    "typeTva": "TVA_SUR_DEBIT",
                },
            },
            attachments=[
                {
                    "name": "bon-livraison.pdf",
                    "mimeType": "application/pdf",
                    "base64": "JVBERi0xLjQK",
                    "type": "Bon de livraison",
                }
            ],
        )

        self.assertEqual(
            result["payload"]["pieceJointeComplementaire"][0]["pieceJointeComplementaireType"],
            "19",
        )

    def test_submit_prepared_payload_forces_vat_type_to_debit(self) -> None:
        settings = ChorusSettings(
            base_url="https://sandbox-api.piste.gouv.fr/cpro/factures",
            api_key="test-token",
            cpro_account="dGVzdDp0ZXN0",
            default_supplier_id=26359578,
            default_code_destinataire="00000000113495",
        )
        fake_client = FakeChorusClient()
        service = ChorusSubmissionService(settings, fake_client)

        result = service.submit_prepared_payload(
            {
                "numeroFactureSaisi": "TVA-001",
                "dateFacture": "2026-03-16",
                "cadreDeFacturation": {
                    "codeCadreFacturation": "A1_FACTURE_FOURNISSEUR",
                },
                "destinataire": {
                    "codeDestinataire": "00000000380342",
                },
                "fournisseur": {
                    "idFournisseur": 32242033407300,
                },
                "lignePoste": [],
                "ligneTva": [],
                "modeDepot": "SAISIE_API",
                "montantTotal": {
                    "montantAPayer": 0,
                    "montantHtTotal": 0,
                    "montantRemiseGlobaleTTC": 0,
                    "montantTVA": 0,
                    "montantTtcTotal": 0,
                },
                "pieceJointePrincipale": [],
                "references": {
                    "deviseFacture": "EUR",
                    "modePaiement": "VIREMENT",
                    "typeFacture": "FACTURE",
                    "typeTva": "TVA_SUR_ENCAISSEMENT",
                },
            },
            attachments=[],
        )

        self.assertEqual(result["payload"]["references"]["typeTva"], "TVA_SUR_DEBIT")

    def test_submit_prepared_payload_resolves_real_supplier_id_from_active_recipient_structures(self) -> None:
        settings = ChorusSettings(
            base_url="https://sandbox-api.piste.gouv.fr/cpro/factures",
            api_key="test-token",
            cpro_account="dGVzdDp0ZXN0",
            default_supplier_id=26359578,
            default_code_destinataire="00000000113495",
        )
        fake_client = FakeChorusClient(active_recipient_structure_id=987654321)
        service = ChorusSubmissionService(settings, fake_client)

        result = service.submit_prepared_payload(
            {
                "numeroFactureSaisi": "REAL-SUPPLIER-001",
                "dateFacture": "2026-03-16",
                "cadreDeFacturation": {
                    "codeCadreFacturation": "A1_FACTURE_FOURNISSEUR",
                },
                "destinataire": {
                    "codeDestinataire": "00000000380342",
                },
                "fournisseur": {
                    "idFournisseur": 32242033407300,
                },
                "lignePoste": [],
                "ligneTva": [],
                "modeDepot": "SAISIE_API",
                "montantTotal": {
                    "montantAPayer": 0,
                    "montantHtTotal": 0,
                    "montantRemiseGlobaleTTC": 0,
                    "montantTVA": 0,
                    "montantTtcTotal": 0,
                },
                "pieceJointePrincipale": [],
                "references": {
                    "deviseFacture": "EUR",
                    "modePaiement": "ESPECE",
                    "typeFacture": "FACTURE",
                    "typeTva": "TVA_SUR_DEBIT",
                },
            },
            attachments=[],
        )

        self.assertEqual(result["payload"]["fournisseur"]["idFournisseur"], 987654321)
        self.assertEqual(fake_client.active_recipient_calls, [
            {
                "preferred_id": 26359578,
                "additional_preferred_ids": (32242033407300,),
            }
        ])


if __name__ == "__main__":
    unittest.main()
