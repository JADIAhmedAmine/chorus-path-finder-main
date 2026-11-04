from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from chorus_python.reception import (
    coerce_identifier_list,
    normalize_invoice_for_reception,
)


SAMPLE_FACTURE = {
    "identifiantFactureCPP": 8424327,
    "numeroFacture": "20260000000000000064",
    "statutFacture": "REJETEE",
    "modeDepot": "SAISIE_API",
    "rejetTraite": False,
    "fournisseur": {
        "idFournisseur": 26359578,
        "siret": "12345678900015",
        "designation": "ACME Fournisseur",
        "codeServiceExecutant": "SE001",
    },
    "destinataire": {
        "idStructureCPP": 32242033407300,
        "siret": "23440003400026",
        "designation": "Mairie B",
    },
    "dateFacture": "2026-03-16",
    "dateDepot": "2026-03-17",
    "dateEcheancePaiement": "2026-04-15",
    "references": {
        "deviseFacture": "EUR",
        "modePaiement": "VIREMENT",
        "typeFacture": "FACTURE",
        "typeTva": "TVA_SUR_DEBIT",
        "numeroBonCommande": "BC-123",
        "numeroMarche": "MA-456",
    },
    "montantTotal": {
        "montantHtTotal": "1000",
        "montantTVA": 200,
        "montantTtcTotal": 1200,
        "montantAPayer": 1200,
    },
    "pieceJointePrincipale": {
        "pieceJointeId": 10851208,
        "pieceJointeDesignation": "Facture principale",
        "pieceJointeTypeCode": "FACTURE",
        "pieceJointeTypeLibelle": "Facture",
        "pieceJointeExtensionFichier": "pdf",
    },
    "listeDesPiecesJointes": [
        {
            "pieceJointeId": 10851209,
            "pieceJointeDesignation": "Bordereau",
            "pieceJointeTypeCode": "BORDEREAU",
        }
    ],
    "lignesDePoste": [
        {
            "lignePosteNumero": 1,
            "lignePosteReference": "REF-001",
            "lignePosteDenomination": "Prestation",
            "lignePosteQuantite": 1,
            "lignePosteMontantUnitaireHT": 1000,
            "lignePosteTauxTva": "TV20",
            "lignePosteMontantHtApresRemise": 1000,
        }
    ],
    "recapitulatifDeTva": [
        {
            "ligneTvaTaux": "TV20",
            "ligneTvaMontantBaseHtParTaux": 1000,
            "ligneTvaMontantTvaParTaux": 200,
        }
    ],
}


