"""Tests P2-1 / P2-3 — dépôts de flux, statistiques et comptes rendus Chorus.

- `FluxDepositLogicTests` : logique pure (mapping statuts officiels, parsing CR,
  agrégation, sérialisation). N'importe ni la base ni le serveur → exécutable partout.
- `FluxCrRefreshTests` : route batch appelée directement avec client Chorus et
  persistance simulés.
- `FluxDepositEndpointTests` : endpoints via TestClient, auth surchargée et lecture
  DB simulée (aucune base requise).
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import chorus_python.chorus_flux_routes as routes  # noqa: E402
from chorus_python.chorus_cr import canonical_etat_courant, normalize_cr_detaille  # noqa: E402


# Les 9 états officiels confirmés (spec V5.00, `etatCourantFlux`).
OFFICIAL_LABELS = [
    "Reçu",
    "Traité SE CPP",
    "En attente de traitement",
    "En cours de traitement",
    "Incidenté",
    "Rejeté",
    "En attente de retraitement",
    "Intégré",
    "Intégré partiellement",
]


class FluxDepositLogicTests(unittest.TestCase):
    def test_official_states_are_the_nine_confirmed_labels(self) -> None:
        self.assertEqual([label for _, label in routes.OFFICIAL_FLUX_STATES], OFFICIAL_LABELS)
        for state_id, label in routes.OFFICIAL_FLUX_STATES:
            self.assertEqual(canonical_etat_courant(label), (state_id, label))
            self.assertEqual(canonical_etat_courant(label.upper()), (state_id, label))

    def test_normalize_cr_detaille_parses_technical_errors(self) -> None:
        normalized = normalize_cr_detaille(
            {
                "etatCourantDepotFlux": "Rejeté",
                "listeErreurTechnique": [
                    {
                        "natureErreur": "FORMAT",
                        "codeErreur": 20005,
                        "libelleErreur": "Format non conforme",
                    },
                    {
                        "natureErreur": "ENCODAGE",
                        "codeErreur": "20007",
                        "libelleErreur": "Encodage base64 invalide",
                    },
                ],
            }
        )
        self.assertEqual(normalized["etatCourantFluxId"], "rejete")
        self.assertEqual(normalized["technicalErrorCount"], 2)
        self.assertEqual(normalized["errorCount"], 2)
        self.assertEqual(normalized["listeErreurTechnique"][0]["code"], 20005)
        self.assertEqual(normalized["listeErreurTechnique"][1]["libelle"], "Encodage base64 invalide")

    def test_normalize_cr_detaille_parses_dp_errors(self) -> None:
        normalized = normalize_cr_detaille(
            {
                "etatCourantDepotFlux": "Intégré partiellement",
                "listeErreurDP": [
                    {
                        "identifiantFournisseur": "11111111111111",
                        "identifiantDestinataire": "22222222222222",
                        "numeroDP": "FAC-2026-001",
                        "libelleErreurDP": "Service destinataire obligatoire",
                    }
                ],
            }
        )
        self.assertEqual(normalized["etatCourantFluxId"], "integrePartiellement")
        self.assertEqual(normalized["dpErrorCount"], 1)
        self.assertEqual(normalized["errorCount"], 1)
        self.assertEqual(normalized["listeErreurDP"][0]["numeroDP"], "FAC-2026-001")
        self.assertEqual(
            normalized["listeErreurDP"][0]["identifiantDestinataire"],
            "22222222222222",
        )

    def test_status_local_maps_best_effort(self) -> None:
        self.assertEqual(routes._official_state_id("ACCEPTED"), "integre")
        self.assertEqual(routes._official_state_id("REJECTED"), "rejete")
        self.assertEqual(routes._official_state_id("ERROR"), "incidente")
        # Bloqué avant envoi : aucun état officiel (le flux n'a pas atteint Chorus).
        self.assertIsNone(routes._official_state_id("BLOCKED_LOCAL_VALIDATION"))
        self.assertIsNone(routes._official_state_id(None))

    def test_build_stats_aggregates_and_flags_official_incomplete(self) -> None:
        raw = {
            "total": 10,
            "by_status_local": {"ACCEPTED": 6, "REJECTED": 2, "ERROR": 1, "BLOCKED_LOCAL_VALIDATION": 1},
            "by_syntaxe_flux": {"IN_DP_E1_UBL_INVOICE": 7, "IN_DP_E2_CII_FACTURX": 3},
            "by_format_flux": {"IN_DP_E1_STRUCT": 8, "IN_DP_E2_MIXTE": 2},
            "last_created_at": "2026-05-26T10:00:00Z",
            "first_created_at": "2026-01-01T00:00:00Z",
            "last_date_depot": "2026-05-26",
        }
        stats = routes._build_flux_stats(raw)
        self.assertEqual(stats["total"], 10)
        self.assertEqual(stats["blockedBeforeSend"], 1)
        self.assertEqual(stats["submitted"], 9)
        self.assertEqual(stats["totalErrors"], 3)  # REJECTED + ERROR
        self.assertEqual(stats["successRate"], round(6 / 9 * 100))
        self.assertEqual(stats["officialFluxStates"]["integre"], 6)
        self.assertEqual(stats["officialFluxStates"]["rejete"], 2)
        self.assertEqual(stats["officialFluxStates"]["incidente"], 1)
        self.assertEqual(stats["officialFluxStates"]["recu"], 0)  # non dérivable du status_local
        self.assertFalse(stats["officialStatesComplete"])
        self.assertIsNone(stats["byFormatDepot"])  # not_available
        self.assertEqual(set(stats["officialFluxStates"]), {sid for sid, _ in routes.OFFICIAL_FLUX_STATES})

    def test_empty_stats_is_zeroed(self) -> None:
        stats = routes._empty_flux_stats()
        self.assertEqual(stats["total"], 0)
        self.assertIsNone(stats["successRate"])
        self.assertEqual(sum(stats["officialFluxStates"].values()), 0)

    def test_build_stats_prioritizes_persisted_etat_courant_flux(self) -> None:
        stats = routes._build_flux_stats(
            {
                "total": 3,
                "by_status_local": {"ACCEPTED": 3},
                "by_etat_courant_flux": {"Rejeté": 1, "Intégré partiellement": 1},
                "by_status_local_no_cr": {"ACCEPTED": 1},
                "cr_count": 2,
                "numero_count": 3,
                "by_syntaxe_flux": {},
                "by_format_flux": {},
            }
        )
        self.assertEqual(stats["officialFluxStates"]["rejete"], 1)
        self.assertEqual(stats["officialFluxStates"]["integrePartiellement"], 1)
        self.assertEqual(stats["officialFluxStates"]["integre"], 1)
        self.assertEqual(stats["totalErrors"], 2)
        self.assertEqual(stats["successRate"], 67)
        self.assertEqual(stats["officialStatesSource"], "chorus_cr")
        self.assertFalse(stats["officialStatesComplete"])

    def test_serialize_row_camelcase_and_not_available_fields(self) -> None:
        row = SimpleNamespace(
            id="d1", numero_flux_depot="FX-9", nom_fichier="f.xml", file_size=123,
            format_flux="IN_DP_E1_STRUCT", syntaxe_flux="IN_DP_E1_UBL_INVOICE",
            detected_file_type="ubl", avec_signature=False, status_local="ACCEPTED",
            http_status=200, code_retour=0, libelle="OK", date_depot="2026-05-26",
            created_at="2026-05-26T10:00:00Z",
        )
        out = routes._serialize_flux_deposit(row)
        self.assertEqual(out["numeroFluxDepot"], "FX-9")
        self.assertEqual(out["officialFluxState"], "Intégré")
        self.assertFalse(out["hasError"])
        for missing in ("formatDepot", "updatedAt", "invoiceCount", "errorCount", "crAvailable"):
            self.assertIsNone(out[missing], f"{missing} should be not_available (None)")

    def test_serialize_row_uses_cr_state_for_has_error(self) -> None:
        row = SimpleNamespace(
            id="d2",
            status_local="ACCEPTED",
            etat_courant_flux="Rejeté",
            cr_available=True,
            error_count=1,
        )
        out = routes._serialize_flux_deposit(row)
        self.assertEqual(out["officialFluxStateId"], "rejete")
        self.assertEqual(out["officialFluxStateSource"], "chorus_cr")
        self.assertTrue(out["hasError"])


class FluxCrRefreshTests(unittest.IsolatedAsyncioTestCase):
    async def test_refresh_cr_batch_uses_mocked_chorus_client_and_updates_cr(self) -> None:
        captured: dict[str, object] = {}

        def fake_persist_cr(**kwargs):
            captured.update(kwargs)
            return {
                "id": kwargs["deposit_id"],
                "numeroFluxDepot": "FX-CR-1",
                "officialFluxStateId": "integrePartiellement",
                "officialFluxState": "Intégré partiellement",
                "errorCount": 2,
                "crAvailable": True,
            }

        settings = SimpleNamespace(
            base_url="https://chorus.mock",
            cpro_account="mock-account",
            timeout_seconds=5.0,
        )
        mocked_result = {
            "http_status": 200,
            "codeRetour": 0,
            "libelle": "Compte rendu disponible",
            "raw": {
                "etatCourantDepotFlux": "Intégré partiellement",
                "listeErreurTechnique": [
                    {"natureErreur": "FORMAT", "codeErreur": 42, "libelleErreur": "Erreur flux"}
                ],
                "listeErreurDP": [
                    {"numeroDP": "FAC-1", "libelleErreurDP": "Erreur facture"}
                ],
            },
        }

        with (
            patch.object(routes, "_resolve_flux_tenant", return_value="tenant-default"),
            patch.object(
                routes,
                "_list_needing_cr_sync",
                return_value=[{"id": "d-cr-1", "numero": "FX-CR-1"}],
            ),
            patch.object(routes, "_persist_cr_sync", side_effect=fake_persist_cr),
            patch.object(routes, "_resolve_settings_and_token", return_value=(settings, "mock-token")),
            patch.object(
                routes,
                "consulter_cr_detaille",
                new=AsyncMock(return_value=mocked_result),
            ) as mocked_client,
        ):
            response = await routes.handle_refresh_cr_batch(
                limit=5,
                environment=None,
                tenant_id=None,
                user={
                    "email": "t@e.com",
                    "roleCode": "ADMINISTRATEUR",
                    "tenantId": "tenant-default",
                },
            )

        self.assertEqual(response.status_code, 200)
        body = json.loads(response.body)
        self.assertTrue(body["success"] and body["available"])
        self.assertEqual(body["attempted"], 1)
        self.assertEqual(body["refreshed"], 1)
        self.assertTrue(body["items"][0]["crRefreshed"])
        mocked_client.assert_awaited_once_with(
            "https://chorus.mock",
            "mock-token",
            "mock-account",
            "FX-CR-1",
            timeout_seconds=5.0,
        )
        cr_fields = captured["cr_fields"]
        self.assertEqual(cr_fields["etat_courant_flux"], "Intégré partiellement")
        self.assertEqual(cr_fields["error_count"], 2)
        self.assertTrue(cr_fields["cr_available"])


class FluxDepositEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        from fastapi.testclient import TestClient
        import scripts.chorus_submit_server as server
        from chorus_python.auth import get_current_auth_user

        self.server = server
        self.get_current_auth_user = get_current_auth_user
        server.app.dependency_overrides[get_current_auth_user] = lambda: {
            "email": "t@e.com", "roleCode": "ADMINISTRATEUR", "tenantId": "tenant-default",
        }
        # Isole de la base : tenant fixe + lectures DB simulées.
        self._orig = {
            "tenant": routes._resolve_flux_tenant,
            "read": routes._read_flux_deposits_sync,
            "stats": routes._flux_stats_sync,
        }
        routes._resolve_flux_tenant = lambda user, explicit: "tenant-default"
        routes._read_flux_deposits_sync = lambda *, tenant_id, filters, page, page_size: {
            "total": 1, "page": page, "page_size": page_size,
            "items": [routes._serialize_flux_deposit(SimpleNamespace(
                id="d1", numero_flux_depot="FX-1", nom_fichier="f.xml", file_size=10,
                format_flux="IN_DP_E1_STRUCT", syntaxe_flux="IN_DP_E1_UBL_INVOICE",
                detected_file_type="ubl", avec_signature=False, status_local="ACCEPTED",
                http_status=200, code_retour=0, libelle="OK", date_depot="2026-05-26",
                created_at="2026-05-26T10:00:00Z",
            ))],
        }
        routes._flux_stats_sync = lambda *, tenant_id, filters: {
            "total": 2,
            "by_status_local": {"ACCEPTED": 1, "REJECTED": 1},
            "by_syntaxe_flux": {"IN_DP_E1_UBL_INVOICE": 2},
            "by_format_flux": {"IN_DP_E1_STRUCT": 2},
            "last_created_at": "2026-05-26T10:00:00Z",
            "first_created_at": "2026-05-01T00:00:00Z",
            "last_date_depot": "2026-05-26",
        }
        self.client = TestClient(server.app)

    def tearDown(self) -> None:
        routes._resolve_flux_tenant = self._orig["tenant"]
        routes._read_flux_deposits_sync = self._orig["read"]
        routes._flux_stats_sync = self._orig["stats"]
        self.server.app.dependency_overrides.pop(self.get_current_auth_user, None)

    def test_list_endpoint_returns_paginated_items(self) -> None:
        resp = self.client.get("/api/chorus/flux/deposits?pageSize=10")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertTrue(body["success"] and body["available"])
        self.assertEqual(body["total"], 1)
        self.assertEqual(body["items"][0]["numeroFluxDepot"], "FX-1")
        self.assertEqual(body["items"][0]["officialFluxState"], "Intégré")

    def test_stats_endpoint_returns_official_states(self) -> None:
        resp = self.client.get("/api/chorus/flux/deposits/stats")
        self.assertEqual(resp.status_code, 200)
        stats = resp.json()["stats"]
        self.assertEqual(stats["total"], 2)
        self.assertEqual(stats["totalErrors"], 1)
        self.assertEqual(stats["officialFluxStates"]["integre"], 1)
        self.assertEqual(stats["officialFluxStates"]["rejete"], 1)
        self.assertFalse(stats["officialStatesComplete"])

    def test_list_unavailable_db_degrades_gracefully(self) -> None:
        routes._read_flux_deposits_sync = lambda *, tenant_id, filters, page, page_size: None
        resp = self.client.get("/api/chorus/flux/deposits")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertFalse(body["available"])
        self.assertEqual(body["items"], [])
        self.assertEqual(body["reason"], "database_not_available")


if __name__ == "__main__":
    unittest.main()
