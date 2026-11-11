"""Unified File Cleaning, Watermark Removal, and Safe Batch Processing Engine.

Integrates upstream `service/scripts/` cleaners (`clean_text`, `clean_image`,
`clean_container`, `clean_av`, `audio_purify`, `video_purify`) with OriginClean's
C2PA provenance preservation guard, non-destructive output naming, output
integrity validation, and SQLite history logging.
"""

from __future__ import annotations

import base64
import concurrent.futures
import shutil
import tempfile
import time
from pathlib import Path
from typing import Any

import backend  # noqa: F401
from av_meta import clean_av, inspect_av
from backend.metadata.manager import (
    ProvenanceAuthorizationError,
    _restore_c2pa_chunks,
    inspect_metadata_bytes,
)
from backend.service.database import get_settings, record_operation
from clean_audio import audio_purify, is_audio_format, is_audio_name, media_has_video
from clean_video import video_purify
from common import MAX_INPUT_BYTES, looks_binary, safe_write_bytes
from container_meta import DEFAULT_CLEAN_ATTACHMENTS, clean_container
from format_dispatch import classify_bytes
from image_meta import clean_image, detect_format as detect_image_format, run_synthid_score
from server import _apply_layer_b
from text_detectors import run_text_detectors
from text_unicode import clean_text, inspect_text


def resolve_non_destructive_output(
    original_name: str,
    *,
    source_path: Path | None = None,
    output_dir: str | Path | None = None,
) -> Path | None:
    """Compute a safe, non-overwriting output path when an output directory or source path exists."""
    target_dir: Path | None = None
    if output_dir and str(output_dir).strip():
        target_dir = Path(str(output_dir).strip()).expanduser().resolve()
    elif source_path is not None:
        target_dir = source_path.resolve().parent

    if target_dir is None:
        return None

    target_dir.mkdir(parents=True, exist_ok=True)
    safe_base = Path(original_name).name or "output"
    stem = Path(safe_base).stem
    suffix = Path(safe_base).suffix
    if not stem.endswith(".originclean"):
        candidate_name = f"{stem}.originclean{suffix}"
    else:
        candidate_name = safe_base

    candidate = (target_dir / candidate_name).resolve()
    if candidate.parent != target_dir:
        raise ValueError("Path traversal detected in output filename")

    counter = 1
    while candidate.exists() and (source_path is None or candidate == source_path.resolve()):
        candidate = target_dir / f"{stem}.originclean.{counter}{suffix}"
        counter += 1
    return candidate


