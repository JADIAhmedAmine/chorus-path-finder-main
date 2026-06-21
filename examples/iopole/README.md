# Factures exemples — test Iopole (sandbox PPD)

Fichiers prêts à **uploader sur la page Iopole** (`/providers/iopole` → « Émettre »)
pour tester une émission qui **arrive en DELIVERED** (pas rejetée).

| Fichier | Usage |
|---|---|
| `exemple-facturx.pdf` | Factur-X (PDF/A-3 EN16931) — à uploader pour tester l'émission |
| `exemple-ubl.xml` | UBL EN16931 — variante XML |
| `exemple.json` | Modèle JSON source (format Iopole) pour régénérer / adapter |

## Pourquoi ça passe (DELIVERED et pas REJECTED)
Les participants sont **enregistrés et joignables dans la sandbox** :
- **Vendeur** : A.B. SERVICES CONSEILS — SIREN `413142621` (TVA `FR93413142621`)
- **Acheteur** : ASSOCIATION SPORTIVE CHAPTAL — SIREN `394211163`

Un vendeur/acheteur non enregistré ⇒ statut `INVALID` / `WRONG_ROUTING`.

## Comment tester
1. `docker compose up -d --build` puis http://localhost:8081 → se connecter.
2. Sidebar → **Plateformes → Iopole (PDP)**.
3. **Émettre** → choisir `exemple-facturx.pdf` (ou `exemple-ubl.xml`).
4. La facture apparaît dans la liste ; cliquer **Statut** → lifecycle `DELIVERED`,
   historique `SUBMITTED → RECEIVED → ISSUED → MADE_AVAILABLE`.
5. Tester aussi : **téléchargement** (original / Factur-X lisible), **Réception**,
   **Annuaire**.

## ⚠️ Réutilisation
Le `invoiceId` est figé (`EXEMPLE-IOPOLE-001`). Un même `invoiceId` réémis par le
même vendeur ⇒ statut `DUPLICATED`. Pour rejouer le test, **change `invoiceId`**
dans `exemple.json` et régénère via l'endpoint de génération
(`POST /v1/tools/facturx/generate`), ou émets une seule fois.

> Données fictives à usage de test sandbox uniquement.