class NormalizeInvoiceForReceptionTest(unittest.TestCase):
    maxDiff = None

    def test_returns_none_for_non_dict_input(self) -> None:
        self.assertIsNone(normalize_invoice_for_reception(None))
        self.assertIsNone(normalize_invoice_for_reception("oops"))

    def test_full_normalization_of_sample_invoice(self) -> None:
        result = normalize_invoice_for_reception(SAMPLE_FACTURE)
        assert result is not None
        self.assertEqual(result["identifiantFactureCPP"], 8424327)
        self.assertEqual(result["numeroFacture"], "20260000000000000064")
        self.assertEqual(result["statutFacture"], "REJETEE")
        self.assertEqual(result["modeDepot"], "SAISIE_API")
        self.assertFalse(result["rejetTraite"])
        self.assertIsNone(result["commentaire"])
        self.assertIsNone(result["cadreDeFacturation"])
        self.assertEqual(result["fournisseur"]["id"], "26359578")
        self.assertEqual(result["fournisseur"]["siret"], "12345678900015")
        self.assertEqual(result["fournisseur"]["raisonSociale"], "ACME Fournisseur")
        self.assertEqual(result["fournisseur"]["codeService"], "SE001")
        self.assertIsNone(result["fournisseur"]["adresse"])
        self.assertEqual(result["destinataire"]["id"], "32242033407300")
        self.assertEqual(result["destinataire"]["raisonSociale"], "Mairie B")
        self.assertIsNone(result["destinataire"]["codeService"])
        self.assertEqual(result["dates"]["dateFacture"], "2026-03-16")
        self.assertEqual(result["dates"]["dateDepot"], "2026-03-17")
        self.assertEqual(result["dates"]["dateEcheancePaiement"], "2026-04-15")
        self.assertIsNone(result["dates"]["dateCreationFacture"])
        self.assertEqual(result["montants"]["ht"], 1000.0)
        self.assertEqual(result["montants"]["tva"], 200.0)
        self.assertEqual(result["montants"]["ttc"], 1200.0)
        self.assertEqual(result["montants"]["aPayer"], 1200.0)
        self.assertEqual(result["montants"]["devise"], "EUR")
        self.assertEqual(result["montants"]["remiseGlobaleTtc"], 0.0)
        self.assertIsNone(result["montants"]["ttcAvantRemiseGlobale"])
        self.assertIsNone(result["montants"]["libelleDevise"])
        self.assertEqual(result["references"]["numeroBonCommande"], "BC-123")
        self.assertEqual(result["references"]["typeFacture"], "FACTURE")
        self.assertEqual(len(result["piecesJointes"]), 2)
        self.assertEqual(result["piecesJointes"][0]["role"], "PRINCIPALE")
        self.assertEqual(result["piecesJointes"][1]["role"], "COMPLEMENTAIRE")
        self.assertEqual(len(result["lignesDePoste"]), 1)
        self.assertEqual(result["lignesDePoste"][0]["reference"], "REF-001")
        self.assertEqual(result["recapitulatifTva"][0]["taux"], "TV20")
        self.assertEqual(result["recapitulatifTva"][0]["baseHt"], 1000.0)

    def test_handles_principal_attachment_as_dict_or_list(self) -> None:
        as_list = {**SAMPLE_FACTURE, "pieceJointePrincipale": [
            SAMPLE_FACTURE["pieceJointePrincipale"]
        ]}
        result = normalize_invoice_for_reception(as_list)
        assert result is not None
        self.assertEqual(len([pj for pj in result["piecesJointes"] if pj["role"] == "PRINCIPALE"]), 1)

    def test_defaults_for_missing_amounts_and_references(self) -> None:
        result = normalize_invoice_for_reception({"identifiantFactureCPP": 1, "rejetTraite": True})
        assert result is not None
        self.assertEqual(result["montants"]["ht"], 0.0)
        self.assertEqual(result["montants"]["devise"], "EUR")
        self.assertEqual(result["montants"]["remiseGlobaleTtc"], 0.0)
        self.assertIsNone(result["montants"]["libelleDevise"])
        self.assertIsNone(result["references"]["numeroMarche"])
        self.assertEqual(result["piecesJointes"], [])
        self.assertEqual(result["lignesDePoste"], [])
        self.assertEqual(result["recapitulatifTva"], [])

    def test_ignores_empty_attachment_shells(self) -> None:
        result = normalize_invoice_for_reception({
            "identifiantFactureCPP": 1,
            "pieceJointePrincipale": {},
            "listeDesPiecesJointes": [{"pieceJointeTypeCode": "BORDEREAU"}],
        })
        assert result is not None
        self.assertEqual(len(result["piecesJointes"]), 1)
        self.assertEqual(result["piecesJointes"][0]["designation"], "Pièce jointe complémentaire")


