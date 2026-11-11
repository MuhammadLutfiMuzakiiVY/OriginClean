"""Comprehensive File Inspector for OriginClean.

Combines upstream format/watermark/provenance inspection (`service/scripts/`)
with cryptographic signatures, file-system attributes, MIME detection, and
structured metadata analysis (`backend/metadata/manager.py`).
"""

from __future__ import annotations

import hashlib
import mimetypes
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import backend  # noqa: F401
from backend.metadata.manager import inspect_metadata_bytes
from common import BINARY_MAGIC, MAX_INPUT_BYTES
from server import _detect_payload, _inspect_payload

_CUSTOM_MIMES = {
    ".avif": "image/avif",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".webp": "image/webp",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".odt": "application/vnd.oasis.opendocument.text",
    ".epub": "application/epub+zip",
    ".flac": "audio/flac",
    ".m4a": "audio/mp4",
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".tex": "application/x-tex",
}


def detect_magic_signature(data: bytes) -> dict[str, str]:
    head = data[:16]
    hex_str = " ".join(f"{b:02X}" for b in head)
    desc = "Plain text or unstructured stream"
    for magic, label in BINARY_MAGIC:
        if data.startswith(magic):
            desc = f"Signature match: {label}"
            break
    else:
        if len(data) >= 12 and data[4:8] == b"ftyp":
            brand = data[8:12].decode("latin-1", errors="replace")
            desc = f"ISOBMFF container (ftyp={brand})"
        elif data.startswith(b"fLaC"):
            desc = "FLAC lossless audio stream"
        elif data.startswith(b"ID3"):
            desc = f"ID3v2.{data[3] if len(data) > 3 else '?'} tagged audio stream"
    return {
        "sha256": hashlib.sha256(data).hexdigest(),
        "magic_hex": hex_str or "(empty)",
        "magic_description": desc,
    }


def inspect_file_comprehensive(
    *,
    data: bytes | None = None,
    path: Path | str | None = None,
    filename: str | None = None,
    run_detectors: bool = True,
) -> dict[str, Any]:
    created_at: str | None = None
    modified_at: str | None = None
    resolved_path: str | None = None

    if path is not None:
        p = Path(path).resolve()
        if not p.is_file():
            raise ValueError(f"File not found: {p}")
        st = p.stat()
        if st.st_size > MAX_INPUT_BYTES:
            raise ValueError(f"File exceeds maximum allowed size ({MAX_INPUT_BYTES} bytes)")
        data = p.read_bytes()
        filename = filename or p.name
        resolved_path = str(p)
        created_at = datetime.fromtimestamp(st.st_ctime, tz=timezone.utc).astimezone().isoformat(timespec="seconds")
        modified_at = datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).astimezone().isoformat(timespec="seconds")

    if data is None:
        raise ValueError("Either 'data' or 'path' must be provided for inspection")
    if len(data) > MAX_INPUT_BYTES:
        raise ValueError(f"Input exceeds maximum allowed size ({MAX_INPUT_BYTES} bytes)")

    safe_name = Path(filename or "input").name
    ext = Path(safe_name).suffix.lower()
    mime_type = _CUSTOM_MIMES.get(ext) or mimetypes.guess_type(safe_name)[0] or "application/octet-stream"

    signatures = detect_magic_signature(data)
    core_inspect = _inspect_payload(data, safe_name, run_detect=run_detectors)
    detections_res = _detect_payload(data, safe_name) if run_detectors else {"detections": []}
    meta_info = inspect_metadata_bytes(data, safe_name)

    report = core_inspect.get("report", {})
    suspicious = core_inspect.get("suspicious", {})
    kind = core_inspect.get("kind", "unknown")
    detected_format = report.get("format") or meta_info.get("format") or (ext.lstrip(".") if ext else kind)

    watermark_indicators: list[dict[str, Any]] = []
    if report.get("suspicious_total", 0) > 0:
        for h in report.get("hits") or report.get("layer_a_hits") or []:
            watermark_indicators.append(
                {
                    "type": "Layer A Unicode Carrier",
                    "codepoint": h.get("codepoint", ""),
                    "label": h.get("label", ""),
                    "count": h.get("count", 1),
                    "strength": "deterministic",
                    "removable": True,
                }
            )
    for det in detections_res.get("detections", []):
        if det.get("is_watermarked") or (det.get("detector") == "stylometry" and (det.get("score") or 0) >= 0.65):
            watermark_indicators.append(
                {
                    "type": f"Detector: {det.get('detector', 'scheme')}",
                    "label": det.get("scheme") or det.get("density_tier") or det.get("detector"),
                    "score": det.get("score") or det.get("confidence"),
                    "strength": "heuristic" if det.get("detector") == "stylometry" else "scheme_specific",
                    "removable": det.get("detector") != "synthid",
                }
            )
    for f in report.get("findings", []):
        watermark_indicators.append(
            {
                "type": "Container / Provenance Signal",
                "label": f,
                "strength": "definitive" if "c2pa" in f.lower() else "deterministic",
                "removable": True,
            }
        )

    provenance_info = {
        "has_c2pa": bool(report.get("has_c2pa") or meta_info.get("has_c2pa")),
        "has_ai_metadata": bool(report.get("has_ai_metadata") or meta_info.get("has_ai_metadata")),
        "c2pa_preserved_by_default": True,
        "tools_probe": report.get("tools", {}),
        "notes": report.get("notes", []),
    }

    return {
        "ok": True,
        "file_name": safe_name,
        "file_path": resolved_path,
        "file_size": len(data),
        "mime_type": mime_type,
        "file_extension": ext or "(none)",
        "kind": kind,
        "detected_format": str(detected_format),
        "created_at": created_at,
        "modified_at": modified_at,
        "signatures": signatures,
        "suspicious": suspicious,
        "provenance": provenance_info,
        "watermark_indicators": watermark_indicators,
        "detections": detections_res.get("detections", []),
        "metadata": meta_info,
        "raw_report": report,
    }

