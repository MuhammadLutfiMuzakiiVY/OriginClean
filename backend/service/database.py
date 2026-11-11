"""Local SQLite persistence for OriginClean processing history, dashboard stats, and settings."""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_DB_LOCK = threading.Lock()

DEFAULT_SETTINGS: dict[str, Any] = {
    "theme": "system",
    "language": "en",
    "default_output_dir": "",
    "open_output_after_clean": False,
    "preserve_c2pa_by_default": True,
    "keep_non_ai_metadata": False,
    "also_layer_a_text": True,
    "normalize_spaces": True,
    "nfkc_normalization": False,
    "aggressive_homoglyphs": False,
    "deep_images": "auto",
    "clean_attachments": "always",
    "batch_concurrency": 4,
    "max_file_size_mb": 256,
    "automatic_backup": True,
    "secure_temp_cleanup": True,
    "local_only_mode": True,
    "allow_external_network": False,
    "telemetry_enabled": False,
}


def get_db_path() -> Path:
    override = os.environ.get("ORIGINCLEAN_DB_PATH", "").strip()
    if override:
        path = Path(override)
    else:
        path = Path.home() / ".originclean" / "originclean.db"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(str(get_db_path()), timeout=15.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def init_db() -> None:
    with _DB_LOCK, _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS processing_history (
                id TEXT PRIMARY KEY,
                original_filename TEXT NOT NULL,
                output_filename TEXT NOT NULL,
                file_format TEXT NOT NULL,
                file_kind TEXT NOT NULL,
                operation_type TEXT NOT NULL,
                processing_date TEXT NOT NULL,
                processing_duration_ms REAL NOT NULL,
                processing_result TEXT NOT NULL,
                bytes_in INTEGER NOT NULL DEFAULT 0,
                bytes_out INTEGER NOT NULL DEFAULT 0,
                c2pa_preserved INTEGER NOT NULL DEFAULT 1,
                error_details TEXT NOT NULL DEFAULT '',
                output_location TEXT NOT NULL DEFAULT '',
                summary_json TEXT NOT NULL DEFAULT '{}'
            )
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_history_date
            ON processing_history(processing_date DESC)
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value_json TEXT NOT NULL
            )
            """
        )
        conn.commit()


def record_operation(
    *,
    original_filename: str,
    output_filename: str = "",
    file_format: str = "unknown",
    file_kind: str = "unknown",
    operation_type: str,
    processing_duration_ms: float,
    processing_result: str,
    bytes_in: int = 0,
    bytes_out: int = 0,
    c2pa_preserved: bool = True,
    error_details: str = "",
    output_location: str = "",
    summary: dict[str, Any] | None = None,
) -> dict[str, Any]:
    init_db()
    op_id = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
    safe_summary = summary or {}
    row_dict = {
        "id": op_id,
        "original_filename": Path(original_filename).name if original_filename else "unknown",
        "output_filename": Path(output_filename).name if output_filename else "",
        "file_format": (file_format or "unknown").lower(),
        "file_kind": (file_kind or "unknown").lower(),
        "operation_type": operation_type,
        "processing_date": now_iso,
        "processing_duration_ms": round(float(processing_duration_ms), 2),
        "processing_result": processing_result,
        "bytes_in": int(bytes_in),
        "bytes_out": int(bytes_out),
        "c2pa_preserved": bool(c2pa_preserved),
        "error_details": str(error_details or ""),
        "output_location": str(output_location or ""),
        "summary": safe_summary,
    }
    with _DB_LOCK, _connect() as conn:
        conn.execute(
            """
            INSERT INTO processing_history (
                id, original_filename, output_filename, file_format, file_kind,
                operation_type, processing_date, processing_duration_ms,
                processing_result, bytes_in, bytes_out, c2pa_preserved,
                error_details, output_location, summary_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row_dict["id"],
                row_dict["original_filename"],
                row_dict["output_filename"],
                row_dict["file_format"],
                row_dict["file_kind"],
                row_dict["operation_type"],
                row_dict["processing_date"],
                row_dict["processing_duration_ms"],
                row_dict["processing_result"],
                row_dict["bytes_in"],
                row_dict["bytes_out"],
                1 if row_dict["c2pa_preserved"] else 0,
                row_dict["error_details"],
                row_dict["output_location"],
                json.dumps(safe_summary, ensure_ascii=False),
            ),
        )
        conn.commit()
    return row_dict


