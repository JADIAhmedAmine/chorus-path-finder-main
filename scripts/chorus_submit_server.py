#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
from pathlib import Path
import sys
from time import perf_counter
import traceback
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent

# Dépendances minimales nécessaires pour le bridge + extraction Docling
REQUIRED_MODULES = ("requests", "fitz")


def _module_available(module_name: str) -> bool:
    return importlib.util.find_spec(module_name) is not None


def _find_repo_python() -> Path | None:
    candidates = (
        REPO_ROOT / ".venv" / "bin" / "python",
        REPO_ROOT / ".venv" / "Scripts" / "python.exe",
    )

    for candidate in candidates:
        if candidate.exists():
            return candidate

    return None


def _venv_supports_required_modules(python_executable: Path) -> bool:
    probe_command = (
        "import importlib.util, sys; "
        "modules = sys.argv[1:]; "
        "sys.exit(0 if all(importlib.util.find_spec(module) is not None for module in modules) else 1)"
    )

    try:
        result = subprocess.run(
            [str(python_executable), "-c", probe_command, *REQUIRED_MODULES],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except OSError:
        return False

    return result.returncode == 0


def _maybe_reexec_with_repo_python() -> None:
    if all(_module_available(module_name) for module_name in REQUIRED_MODULES):
        return

    if os.environ.get("CHORUS_BRIDGE_SKIP_REEXEC") == "1":
        return

    repo_python = _find_repo_python()
    if repo_python is None:
        return

    try:
        current_python = Path(sys.executable).resolve()
        repo_python = repo_python.resolve()
    except OSError:
        return

    if current_python == repo_python:
        return

    if not _venv_supports_required_modules(repo_python):
        return

    print(f"Re-starting bridge with repo virtualenv: {repo_python}", flush=True)
    os.environ["CHORUS_BRIDGE_SKIP_REEXEC"] = "1"
    os.execv(str(repo_python), [str(repo_python), str(Path(__file__).resolve()), *sys.argv[1:]])


_maybe_reexec_with_repo_python()

if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from chorus_python import ChorusSubmissionService, load_chorus_settings
from chorus_python.extraction import extract_pdf_text_from_base64_docling


HOST = "127.0.0.1"
PORT = 8008
SUBMIT_PATH = "/api/chorus/submit"
EXTRACT_PDF_PATH = "/api/extract-pdf-text"


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
    server_version = "ChorusPythonBridge/1.1"

    def _client_connection_closed(self, error: OSError) -> bool:
        return isinstance(error, (BrokenPipeError, ConnectionResetError)) or getattr(error, "errno", None) in {32, 104}

    def _write_json(self, status: int, payload: dict[str, Any]) -> bool:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(encoded)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.end_headers()
            self.wfile.write(encoded)
            return True
        except OSError as error:
            if not self._client_connection_closed(error):
                raise

            self.close_connection = True
            log_method = self._debug if self.path == EXTRACT_PDF_PATH else self.log_message
            log_method(
                "Client disconnected before receiving %s %s response (%s).",
                status,
                self.path,
                error.__class__.__name__,
            )
            return False

    def _debug(self, message: str, *args: Any) -> None:
        self.log_message(f"[debug] {message}", *args)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.end_headers()

    def do_POST(self) -> None:  # noqa: N802
        if self.path == EXTRACT_PDF_PATH:
            self._handle_extract_pdf()
            return

        if self.path == SUBMIT_PATH:
            self._handle_submit()
            return

        self._write_json(
            HTTPStatus.NOT_FOUND,
            {
                "ok": False,
                "error": f"Route inconnue: {self.path}",
            },
        )

    def _read_json_body(self) -> dict[str, Any]:
        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length) if content_length > 0 else b"{}"
        decoded = raw_body.decode("utf-8")
        body = json.loads(decoded)

        if not isinstance(body, dict):
            raise ValueError("Le corps JSON doit être un objet JSON.")

        return body

    def _handle_extract_pdf(self) -> None:
        """Handle PDF text extraction via Docling."""
        try:
            body = self._read_json_body()
        except Exception as error:  # noqa: BLE001
            self._write_json(
                HTTPStatus.BAD_REQUEST,
                {
                    "ok": False,
                    "error": f"JSON invalide: {error}",
                },
            )
            return

        pdf_base64 = body.get("pdfBase64")
        if not isinstance(pdf_base64, str) or not pdf_base64.strip():
            self._write_json(
                HTTPStatus.BAD_REQUEST,
                {
                    "ok": False,
                    "error": "Le champ pdfBase64 est obligatoire et doit être une chaîne.",
                },
            )
            return

        started_at = perf_counter()
        self._debug(
            "Extraction PDF start: base64=%s chars",
            len(pdf_base64),
        )

        try:
            extracted_text = extract_pdf_text_from_base64_docling(pdf_base64)
            duration_ms = round((perf_counter() - started_at) * 1000)
            self._debug(
                "Extraction PDF success: text=%s chars, duration=%s ms",
                len(extracted_text),
                duration_ms,
            )
            self._write_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "text": extracted_text,
                },
            )
        except ImportError as error:
            self._write_json(
                HTTPStatus.NOT_IMPLEMENTED,
                {
                    "ok": False,
                    "error": f"Dépendance d'extraction PDF manquante: {error}",
                },
            )
        except RuntimeError as error:
            traceback.print_exc()
            duration_ms = round((perf_counter() - started_at) * 1000)
            self._debug("Extraction PDF runtime error after %s ms: %s", duration_ms, error)
            self._write_json(
                HTTPStatus.BAD_GATEWAY,
                {
                    "ok": False,
                    "error": f"Erreur Docling lors de l'extraction: {error}",
                },
            )
        except Exception as error:  # noqa: BLE001
            traceback.print_exc()
            duration_ms = round((perf_counter() - started_at) * 1000)
            self._debug("Extraction PDF error after %s ms: %s", duration_ms, error)
            self._write_json(
                HTTPStatus.BAD_GATEWAY,
                {
                    "ok": False,
                    "error": f"Erreur lors de l'extraction PDF: {error}",
                },
            )

    def _handle_submit(self) -> None:
        """Handle Chorus submission."""
        try:
            body = self._read_json_body()
        except Exception as error:  # noqa: BLE001
            self._write_json(
                HTTPStatus.BAD_REQUEST,
                {
                    "ok": False,
                    "error": f"JSON invalide: {error}",
                },
            )
            return

        payload = body.get("payload")
        main_file = body.get("mainFile")
        attachments = body.get("attachments") or []

        if not isinstance(payload, dict):
            self._write_json(
                HTTPStatus.BAD_REQUEST,
                {
                    "ok": False,
                    "error": "Le champ payload est obligatoire et doit être un objet JSON.",
                },
            )
            return

        if main_file is not None and not isinstance(main_file, dict):
            self._write_json(
                HTTPStatus.BAD_REQUEST,
                {
                    "ok": False,
                    "error": "Le champ mainFile doit être un objet JSON s'il est fourni.",
                },
            )
            return

        if not isinstance(attachments, list):
            self._write_json(
                HTTPStatus.BAD_REQUEST,
                {
                    "ok": False,
                    "error": "Le champ attachments doit être une liste JSON s'il est fourni.",
                },
            )
            return

        invalid_attachment = next((item for item in attachments if not isinstance(item, dict)), None)
        if invalid_attachment is not None:
            self._write_json(
                HTTPStatus.BAD_REQUEST,
                {
                    "ok": False,
                    "error": "Chaque pièce jointe complémentaire doit être un objet JSON.",
                },
            )
            return

        started_at = perf_counter()
        self._debug(
            "Soumission start: numero=%s, mainFile=%s, attachments=%s",
            payload.get("numeroFactureSaisi"),
            isinstance(main_file, dict),
            len(attachments),
        )

        try:
            settings = load_chorus_settings()
            service = ChorusSubmissionService(settings)
            result = service.submit_prepared_payload(
                payload,
                main_file=main_file,
                attachments=attachments,
            )
            result["externalId"] = _extract_external_id(result.get("response"))
            duration_ms = round((perf_counter() - started_at) * 1000)
            self._debug(
                "Soumission success: numero=%s, externalId=%s, duration=%s ms",
                payload.get("numeroFactureSaisi"),
                result.get("externalId"),
                duration_ms,
            )
            self._write_json(HTTPStatus.OK, result)
        except Exception as error:  # noqa: BLE001
            message = str(error) or error.__class__.__name__
            api_calls = []
            if "service" in locals():
                api_calls = list(service.client.api_calls)
            duration_ms = round((perf_counter() - started_at) * 1000)
            self._debug(
                "Soumission error: numero=%s, duration=%s ms, error=%s",
                payload.get("numeroFactureSaisi"),
                duration_ms,
                message,
            )

            self._write_json(
                HTTPStatus.BAD_GATEWAY,
                {
                    "ok": False,
                    "error": message,
                    "apiCalls": api_calls,
                },
            )

    def log_message(self, format: str, *args: Any) -> None:
        """Réduit un peu le bruit console tout en gardant les logs utiles."""
        sys.stdout.write(
            "%s - - [%s] %s\n"
            % (
                self.address_string(),
                self.log_date_time_string(),
                format % args,
            )
        )
        sys.stdout.flush()


def main() -> int:
    print(f"Python executable: {sys.executable}")
    print(f"Repository root:    {REPO_ROOT}")
    print(f"Bridge listening on http://{HOST}:{PORT}")
    print(f"  - Submit:      {SUBMIT_PATH}")
    print(f"  - Extract PDF: {EXTRACT_PDF_PATH}")

    server = ThreadingHTTPServer((HOST, PORT), ChorusSubmitHandler)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
