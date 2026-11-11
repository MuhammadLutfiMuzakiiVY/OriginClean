import React, { useState, useRef } from "react";
import {
  SearchCode,
  Upload,
  FileCheck2,
  ShieldAlert,
  ShieldCheck,
  Download,
  Hash,
  Loader2,
  FileCode2,
} from "lucide-react";
import { api } from "../services/api";
import type { InspectionResponse } from "../types/originclean";
import { downloadTextFile, fileToBase64, formatBytes, formatDuration } from "../utils/formatters";

interface FileInspectorPageProps {
  onCompleteOperation: () => void;
  onNotify: (type: "success" | "error" | "info", title: string, message?: string) => void;
}

export const FileInspectorPage: React.FC<FileInspectorPageProps> = ({
  onCompleteOperation,
  onNotify,
}) => {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<InspectionResponse | null>(null);
  const [localPathInput, setLocalPathInput] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const inspectSelectedFile = async (file: File) => {
    setLoading(true);
    try {
      const b64 = await fileToBase64(file);
      const res = await api.inspectFile({
        file: b64,
        name: file.name,
        run_detectors: true,
        record_history: true,
      });
      setReport(res);
      onCompleteOperation();
      onNotify("success", `Inspected ${file.name}`);
    } catch (err) {
      onNotify("error", "Inspection failed", err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const inspectByPath = async () => {
    if (!localPathInput.trim()) return;
    setLoading(true);
    try {
      const p = localPathInput.trim();
      const name = p.split(/[/\\]/).pop() || "file";
      const res = await api.inspectFile({
        path: p,
        name,
        run_detectors: true,
        record_history: true,
      });
      setReport(res);
      onCompleteOperation();
      onNotify("success", `Inspected ${res.file_name}`);
    } catch (err) {
      onNotify("error", "Inspection failed", err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const exportReportJson = () => {
    if (!report) return;
    downloadTextFile(
      JSON.stringify(report, null, 2),
      `${report.file_name}.inspection.json`,
      "application/json"
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">File Inspector</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Deep binary signature verification, SHA-256 hashing, C2PA provenance inspection, and 4-class watermark evidence analysis.
          </p>
        </div>
        {report && (
          <button
            type="button"
            onClick={exportReportJson}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export Inspection Report (JSON)</span>
          </button>
        )}
      </div>

      {/* Upload / Path Bar */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) inspectSelectedFile(f);
          }}
          className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-700 p-6 text-center hover:border-sky-500 transition-colors"
        >
          {loading ? (
            <Loader2 className="h-7 w-7 animate-spin text-sky-500 mb-2" />
          ) : (
            <SearchCode className="h-7 w-7 text-sky-500 mb-2" />
          )}
          <p className="text-xs font-semibold">
            Drop any file to inspect its binary structure, metadata, and provenance signals
          </p>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) inspectSelectedFile(f);
            }}
          />
          <button
            type="button"
            disabled={loading}
            onClick={() => fileInputRef.current?.click()}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" />
            <span>Select File to Inspect</span>
          </button>
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={localPathInput}
            onChange={(e) => setLocalPathInput(e.target.value)}
            placeholder="Or inspect by local disk path (includes filesystem creation & modification dates)..."
            className="flex-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-1.5 text-xs"
          />
          <button
            type="button"
            disabled={loading}
            onClick={inspectByPath}
            className="rounded-lg border border-slate-200 dark:border-slate-800 px-3.5 py-1.5 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Inspect Path
          </button>
        </div>
      </div>

      {report && (
        <div className="space-y-6">
          {/* File Identity & Signatures */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                <FileCode2 className="h-4 w-4 text-sky-500" />
                <span>File Properties & Timestamps</span>
              </h2>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-slate-400 block text-[11px]">File Name</span>
                  <span className="font-semibold break-all">{report.file_name}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">File Size</span>
                  <span className="font-mono">{formatBytes(report.file_size)} ({report.file_size} B)</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">MIME Type</span>
                  <span className="font-mono">{report.mime_type}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Extension / Format</span>
                  <span className="font-mono">
                    {report.file_extension} → {report.detected_format.toUpperCase()} ({report.kind})
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Creation Date</span>
                  <span className="font-mono text-[11px]">{report.created_at || "N/A (stream upload)"}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Modification Date</span>
                  <span className="font-mono text-[11px]">{report.modified_at || "N/A (stream upload)"}</span>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                <Hash className="h-4 w-4 text-emerald-500" />
                <span>Cryptographic & Magic Signatures</span>
              </h2>
              <div className="space-y-2.5 text-xs">
                <div>
                  <span className="text-slate-400 block text-[11px]">SHA-256 Digest</span>
                  <code className="block mt-0.5 rounded bg-slate-100 dark:bg-slate-800 p-2 font-mono text-[11px] break-all">
                    {report.signatures.sha256}
                  </code>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Magic Header Bytes (Hex)</span>
                  <code className="block mt-0.5 rounded bg-slate-100 dark:bg-slate-800 p-2 font-mono text-[11px]">
                    {report.signatures.magic_hex}
                  </code>
                </div>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-[11px] text-slate-500">{report.signatures.magic_description}</span>
                  {report.duration_ms !== undefined && (
                    <span className="text-[11px] font-mono text-slate-400">
                      Scanned in {formatDuration(report.duration_ms)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 4-Class Evidence Breakdown */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                {report.suspicious.verdict ? (
                  <ShieldAlert className="h-4 w-4 text-amber-500" />
                ) : (
                  <FileCheck2 className="h-4 w-4 text-emerald-500" />
                )}
                <span>Multi-Class Provenance & Watermark Evidence Matrix</span>
              </h2>
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                  report.suspicious.verdict
                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                    : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                }`}
              >
                {report.suspicious.verdict ? "Signals Detected" : "No Marking Signals Flagged"}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(report.suspicious.classes).map(([clsKey, clsVal]) => (
                <div
                  key={clsKey}
                  className={`rounded-lg border p-3.5 text-xs ${
                    clsVal.present
                      ? "border-amber-500/40 bg-amber-500/5"
                      : "border-slate-200 dark:border-slate-800"
                  }`}
                >
                  <div className="flex items-center justify-between font-semibold">
                    <span className="capitalize">{clsKey.replace(/_/g, " ")}</span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${
                        clsVal.present
                          ? "bg-amber-500/20 text-amber-600 dark:text-amber-400"
                          : "bg-slate-100 dark:bg-slate-800 text-slate-400"
                      }`}
                    >
                      {clsVal.present ? "Present" : "Clear"}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] font-mono text-slate-400">
                    Strength: {clsVal.strength}
                  </p>
                  <p className="mt-1.5 text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                    {clsVal.description}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Provenance & Detected Watermark Indicators */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Detected Watermark & Provenance Indicators ({report.watermark_indicators.length})
              </h3>
              {report.watermark_indicators.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-400">
                  No hidden Unicode carriers, AI metadata hints, or statistical watermark triggers detected.
                </p>
              ) : (
                <ul className="space-y-2 text-xs">
                  {report.watermark_indicators.map((ind, idx) => (
                    <li
                      key={idx}
                      className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-800 p-2.5"
                    >
                      <div>
                        <span className="font-semibold block">{ind.type}</span>
                        <span className="text-[11px] text-slate-600 dark:text-slate-300 font-mono">
                          {ind.codepoint ? `${ind.codepoint} ` : ""}
                          {ind.label}
                          {ind.count ? ` (×${ind.count})` : ""}
                        </span>
                      </div>
                      <span className="rounded bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-mono">
                        {ind.strength}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Embedded Metadata & Properties ({report.metadata.fields.length})
              </h3>
              {report.metadata.fields.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-400">
                  No embedded container metadata fields found.
                </p>
              ) : (
                <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
                  {report.metadata.fields.map((f) => (
                    <div
                      key={f.key}
                      className="flex items-start justify-between gap-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 px-3 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <span className="font-medium block truncate">{f.label}</span>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 break-all">
                          {f.value}
                        </span>
                      </div>
                      <span className="shrink-0 rounded bg-slate-200/70 dark:bg-slate-700 px-1.5 py-0.5 text-[10px] font-mono">
                        {f.category}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {report.provenance.has_c2pa && (
                <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 p-2.5 text-xs text-emerald-700 dark:text-emerald-300">
                  <ShieldCheck className="h-4 w-4 shrink-0" />
                  <span>
                    C2PA Content Credentials detected. Protected by default during cleaning.
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

