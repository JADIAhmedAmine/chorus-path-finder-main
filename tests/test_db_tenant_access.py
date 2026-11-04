from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from fastapi import HTTPException  # noqa: E402

import chorus_python.db.api as db_api  # noqa: E402


class DbTenantAccessTests(unittest.TestCase):
    def setUp(self) -> None:
        self._orig_settings = db_api.load_database_settings
        db_api.load_database_settings = lambda: SimpleNamespace(default_tenant_id="tenant-default")

    def tearDown(self) -> None:
        db_api.load_database_settings = self._orig_settings

    def test_admin_can_request_any_tenant(self) -> None:
        user = {"email": "admin@example.local", "roleCode": "ADMINISTRATEUR", "tenantId": "tenant-a"}
        self.assertEqual(db_api._resolve_tenant_id_for_user("tenant-b", user), "tenant-b")

    def test_non_admin_without_explicit_tenant_uses_user_tenant(self) -> None:
        user = {"email": "user@example.local", "roleCode": "GESTIONNAIRE", "tenantId": "tenant-a"}
        self.assertEqual(db_api._resolve_tenant_id_for_user(None, user), "tenant-a")

    def test_non_admin_cannot_request_other_tenant(self) -> None:
        user = {"email": "user@example.local", "roleCode": "GESTIONNAIRE", "tenantId": "tenant-a"}
        with self.assertRaises(HTTPException) as raised:
            db_api._resolve_tenant_id_for_user("tenant-b", user)
        self.assertEqual(raised.exception.status_code, 403)

    def test_non_admin_without_tenant_keeps_default_single_tenant(self) -> None:
        user = {"email": "user@example.local", "roleCode": "GESTIONNAIRE"}
        self.assertEqual(db_api._resolve_tenant_id_for_user(None, user), "tenant-default")


if __name__ == "__main__":
    unittest.main()