def process_clean_file(
    *,
    data: bytes | None = None,
    path: str | Path | None = None,
    filename: str | None = None,
    options: dict[str, Any] | None = None,
    operation_type: str = "clean",
    record_history: bool = True,
) -> dict[str, Any]:
    """Clean a single file or remove supported watermarks while preserving original file integrity."""
    t0 = time.perf_counter()
    opts = dict(options or {})
    settings = get_settings()

    source_path: Path | None = None
    if path is not None and str(path).strip():
        source_path = Path(str(path).strip()).resolve()
        if not source_path.is_file():
            raise ValueError(f"Source file does not exist: {source_path}")
        data = source_path.read_bytes()
        filename = filename or source_path.name

    if data is None:
        raise ValueError("Either 'data' or 'path' must be provided")

    max_bytes = int(settings.get("max_file_size_mb", 256)) * 1024 * 1024
    effective_cap = min(MAX_INPUT_BYTES, max(1024 * 1024, max_bytes))
    if len(data) > effective_cap:
        raise ValueError(f"File size ({len(data)} bytes) exceeds limit ({effective_cap} bytes)")

    safe_name = Path(filename or "input.txt").name
    ext = Path(safe_name).suffix.lower()
    kind = classify_bytes(data, ext)
    if kind == "unknown":
        if opts.get("force_text"):
            kind = "text"
        else:
            raise ValueError(
                f"Unrecognized or unsupported file format for '{safe_name}'. "
                "Supported categories: Text, Images (PNG/JPEG/WebP/AVIF/HEIC/BMP/GIF/TIFF), "
                "Documents (PDF/DOCX/XLSX/PPTX/ODT/EPUB/SVG/HTML/MD/LaTeX), and Audio/Video (MP4/MOV/M4A/WAV/MP3/FLAC)."
            )

    preserve_c2pa = bool(
        opts.get("preserve_c2pa", settings.get("preserve_c2pa_by_default", True))
    )
    allow_c2pa_removal = bool(opts.get("allow_c2pa_removal", False))
    keep_non_ai = bool(
        opts.get("keep_non_ai_metadata", settings.get("keep_non_ai_metadata", False))
    )
    if "strip_all_metadata" in opts:
        keep_non_ai = not bool(opts["strip_all_metadata"])

    # Pre-check C2PA presence so we never silently strip authenticity provenance
    meta_before = inspect_metadata_bytes(data, safe_name)
    has_c2pa_before = bool(meta_before.get("has_c2pa"))
    detected_format = str(meta_before.get("format") or ext.lstrip(".") or kind)

    if has_c2pa_before and not preserve_c2pa and not allow_c2pa_removal:
        raise ProvenanceAuthorizationError(
            "C2PA / Content Credentials detected in this file. OriginClean preserves "
            "authenticity provenance by default. Confirm C2PA removal explicitly to proceed."
        )

    with tempfile.TemporaryDirectory(prefix="originclean-work-") as tmp:
        tmpdir = Path(tmp)
        src = tmpdir / safe_name
        src.write_bytes(data)

        if kind == "text":
            if looks_binary(data) and not opts.get("force_text"):
                raise ValueError("Refusing to process binary container bytes as plain text")
            raw_text = data.decode("utf-8", errors="surrogateescape")
            before_inspect = inspect_text(raw_text).to_dict()
            cleaned_text, stats = clean_text(
                raw_text,
                nfkc=bool(opts.get("nfkc", settings.get("nfkc_normalization", False))),
                aggressive_homoglyphs=bool(
                    opts.get("aggressive_homoglyphs", settings.get("aggressive_homoglyphs", False))
                ),
                normalize_spaces=bool(
                    opts.get("normalize_spaces", settings.get("normalize_spaces", True))
                ),
            )
            actions = []
            if stats["removed_count"] or stats["replaced_count"]:
                actions.append(
                    f"Layer A Unicode clean: removed {stats['removed_count']} invisible codepoint(s), "
                    f"normalized {stats['replaced_count']} homoglyph/space codepoint(s)"
                )
            else:
                actions.append("Layer A Unicode scan: no invisible carriers or space homoglyphs found")

            layer_b_info = None
            if opts.get("enable_layer_b") and opts.get("strategy"):
                cleaned_text, layer_b_info = _apply_layer_b(cleaned_text, str(opts["strategy"]), opts)
                actions.append(f"Layer B rewrite applied ({opts['strategy']})")

            cleaned_bytes = cleaned_text.encode("utf-8", errors="surrogateescape")
            report: dict[str, Any] = {
                "kind": "text",
                "format": detected_format,
                "stats": stats,
                "actions": actions,
                "before_suspicious_total": before_inspect.get("suspicious_total", 0),
                "bytes_in": len(data),
                "bytes_out": len(cleaned_bytes),
                "changed": cleaned_bytes != data,
                "still_has_c2pa": False,
                "still_has_ai_metadata": False,
            }
            if layer_b_info:
                report["layer_b"] = layer_b_info
            if opts.get("detect_before"):
                report["detectors_before"] = run_text_detectors(raw_text)
            if opts.get("detect_after"):
                report["detectors_after"] = run_text_detectors(cleaned_text)

        elif kind == "image":
            out_ext = ext or f".{ detect_image_format(data) }"
            dest = tmpdir / f"cleaned{out_ext}"
            remove_pixel = opts.get("remove_pixel") or None
            if remove_pixel not in (None, "ctrlregen", "diffusion"):
                raise ValueError("remove_pixel must be None, 'ctrlregen', or 'diffusion'")
            res = clean_image(
                src,
                dest,
                strip_all_metadata=not keep_non_ai,
                remove_pixel=remove_pixel,
            )
            cleaned_bytes = dest.read_bytes()
            if preserve_c2pa and has_c2pa_before:
                cleaned_bytes, restored_notes = _restore_c2pa_chunks(data, cleaned_bytes, detected_format)
                res.setdefault("actions", []).extend(restored_notes)
                res["still_has_c2pa"] = True
                res["bytes_out"] = len(cleaned_bytes)
                res["changed"] = cleaned_bytes != data
            if opts.get("detect_before") and res.get("synthid_before") is None:
                res["synthid_before"] = run_synthid_score(src)
            if opts.get("detect_after") and res.get("synthid_after") is None:
                dest.write_bytes(cleaned_bytes)
                res["synthid_after"] = run_synthid_score(dest)
            report = {"kind": "image", **res}

        elif kind == "av":
            out_ext = ext or ".mp4"
            dest = tmpdir / f"cleaned{out_ext}"
            remove_pixel = opts.get("remove_pixel") or None
            res = clean_av(src, dest, strip_all_metadata=not keep_non_ai)
            definitely_audio = is_audio_format(res.get("format", ""))
            is_audio = definitely_audio or (is_audio_name(safe_name) and media_has_video(src) is False)
            if is_audio and opts.get("remove_audio_watermark"):
                audio_dest = tmpdir / "cleaned-audio.m4a"
                audio_res = audio_purify(dest, audio_dest)
                res["audio_mark_removal"] = audio_res
                if audio_res.get("available"):
                    dest = audio_dest
                    res["actions"].append(
                        f"FFmpeg acoustic watermark purification (tempo {audio_res.get('tempo')}x, "
                        f"{audio_res.get('pitch_semitones'):+.1f} semitones)"
                    )
                    after_av = inspect_av(dest)
                    res["format"] = after_av.format
                    res["bytes_out"] = dest.stat().st_size
                    res["changed"] = True
                else:
                    res["actions"].append(
                        f"Acoustic watermark purification skipped: {audio_res.get('error', 'ffmpeg unavailable')}"
                    )
            elif remove_pixel in ("ctrlregen", "diffusion"):
                pix = video_purify(dest, dest, remove_pixel=remove_pixel)
                res["pixel_removal"] = pix
                if not pix.get("available"):
                    res["actions"].append(
                        f"Video pixel purification skipped: {pix.get('error', 'backend unavailable')}"
                    )

            cleaned_bytes = dest.read_bytes()
            if preserve_c2pa and has_c2pa_before:
                cleaned_bytes, restored_notes = _restore_c2pa_chunks(data, cleaned_bytes, detected_format)
                res.setdefault("actions", []).extend(restored_notes)
                res["still_has_c2pa"] = True
                res["bytes_out"] = len(cleaned_bytes)
                res["changed"] = cleaned_bytes != data
            report = {"kind": "av", **res}

        else:  # container
            out_ext = ext or f".{detected_format}"
            dest = tmpdir / f"cleaned{out_ext}"
            res = clean_container(
                src,
                dest,
                fmt=detected_format if detected_format != "unknown" else None,
                also_layer_a_text=bool(
                    opts.get("also_layer_a_text", settings.get("also_layer_a_text", True))
                ),
                deep_images=str(opts.get("deep_images", settings.get("deep_images", "auto"))),
                clean_attachments=str(
                    opts.get(
                        "clean_attachments",
                        settings.get("clean_attachments", DEFAULT_CLEAN_ATTACHMENTS),
                    )
                ),
                normalize_spaces=bool(
                    opts.get("normalize_spaces", settings.get("normalize_spaces", True))
                ),
            )
            cleaned_bytes = dest.read_bytes()
            report = {"kind": "container", **res}

    # Output integrity validation
    if len(data) > 0 and len(cleaned_bytes) == 0 and kind != "text":
        raise RuntimeError("Output validation failed: cleaned binary file is unexpectedly 0 bytes")

    output_dir = opts.get("output_dir") or settings.get("default_output_dir") or ""
    saved_output_path: Path | None = None
    output_filename = f"{Path(safe_name).stem}.originclean{Path(safe_name).suffix}"

    if source_path is not None or (output_dir and str(output_dir).strip()):
        if source_path is not None and bool(settings.get("automatic_backup", True)) and opts.get("in_place"):
            bak_path = source_path.with_name(source_path.name + ".bak")
            if not bak_path.exists():
                shutil.copy2(source_path, bak_path)
            saved_output_path = source_path
        else:
            saved_output_path = resolve_non_destructive_output(
                safe_name, source_path=source_path, output_dir=output_dir
            )
        if saved_output_path is not None:
            safe_write_bytes(saved_output_path, cleaned_bytes)
            output_filename = saved_output_path.name

    duration_ms = round((time.perf_counter() - t0) * 1000.0, 2)
    report.pop("input", None)
    report.pop("output", None)

    c2pa_kept = bool(preserve_c2pa if has_c2pa_before else True)
    residual_warning = bool(
        (report.get("still_has_ai_metadata"))
        or (report.get("still_has_c2pa") and not preserve_c2pa)
    )
    result_status = "warning" if residual_warning else "success"

    history_entry = None
    if record_history:
        history_entry = record_operation(
            original_filename=safe_name,
            output_filename=output_filename,
            file_format=detected_format,
            file_kind=kind,
            operation_type=operation_type,
            processing_duration_ms=duration_ms,
            processing_result=result_status,
            bytes_in=len(data),
            bytes_out=len(cleaned_bytes),
            c2pa_preserved=c2pa_kept,
            output_location=str(saved_output_path) if saved_output_path else "(in-memory / browser export)",
            summary={
                "actions": report.get("actions", []),
                "changed": bool(report.get("changed", cleaned_bytes != data)),
                "has_c2pa_before": has_c2pa_before,
                "c2pa_preserved": c2pa_kept,
            },
        )

    return {
        "ok": True,
        "operation_id": history_entry["id"] if history_entry else None,
        "original_filename": safe_name,
        "output_filename": output_filename,
        "output_location": str(saved_output_path) if saved_output_path else "",
        "kind": kind,
        "format": detected_format,
        "bytes_in": len(data),
        "bytes_out": len(cleaned_bytes),
        "changed": cleaned_bytes != data,
        "c2pa_preserved": c2pa_kept,
        "duration_ms": duration_ms,
        "status": result_status,
        "cleaned": base64.b64encode(cleaned_bytes).decode("ascii"),
        "report": report,
    }


