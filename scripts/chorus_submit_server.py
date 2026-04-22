#!/usr/bin/env python3
from __future__ import annotations

import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from chorus_python import ChorusSubmissionService, load_chorus_settings


HOST = "127.0.0.1"
PORT = 8008
SUBMIT_PATH = "/api/chorus/submit"


def _extract_external_id(response: Any) -> str | None:
    if not isinstance(response, dict):
        return None

    candidate = response.get("invoiceId") or response.get("numeroFactureChorus") or response.get("id")
    if isinstance(candidate, str) and candidate.strip():
        return candidate
    if isinstance(candidate, int):
        return str(candidate)
    return None


class ChorusSubmitHandler(BaseHTTPRequestHandler):
    server_version = "ChorusPythonBridge/1.0"

    def _write_json(self, status: int, payload: dict[str, Any]) -> None:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.end_headers()
        self.wfile.write(encoded)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._write_json(HTTPStatus.NO_CONTENT, {})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != SUBMIT_PATH:
            self._write_json(HTTPStatus.NOT_FOUND, {
                "ok": False,
                "error": f"Route inconnue: {self.path}",
            })
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(content_length) if content_length > 0 else b"{}"
            body = json.loads(raw_body.decode("utf-8"))
        except Exception as error:  # noqa: BLE001
            self._write_json(HTTPStatus.BAD_REQUEST, {
                "ok": False,
                "error": f"JSON invalide: {error}",
            })
            return

        payload = body.get("payload")
        main_file = body.get("mainFile")
        attachments = body.get("attachments") or []

        if not isinstance(payload, dict):
            self._write_json(HTTPStatus.BAD_REQUEST, {
                "ok": False,
                "error": "Le champ payload est obligatoire et doit être un objet JSON.",
            })
            return

        if main_file is not None and not isinstance(main_file, dict):
            self._write_json(HTTPStatus.BAD_REQUEST, {
                "ok": False,
                "error": "Le champ mainFile doit être un objet JSON s'il est fourni.",
            })
            return

        if attachments:
            self._write_json(HTTPStatus.BAD_REQUEST, {
                "ok": False,
                "error": "Les pièces jointes complémentaires ne sont pas encore gérées par le pont Python minimal.",
            })
            return

        try:
            settings = load_chorus_settings()
            service = ChorusSubmissionService(settings)
            result = service.submit_prepared_payload(payload, main_file=main_file)
            result["externalId"] = _extract_external_id(result.get("response"))
            self._write_json(HTTPStatus.OK, result)
        except Exception as error:  # noqa: BLE001
            message = str(error) or error.__class__.__name__
            api_calls = []
            if "service" in locals():
                api_calls = list(service.client.api_calls)
            self._write_json(HTTPStatus.BAD_GATEWAY, {
                "ok": False,
                "error": message,
                "apiCalls": api_calls,
            })


def main() -> int:
    server = ThreadingHTTPServer((HOST, PORT), ChorusSubmitHandler)
    print(f"Chorus Python bridge listening on http://{HOST}:{PORT}{SUBMIT_PATH}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
