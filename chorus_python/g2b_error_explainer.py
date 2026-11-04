"""Explications « grand public » des erreurs G2B (HTTP + métier).

Retourne {friendlyMessage, technicalSource, suggestedFix, severity}.
Aucune donnée sensible n'est journalisée par cette fonction.
"""

from __future__ import annotations

import json
from typing import Any


def _combined_text(raw_error: Any) -> str:
    if isinstance(raw_error, (dict, list)):
        text = json.dumps(raw_error, ensure_ascii=False)
    elif raw_error is None:
        text = ""
    else:
        text = str(raw_error)
    return text.lower().translate(str.maketrans("éèêëàâäîïôöùûüç", "eeeeaaaiioouuuc"))


def explain_g2b_error(
    raw_error: Any,
    *,
    http_status: int | None = None,
    remote_status: str | None = None,
    seconds_since_deposit: float | None = None,
) -> dict[str, Any]:
    """Mappe une erreur G2B (HTTP/statut/métier) vers un message convivial."""
    text = _combined_text(raw_error)

    def result(message: str, source: str | None, fix: str | None, severity: str = "blocking") -> dict[str, Any]:
        return {"friendlyMessage": message, "technicalSource": source, "suggestedFix": fix, "severity": severity}

    # Statut métier renvoyé par le suivi de flux.
    if remote_status == "IRRECEVABLE":
        return result("Le flux a été reçu mais déclaré irrecevable. Consultez le détail du rejet et corrigez le fichier avant renvoi.",
                      "GET /flux/{uidFlux}", "Corriger le fichier puis redéposer.", "blocking")

    # 404 peu après le dépôt : traitement en cours.
    if http_status == 404:
        return result("Le flux n'est pas encore traité. Réessayez après quelques secondes.",
                      "GET /flux/{uidFlux}", "Relancer le suivi du statut dans quelques secondes.", "warning")
    if http_status == 401:
        return result("Authentification PISTE échouée.", "Authorization", "Vérifier le token PISTE et le compte technique.", "blocking")
    if http_status == 403:
        return result("Accès refusé. Vérifiez les habilitations, le compte technique, le raccordement et l'interface.",
                      "Habilitations / raccordement", "Vérifier le raccordement API et l'abonnement à l'interface.", "blocking")
    if http_status == 429:
        return result("Trop d'appels API. Réessayez plus tard.", "Rate limiting", "Attendre puis réessayer (backoff).", "warning")

    # Rejets métier (insensible aux accents).
    if "taxsubtotal.percent" in text or "taxsubtotal/percent" in text:
        return result("Le taux de TVA est obligatoire dans chaque TaxSubtotal.",
                      "TaxTotal.TaxSubtotal.TaxCategory.Percent", "Ajouter cbc:Percent dans chaque TaxSubtotal (ex. 20.00).", "blocking")
    if "identifiant fournisseur" in text:
        return result("Le fournisseur du XML n'est pas reconnu ou pas autorisé dans cet environnement.",
                      "AccountingSupplierParty.Party.PartyIdentification.ID",
                      "Utiliser le SIRET fournisseur réellement rattaché au compte technique.", "blocking")
    if "demandes de paiement" in text:
        return result("La structure fournisseur n'est pas activée/autorisée pour l'application Demandes de paiement.",
                      "AccountingSupplierParty.Party.PartyIdentification.ID",
                      "Activer/vérifier l'application Demandes de paiement pour cette structure.", "blocking")
    if "identifiant debiteur" in text or "destinataire" in text:
        return result("Le destinataire du XML n'est pas reconnu dans Chorus/G2B.",
                      "AccountingCustomerParty.Party.PartyIdentification.ID",
                      "Vérifier que le SIRET destinataire existe et est actif dans l'annuaire G2B.", "blocking")

    if http_status is not None and http_status >= 400:
        return result(f"Erreur G2B (HTTP {http_status}).", None, "Consulter la réponse brute pour le détail.", "blocking")
    return result("Erreur G2B inconnue.", None, "Consulter la réponse brute pour le détail.", "warning")