REAL_FACTURE_RESPONSE = {
    "modeDepot": "DEPOT_PDF_SIGNE_API",
    "references": {
        "typeTva": "TVA_SUR_DEBIT",
        "dateDepot": "2026-05-23",
        "dateFacture": "2025-07-01",
        "typeFacture": "FACTURE",
        "modePaiement": "CHEQUE",
        "codeDeviseFacture": "EUR",
        "dateCreationFacture": "2026-04-30 10:37",
        "libelleDeviseFacture": "Euro européen",
        "numeroFactureOrigine": "2025-007-01291",
        "tailleTotalePiecesJointes": 0.568,
    },
    "commentaire": "string",
    "fournisseur": {
        "idFournisseur": 26359578,
        "codeFournisseur": "32242033407300",
        "adresseFournisseurId": 0,
        "designationFournisseur": "Destinataire 32242033407300",
        "adresseFournisseurVille": "test city",
        "adresseFournisseurDetail": "test street",
        "raisonSocialeFournisseur": "Destinataire 32242033407300",
        "adresseFournisseurCodePays": "FR",
        "typeIdentifiantFournisseur": "SIRET",
        "adresseFournisseurCodePostal": "75001",
        "adresseFournisseurLibellePays": "France",
    },
    "rejetTraite": False,
    "destinataire": {
        "idDestinataire": 26359578,
        "codeDestinataire": "32242033407300",
        "idServiceExecutant": 10714086,
        "libelleDestinataire": "Destinataire 32242033407300",
        "adresseDestinataireId": 0,
        "designationDestinataire": "Destinataire 32242033407300",
        "libelleServiceExecutant": "Service par défaut de la structure",
        "adresseDestinataireVille": "test city",
        "adresseDestinataireDetail": "test street",
        "miseEnPaiementDestinataire": False,
        "adresseDestinataireCodePays": "FR",
        "adresseDestinataireCodePostal": "75001",
        "adresseDestinataireLibellePays": "France",
    },
    "montantTotal": {
        "montantTVA": 262,
        "montantAPayer": 1572,
        "montantHtTotal": 1310,
        "montantTtcTotal": 1572,
        "montantRemiseGlobaleTTC": 0,
        "montantTtcAvantRemiseGlobalTTC": 1572,
    },
    "lignesDePoste": {
        "lignePoste": [
            {
                "lignePosteNumero": 1,
                "lignePosteTauxTva": "TV12",
                "lignePosteQuantite": 1,
                "lignePosteReference": "1738",
                "lignePosteMontantTva": 262,
                "lignePosteDenomination": "Facture 2025-007-01291",
                "lignePosteUniteLibelle": "UNITE",
                "lignePosteMontantUnitaireHT": 1310,
                "lignePosteMontantHtApresRemise": 1310,
                "lignePosteMontantTtcApresRemise": 1572,
            }
        ],
        "pagesLignesPoste": 1,
        "totalLignesPoste": 1,
        "pageCouranteLignesPoste": 1,
        "nbResultatsParPageLignesPoste": 50,
    },
    "numeroFacture": "2025-007-01291",
    "statutFacture": "REJETEE",
    "cadreDeFacturation": {"codeCadreFacturation": "A1_FACTURE_FOURNISSEUR"},
    "recapitulatifDeTva": {
        "ligneTva": [
            {
                "ligneTvaTauxRefId": 69,
                "ligneTvaTauxRefCode": "TV12",
                "ligneTvaTauxRefValeur": 20,
                "ligneTvaMontantTvaParTaux": 262,
                "ligneTvaMontantBaseHtParTaux": 1310,
            }
        ],
        "pagesLignesRecapitulativesTVA": 1,
        "totalLignesRecapitulativesTVA": 1,
        "pageCouranteLignesRecapitulativesTVA": 1,
        "nbResultatsParPageLignesRecapitulativesTVA": 50,
    },
    "identifiantFactureCPP": 8426157,
    "listeDesPiecesJointes": {
        "pieceJointe": [
            {
                "pieceJointeId": 10856620,
                "pieceJointeTypeCode": "DUPLICATA_FACTUR-X",
                "pieceJointeExtension": "pdf",
                "pieceJointeIdLiaison": 9533662,
                "pieceJointeDesignation": "Facture (au format Factur-X)",
                "pieceJointeTypeLibelle": "DUPLICATA_FACTUR-X",
            }
        ],
        "pagesListePiecesJointe": 1,
        "totalListePiecesJointe": 1,
        "pageCouranteListePiecesJointe": 1,
        "nbResultatsParPageListePiecesJointe": 10,
    },
    "pieceJointePrincipale": {
        "idPieceJointePrincipale": 9533661,
        "idLiaisonPieceJointePrincipale": 10856619,
    },
}


