#!/usr/bin/env python3
"""OriginClean Desktop Backend Service.

Extends the upstream `service/scripts/server.py` HTTP server with OriginClean's
desktop API endpoints (`/api/v1/*`) for comprehensive file inspection, C2PA-safe
cleaning, structured metadata management/editing, bounded batch processing,
persistent SQLite history, live dashboard statistics, and settings management.
"""

from __future__ import annotations

import argparse
import base64
import os
import sys
import time
from http import HTTPStatus
from http.server import ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

ROOT_DIR = Path(__file__).resolve().parent.parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import backend  # noqa: E402
from backend import APP_METADATA  # noqa: E402
from backend.inspection.inspector import inspect_file_comprehensive  # noqa: E402
from backend.metadata.manager import (  # noqa: E402
    ProvenanceAuthorizationError,
    clean_metadata_bytes,
    edit_metadata_bytes,
    inspect_metadata_bytes,
)
from backend.processing.cleaner import (  # noqa: E402
    process_batch_files,
    process_clean_file,
    resolve_non_destructive_output,
)
from backend.service.database import (  # noqa: E402
    clear_history,
    get_dashboard_stats,
    get_history_item,
    get_settings,
    init_db,
    list_history,
    record_operation,
    reset_settings,
    update_settings,
)
from common import eprint, safe_write_bytes  # noqa: E402
from server import Handler as UpstreamHandler, _decode_input, capabilities  # noqa: E402


def _extract_bytes_and_name(body: dict[str, Any]) -> tuple[bytes, str, Path | None]:
    path_str = body.get("path")
    if isinstance(path_str, str) and path_str.strip():
        p = Path(path_str.strip()).resolve()
        if not p.is_file():
            raise ValueError(f"File not found: {p}")
        return p.read_bytes(), p.name, p
    data, name = _decode_input(body)
    return data, name, None


