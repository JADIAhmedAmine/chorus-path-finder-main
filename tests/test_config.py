from __future__ import annotations

import base64
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from chorus_python.config import load_chorus_settings


class ChorusConfigTest(unittest.TestCase):
    def test_prod_override_uses_prod_scoped_server_values(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            env_path = Path(tmp_dir) / ".env.local"
            env_path.write_text(
                "\n".join(
                    [
                        "CHORUS_ENV=qualif",
                        "VITE_CHORUS_API_BASE_URL=https://sandbox-api.piste.gouv.fr/cpro/factures",
                        "VITE_CHORUS_PROD_API_BASE_URL=https://api.piste.gouv.fr/cpro/factures",
                        "CHORUS_QUALIF_CLIENT_ID=qualif-client",
                        "CHORUS_QUALIF_CLIENT_SECRET=qualif-secret",
                        "CHORUS_QUALIF_TECHNICAL_LOGIN=qualif-login",
                        "CHORUS_QUALIF_TECHNICAL_PASSWORD=qualif-password",
                        "CHORUS_PROD_CLIENT_ID=prod-client",
                        "CHORUS_PROD_CLIENT_SECRET=prod-secret",
                        "CHORUS_PROD_TECHNICAL_LOGIN=prod-login",
                        "CHORUS_PROD_TECHNICAL_PASSWORD=prod-password",
                        "CHORUS_PROD_SUPPLIER_ID=987654",
                        "CHORUS_PROD_DESTINATAIRE_CODE=prod-destinataire",
                    ]
                ),
                encoding="utf-8",
            )

            settings = load_chorus_settings(
                env_files=[env_path],
                environment_override="prod",
            )

        self.assertEqual(settings.base_url, "https://api.piste.gouv.fr/cpro")
        self.assertEqual(settings.token_url, "https://oauth.piste.gouv.fr/api/oauth/token")
        self.assertEqual(settings.client_id, "prod-client")
        self.assertEqual(settings.client_secret, "prod-secret")
        self.assertEqual(
            settings.cpro_account,
            base64.b64encode(b"prod-login:prod-password").decode("ascii"),
        )
        self.assertEqual(settings.default_supplier_id, 987654)
        self.assertEqual(settings.default_code_destinataire, "prod-destinataire")


if __name__ == "__main__":
    unittest.main()