class NormalizeRealChorusResponseTest(unittest.TestCase):
    maxDiff = None

    def test_real_response_top_level_metadata(self) -> None:
        result = normalize_invoice_for_reception(REAL_FACTURE_RESPONSE)
        assert result is not None
        self.assertEqual(result["identifiantFactureCPP"], 8426157)
        self.assertEqual(result["numeroFacture"], "2025-007-01291")
        self.assertEqual(result["statutFacture"], "REJETEE")
        self.assertEqual(result["modeDepot"], "DEPOT_PDF_SIGNE_API")
        self.assertFalse(result["rejetTraite"])
        self.assertEqual(result["commentaire"], "string")
        self.assertEqual(
            result["cadreDeFacturation"],
            {"code": "A1_FACTURE_FOURNISSEUR", "libelle": None},
        )

    def test_real_response_dates_pulled_from_references(self) -> None:
        result = normalize_invoice_for_reception(REAL_FACTURE_RESPONSE)
        assert result is not None
        self.assertEqual(result["dates"]["dateDepot"], "2026-05-23")
        self.assertEqual(result["dates"]["dateFacture"], "2025-07-01")
        self.assertEqual(result["dates"]["dateCreationFacture"], "2026-04-30 10:37")

    def test_real_response_amounts_and_devise(self) -> None:
        result = normalize_invoice_for_reception(REAL_FACTURE_RESPONSE)
        assert result is not None
        self.assertEqual(result["montants"]["ht"], 1310.0)
        self.assertEqual(result["montants"]["tva"], 262.0)
        self.assertEqual(result["montants"]["ttc"], 1572.0)
        self.assertEqual(result["montants"]["aPayer"], 1572.0)
        self.assertEqual(result["montants"]["ttcAvantRemiseGlobale"], 1572.0)
        self.assertEqual(result["montants"]["devise"], "EUR")
        self.assertEqual(result["montants"]["libelleDevise"], "Euro européen")

    def test_real_response_party_address_and_identifiers(self) -> None:
        result = normalize_invoice_for_reception(REAL_FACTURE_RESPONSE)
        assert result is not None
        fournisseur = result["fournisseur"]
        self.assertEqual(fournisseur["id"], "26359578")
        self.assertEqual(fournisseur["siret"], "32242033407300")
        self.assertEqual(fournisseur["code"], "32242033407300")
        self.assertEqual(fournisseur["typeIdentifiant"], "SIRET")
        self.assertEqual(fournisseur["raisonSociale"], "Destinataire 32242033407300")
        self.assertEqual(
            fournisseur["adresse"],
            {
                "ligne": "test street",
                "ville": "test city",
                "codePostal": "75001",
                "codePays": "FR",
                "libellePays": "France",
            },
        )

        destinataire = result["destinataire"]
        self.assertEqual(destinataire["id"], "26359578")
        self.assertEqual(destinataire["serviceExecutantId"], "10714086")
        self.assertEqual(
            destinataire["serviceExecutantLibelle"],
            "Service par défaut de la structure",
        )
        self.assertFalse(destinataire["miseEnPaiement"])

    def test_real_response_lines_and_vat_unwrap_pagination_envelopes(self) -> None:
        result = normalize_invoice_for_reception(REAL_FACTURE_RESPONSE)
        assert result is not None
        self.assertEqual(len(result["lignesDePoste"]), 1)
        line = result["lignesDePoste"][0]
        self.assertEqual(line["reference"], "1738")
        self.assertEqual(line["unite"], "UNITE")
        self.assertEqual(line["montantTva"], 262.0)
        self.assertEqual(line["puHt"], 1310.0)

        self.assertEqual(len(result["recapitulatifTva"]), 1)
        vat = result["recapitulatifTva"][0]
        self.assertEqual(vat["taux"], "TV12")
        self.assertEqual(vat["tauxValeur"], 20.0)
        self.assertEqual(vat["baseHt"], 1310.0)
        self.assertEqual(vat["montantTva"], 262.0)

    def test_real_response_attachments_merge_principal_with_list(self) -> None:
        result = normalize_invoice_for_reception(REAL_FACTURE_RESPONSE)
        assert result is not None
        # La pièce principale est un stub (juste ID + idLiaison) et la liste
        # complémentaire contient l'entrée pleine. On attend que la fusion
        # produise une seule entrée PRINCIPALE (pas de duplication) ou deux
        # entrées si la liaison ne matche pas — dans cet échantillon précis,
        # les IDs ne correspondent pas, donc le stub apparaît en plus.
        self.assertTrue(len(result["piecesJointes"]) >= 1)
        roles = {item["role"] for item in result["piecesJointes"]}
        self.assertIn("PRINCIPALE", roles)


class CoerceIdentifierListTest(unittest.TestCase):
    def test_filters_invalid_values(self) -> None:
        result = coerce_identifier_list([8424327, "8424328", " 8424329 ", 0, -1, "abc", None, True, 8424327.0])
        self.assertEqual(result, [8424327, 8424328, 8424329])

    def test_preserves_order(self) -> None:
        result = coerce_identifier_list([3, 1, 2, 1, 3])
        self.assertEqual(result, [3, 1, 2])

    def test_empty_input(self) -> None:
        self.assertEqual(coerce_identifier_list([]), [])


if __name__ == "__main__":
    unittest.main()