class OriginCleanHandler(UpstreamHandler):
    server_version = f"OriginClean/{APP_METADATA['version']}"

    def end_headers(self) -> None:
        origin = self.headers.get("Origin", "")
        allowed_prefixes = (
            "http://127.0.0.1",
            "http://localhost",
            "tauri://localhost",
            "http://tauri.localhost",
            "https://tauri.localhost",
        )
        if not origin or origin.startswith(allowed_prefixes):
            self.send_header("Access-Control-Allow-Origin", origin or "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        if not self._authorized():
            self._respond(HTTPStatus.UNAUTHORIZED, {"ok": False, "error": "unauthorized"})
            return

        if path == "/api/v1/dashboard":
            self._respond(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "app": APP_METADATA,
                    "capabilities": capabilities(),
                    "stats": get_dashboard_stats(),
                },
            )
            return

        if path == "/api/v1/about":
            self._respond(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "app": APP_METADATA,
                    "capabilities": capabilities(),
                    "third_party_notices": [
                        {
                            "name": "watermarks-remover",
                            "author": "Guillaume Meyer and contributors",
                            "license": "MIT",
                            "url": "https://github.com/guillaumemeyer/watermarks-remover",
                            "role": "Core multi-format inspection and metadata/Unicode cleaning algorithms",
                        },
                        {
                            "name": "Tauri",
                            "author": "The Tauri Programme within The Commons Conservancy",
                            "license": "MIT / Apache-2.0",
                            "url": "https://tauri.app",
                            "role": "Lightweight cross-platform desktop runtime",
                        },
                        {
                            "name": "React & Lucide Icons",
                            "author": "Meta Open Source & Lucide Contributors",
                            "license": "MIT / ISC",
                            "url": "https://react.dev",
                            "role": "Desktop graphical user interface components",
                        },
                    ],
                },
            )
            return

        if path == "/api/v1/history":
            qs = parse_qs(parsed.query)
            items = list_history(
                search=qs.get("search", [""])[0],
                file_format=qs.get("format", [""])[0],
                operation_type=qs.get("operation", [""])[0],
                result_filter=qs.get("result", [""])[0],
                sort_by=qs.get("sort_by", ["processing_date"])[0],
                sort_dir=qs.get("sort_dir", ["desc"])[0],
                limit=int(qs.get("limit", ["250"])[0]),
            )
            self._respond(HTTPStatus.OK, {"ok": True, "items": items, "count": len(items)})
            return

        if path.startswith("/api/v1/history/"):
            op_id = path.split("/api/v1/history/", 1)[1].strip("/")
            item = get_history_item(op_id)
            if item is None:
                self._respond(HTTPStatus.NOT_FOUND, {"ok": False, "error": "history item not found"})
            else:
                self._respond(HTTPStatus.OK, {"ok": True, "item": item})
            return

        if path == "/api/v1/settings":
            self._respond(HTTPStatus.OK, {"ok": True, "settings": get_settings()})
            return

        super().do_GET()

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if not self._authorized():
            self._respond(HTTPStatus.UNAUTHORIZED, {"ok": False, "error": "unauthorized"})
            return

        if not path.startswith("/api/v1/"):
            super().do_POST()
            return

        body = self._read_json()
        if body is None:
            self._respond(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "invalid or oversized JSON request body"})
            return

        try:
            if path == "/api/v1/inspect":
                t0 = time.perf_counter()
                data, name, src_path = _extract_bytes_and_name(body)
                res = inspect_file_comprehensive(
                    data=data,
                    path=src_path,
                    filename=name,
                    run_detectors=bool(body.get("run_detectors", True)),
                )
                dur = round((time.perf_counter() - t0) * 1000.0, 2)
                res["duration_ms"] = dur
                if body.get("record_history", True):
                    is_susp = bool(res.get("suspicious", {}).get("verdict"))
                    record_operation(
                        original_filename=res["file_name"],
                        output_filename="",
                        file_format=res["detected_format"],
                        file_kind=res["kind"],
                        operation_type="inspect",
                        processing_duration_ms=dur,
                        processing_result="warning" if is_susp else "success",
                        bytes_in=res["file_size"],
                        bytes_out=res["file_size"],
                        c2pa_preserved=True,
                        summary={
                            "verdict": is_susp,
                            "has_c2pa": res["provenance"]["has_c2pa"],
                            "has_ai_metadata": res["provenance"]["has_ai_metadata"],
                            "indicators_count": len(res["watermark_indicators"]),
                        },
                    )
                self._respond(HTTPStatus.OK, res)

            elif path == "/api/v1/clean":
                data, name, src_path = _extract_bytes_and_name(body)
                res = process_clean_file(
                    data=data,
                    path=src_path,
                    filename=name,
                    options=body.get("options") or {},
                    operation_type=str(body.get("operation_type") or "clean"),
                    record_history=bool(body.get("record_history", True)),
                )
                self._respond(HTTPStatus.OK, res)

            elif path == "/api/v1/metadata/inspect":
                data, name, _src_path = _extract_bytes_and_name(body)
                res = inspect_metadata_bytes(data, name)
                self._respond(HTTPStatus.OK, res)

            elif path == "/api/v1/metadata/clean":
                t0 = time.perf_counter()
                data, name, src_path = _extract_bytes_and_name(body)
                res = clean_metadata_bytes(
                    data,
                    name,
                    mode=str(body.get("mode") or "all_removable"),
                    preserve_keys=body.get("preserve_keys") or [],
                    preserve_c2pa=bool(body.get("preserve_c2pa", True)),
                    allow_c2pa_removal=bool(body.get("allow_c2pa_removal", False)),
                )
                cleaned_bytes: bytes = res.pop("cleaned_bytes")
                dur = round((time.perf_counter() - t0) * 1000.0, 2)
                out_path = resolve_non_destructive_output(
                    name, source_path=src_path, output_dir=body.get("output_dir")
                )
                if out_path is not None:
                    safe_write_bytes(out_path, cleaned_bytes)
                out_fname = out_path.name if out_path else f"{Path(name).stem}.originclean{Path(name).suffix}"
                record_operation(
                    original_filename=name,
                    output_filename=out_fname,
                    file_format=res["format"],
                    file_kind=res["kind"],
                    operation_type="metadata_clean",
                    processing_duration_ms=dur,
                    processing_result="success",
                    bytes_in=res["bytes_in"],
                    bytes_out=res["bytes_out"],
                    c2pa_preserved=res["c2pa_preserved"],
                    output_location=str(out_path) if out_path else "(browser export)",
                    summary={"actions": res["actions"], "removed_count": len(res["removed_fields"])},
                )
                res["cleaned"] = base64.b64encode(cleaned_bytes).decode("ascii")
                res["output_filename"] = out_fname
                res["output_location"] = str(out_path) if out_path else ""
                res["duration_ms"] = dur
                self._respond(HTTPStatus.OK, res)

            elif path == "/api/v1/metadata/edit":
                t0 = time.perf_counter()
                data, name, src_path = _extract_bytes_and_name(body)
                updates = body.get("updates")
                if not isinstance(updates, dict):
                    raise ValueError("'updates' must be a key-value object")
                edited_bytes, actions = edit_metadata_bytes(
                    data,
                    name,
                    updates,
                    preserve_c2pa=bool(body.get("preserve_c2pa", True)),
                    allow_c2pa_removal=bool(body.get("allow_c2pa_removal", False)),
                )
                after_meta = inspect_metadata_bytes(edited_bytes, name)
                dur = round((time.perf_counter() - t0) * 1000.0, 2)
                out_path = resolve_non_destructive_output(
                    name, source_path=src_path, output_dir=body.get("output_dir")
                )
                if out_path is not None:
                    safe_write_bytes(out_path, edited_bytes)
                out_fname = out_path.name if out_path else f"{Path(name).stem}.originclean{Path(name).suffix}"
                record_operation(
                    original_filename=name,
                    output_filename=out_fname,
                    file_format=after_meta["format"],
                    file_kind=after_meta["kind"],
                    operation_type="metadata_edit",
                    processing_duration_ms=dur,
                    processing_result="success",
                    bytes_in=len(data),
                    bytes_out=len(edited_bytes),
                    c2pa_preserved=True,
                    output_location=str(out_path) if out_path else "(browser export)",
                    summary={"actions": actions},
                )
                self._respond(
                    HTTPStatus.OK,
                    {
                        "ok": True,
                        "filename": name,
                        "output_filename": out_fname,
                        "output_location": str(out_path) if out_path else "",
                        "actions": actions,
                        "duration_ms": dur,
                        "after_metadata": after_meta,
                        "edited": base64.b64encode(edited_bytes).decode("ascii"),
                    },
                )

            elif path == "/api/v1/batch":
                files = body.get("files")
                if not isinstance(files, list) or not files:
                    raise ValueError("'files' must be a non-empty array")
                res = process_batch_files(
                    files,
                    concurrency=body.get("concurrency"),
                    default_options=body.get("options"),
                )
                self._respond(HTTPStatus.OK, res)

            elif path == "/api/v1/history/clear":
                deleted = clear_history()
                self._respond(HTTPStatus.OK, {"ok": True, "deleted": deleted})

            elif path == "/api/v1/settings":
                updated = update_settings(body)
                self._respond(HTTPStatus.OK, {"ok": True, "settings": updated})

            elif path == "/api/v1/settings/reset":
                reset = reset_settings()
                self._respond(HTTPStatus.OK, {"ok": True, "settings": reset})

            else:
                self._respond(HTTPStatus.NOT_FOUND, {"ok": False, "error": f"unknown endpoint: {path}"})

        except ProvenanceAuthorizationError as exc:
            self._respond(
                HTTPStatus.CONFLICT,
                {
                    "ok": False,
                    "error": str(exc),
                    "requires_c2pa_confirmation": True,
                },
            )
        except ValueError as exc:
            self._respond(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(exc)})
        except Exception as exc:
            self.log_error("OriginClean error handling %s: %r", path, exc)
            self._respond(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(exc)})


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--host", default=os.environ.get("ORIGINCLEAN_HOST", "127.0.0.1"))
    p.add_argument("--port", type=int, default=int(os.environ.get("ORIGINCLEAN_PORT", "8765")))
    p.add_argument("-V", "--version", action="store_true")
    args = p.parse_args()

    if args.version:
        print(APP_METADATA["version"])
        return 0

    init_db()
    server = ThreadingHTTPServer((args.host, args.port), OriginCleanHandler)
    eprint(
        f"OriginClean Backend {APP_METADATA['version']} by {APP_METADATA['developer']} "
        f"listening on http://{args.host}:{args.port}"
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