def process_batch_files(
    items: list[dict[str, Any]],
    *,
    concurrency: int | None = None,
    default_options: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Process multiple files with bounded concurrency and per-file fault isolation."""
    t0 = time.perf_counter()
    settings = get_settings()
    workers = min(max(1, int(concurrency or settings.get("batch_concurrency", 4))), 8)
    base_opts = dict(default_options or {})

    def _run_one(idx: int, entry: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        fname = str(entry.get("name") or entry.get("path") or f"file_{idx + 1}")
        file_opts = {**base_opts, **(entry.get("options") or {})}
        item_t0 = time.perf_counter()
        try:
            raw_bytes: bytes | None = None
            if "file" in entry and isinstance(entry["file"], str):
                raw_bytes = base64.b64decode(entry["file"], validate=True)
            res = process_clean_file(
                data=raw_bytes,
                path=entry.get("path"),
                filename=fname,
                options=file_opts,
                operation_type=str(entry.get("operation_type") or "batch_clean"),
                record_history=True,
            )
            return idx, res
        except Exception as exc:
            dur = round((time.perf_counter() - item_t0) * 1000.0, 2)
            ext = Path(fname).suffix.lower().lstrip(".") or "unknown"
            record_operation(
                original_filename=Path(fname).name,
                output_filename="",
                file_format=ext,
                file_kind="unknown",
                operation_type="batch_clean",
                processing_duration_ms=dur,
                processing_result="failed",
                error_details=str(exc),
            )
            return idx, {
                "ok": False,
                "original_filename": Path(fname).name,
                "status": "failed",
                "duration_ms": dur,
                "error": str(exc),
            }

    ordered_results: list[dict[str, Any]] = [{}] * len(items)
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(_run_one, i, item) for i, item in enumerate(items)]
        for fut in concurrent.futures.as_completed(futures):
            idx, res = fut.result()
            ordered_results[idx] = res

    total_ms = round((time.perf_counter() - t0) * 1000.0, 2)
    succeeded = sum(1 for r in ordered_results if r.get("ok"))
    failed = len(ordered_results) - succeeded
    return {
        "ok": True,
        "total_files": len(ordered_results),
        "succeeded": succeeded,
        "failed": failed,
        "concurrency_used": workers,
        "total_duration_ms": total_ms,
        "results": ordered_results,
    }