def _row_to_history(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    raw_summary = d.pop("summary_json", "{}")
    try:
        d["summary"] = json.loads(raw_summary)
    except json.JSONDecodeError:
        d["summary"] = {}
    d["c2pa_preserved"] = bool(d.get("c2pa_preserved", 1))
    return d


def list_history(
    *,
    search: str = "",
    file_format: str = "",
    operation_type: str = "",
    result_filter: str = "",
    sort_by: str = "processing_date",
    sort_dir: str = "desc",
    limit: int = 250,
) -> list[dict[str, Any]]:
    init_db()
    allowed_sorts = {
        "processing_date": "processing_date",
        "original_filename": "original_filename",
        "file_format": "file_format",
        "operation_type": "operation_type",
        "processing_duration_ms": "processing_duration_ms",
        "processing_result": "processing_result",
        "bytes_in": "bytes_in",
    }
    col = allowed_sorts.get(sort_by, "processing_date")
    direction = "ASC" if str(sort_dir).lower() == "asc" else "DESC"

    clauses: list[str] = []
    params: list[Any] = []
    if search.strip():
        q = f"%{search.strip()}%"
        clauses.append(
            "(original_filename LIKE ? OR output_filename LIKE ? OR output_location LIKE ? OR error_details LIKE ?)"
        )
        params.extend([q, q, q, q])
    if file_format.strip() and file_format.strip().lower() != "all":
        clauses.append("file_format = ?")
        params.append(file_format.strip().lower())
    if operation_type.strip() and operation_type.strip().lower() != "all":
        clauses.append("operation_type = ?")
        params.append(operation_type.strip())
    if result_filter.strip() and result_filter.strip().lower() != "all":
        clauses.append("processing_result = ?")
        params.append(result_filter.strip().lower())

    where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    sql = f"SELECT * FROM processing_history {where_sql} ORDER BY {col} {direction}, rowid DESC LIMIT ?"
    params.append(max(1, min(int(limit), 1000)))

    with _DB_LOCK, _connect() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [_row_to_history(r) for r in rows]


def get_history_item(op_id: str) -> dict[str, Any] | None:
    init_db()
    with _DB_LOCK, _connect() as conn:
        row = conn.execute("SELECT * FROM processing_history WHERE id = ?", (op_id,)).fetchone()
    return _row_to_history(row) if row else None


def clear_history() -> int:
    init_db()
    with _DB_LOCK, _connect() as conn:
        cur = conn.execute("DELETE FROM processing_history")
        conn.commit()
        return cur.rowcount


def get_dashboard_stats() -> dict[str, Any]:
    init_db()
    with _DB_LOCK, _connect() as conn:
        totals = conn.execute(
            """
            SELECT
                COUNT(*) AS total_operations,
                SUM(CASE WHEN processing_result IN ('success', 'warning') THEN 1 ELSE 0 END) AS successful_operations,
                SUM(CASE WHEN processing_result = 'failed' THEN 1 ELSE 0 END) AS failed_operations,
                SUM(CASE WHEN processing_result = 'warning' THEN 1 ELSE 0 END) AS warning_operations,
                COALESCE(SUM(bytes_in), 0) AS total_bytes_in,
                COALESCE(SUM(CASE WHEN bytes_in > bytes_out AND bytes_out > 0 THEN bytes_in - bytes_out ELSE 0 END), 0) AS total_bytes_removed,
                COALESCE(AVG(processing_duration_ms), 0.0) AS avg_duration_ms
            FROM processing_history
            """
        ).fetchone()

        by_format_rows = conn.execute(
            """
            SELECT file_format, COUNT(*) AS count
            FROM processing_history
            GROUP BY file_format
            ORDER BY count DESC
            """
        ).fetchall()

        by_op_rows = conn.execute(
            """
            SELECT operation_type, COUNT(*) AS count
            FROM processing_history
            GROUP BY operation_type
            ORDER BY count DESC
            """
        ).fetchall()

        recent_rows = conn.execute(
            """
            SELECT * FROM processing_history
            ORDER BY processing_date DESC, rowid DESC
            LIMIT 12
            """
        ).fetchall()

    recent_activities = [_row_to_history(r) for r in recent_rows]
    seen_files: set[str] = set()
    recent_files: list[dict[str, Any]] = []
    for item in recent_activities:
        fname = item["original_filename"]
        if fname not in seen_files:
            seen_files.add(fname)
            recent_files.append(
                {
                    "filename": fname,
                    "output_filename": item["output_filename"],
                    "file_format": item["file_format"],
                    "file_kind": item["file_kind"],
                    "last_operation": item["operation_type"],
                    "last_result": item["processing_result"],
                    "last_date": item["processing_date"],
                    "bytes_in": item["bytes_in"],
                    "bytes_out": item["bytes_out"],
                    "output_location": item["output_location"],
                }
            )

    return {
        "total_files_processed": int(totals["total_operations"] or 0),
        "successful_files": int(totals["successful_operations"] or 0),
        "failed_operations": int(totals["failed_operations"] or 0),
        "warning_operations": int(totals["warning_operations"] or 0),
        "total_bytes_in": int(totals["total_bytes_in"] or 0),
        "total_bytes_removed": int(totals["total_bytes_removed"] or 0),
        "avg_duration_ms": round(float(totals["avg_duration_ms"] or 0.0), 2),
        "by_format": {r["file_format"]: int(r["count"]) for r in by_format_rows},
        "by_operation": {r["operation_type"]: int(r["count"]) for r in by_op_rows},
        "recent_activities": recent_activities,
        "recent_files": recent_files[:8],
    }


def get_settings() -> dict[str, Any]:
    init_db()
    merged = dict(DEFAULT_SETTINGS)
    with _DB_LOCK, _connect() as conn:
        rows = conn.execute("SELECT key, value_json FROM app_settings").fetchall()
    for r in rows:
        key = r["key"]
        if key in merged:
            try:
                merged[key] = json.loads(r["value_json"])
            except json.JSONDecodeError:
                pass
    return merged


def update_settings(patch: dict[str, Any]) -> dict[str, Any]:
    init_db()
    with _DB_LOCK, _connect() as conn:
        for key, value in patch.items():
            if key not in DEFAULT_SETTINGS:
                continue
            expected_type = type(DEFAULT_SETTINGS[key])
            if expected_type is bool:
                coerced: Any = bool(value)
            elif expected_type is int:
                coerced = max(1, int(value))
            else:
                coerced = str(value)
            conn.execute(
                "INSERT OR REPLACE INTO app_settings (key, value_json) VALUES (?, ?)",
                (key, json.dumps(coerced)),
            )
        conn.commit()
    return get_settings()


def reset_settings() -> dict[str, Any]:
    init_db()
    with _DB_LOCK, _connect() as conn:
        conn.execute("DELETE FROM app_settings")
        conn.commit()
    return get_settings()

