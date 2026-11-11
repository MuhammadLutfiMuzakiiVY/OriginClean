import React, { useState, useRef } from "react";
import {
  Upload,
  FolderOpen,
  Play,
  RotateCcw,
  Trash2,
  Download,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  Ban,
} from "lucide-react";
import { api } from "../services/api";
import type { CleanOptions, CleanResponse } from "../types/originclean";
import { downloadBase64File, fileToBase64, formatBytes, formatDuration } from "../utils/formatters";
import { ConfirmDialog } from "../components/ConfirmDialog";

interface QueueEntry {
  id: string;
  file?: File;
  localPath?: string;
  name: string;
  extension: string;
  size: number;
  status: "queued" | "processing" | "success" | "warning" | "failed" | "cancelled";
  durationMs?: number;
  result?: CleanResponse;
  error?: string;
}

interface FileCleanerPageProps {
  defaultOutputDir: string;
  defaultPreserveC2pa: boolean;
  onCompleteOperation: () => void;
  onNotify: (type: "success" | "error" | "info", title: string, message?: string) => void;
}

export const FileCleanerPage: React.FC<FileCleanerPageProps> = ({
  defaultOutputDir,
  defaultPreserveC2pa,
  onCompleteOperation,
  onNotify,
}) => {
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [preserveC2pa, setPreserveC2pa] = useState(defaultPreserveC2pa);
  const [allowC2paRemoval, setAllowC2paRemoval] = useState(false);
  const [showC2paConfirm, setShowC2paConfirm] = useState(false);
  const [keepNonAiMetadata, setKeepNonAiMetadata] = useState(false);
  const [alsoLayerAText, setAlsoLayerAText] = useState(true);
  const [normalizeSpaces, setNormalizeSpaces] = useState(true);
  const [nfkc, setNfkc] = useState(false);
  const [outputDir, setOutputDir] = useState(defaultOutputDir);
  const [folderScanPath, setFolderScanPath] = useState("");
  const cancelRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const addBrowserFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const added: QueueEntry[] = Array.from(fileList).map((f) => {
      const dot = f.name.lastIndexOf(".");
      return {
        id: `${f.name}-${f.size}-${Math.random().toString(36).slice(2, 8)}`,
        file: f,
        name: f.name,
        extension: dot >= 0 ? f.name.slice(dot).toLowerCase() : "(none)",
        size: f.size,
        status: "queued",
      };
    });
    setQueue((prev) => [...prev, ...added]);
  };

  const handleScanFolder = async () => {
    if (!folderScanPath.trim()) return;
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const paths = await invoke<string[]>("list_directory_files", { dirPath: folderScanPath.trim() });
        const added: QueueEntry[] = paths.map((p) => {
          const name = p.split(/[/\\]/).pop() || p;
          const dot = name.lastIndexOf(".");
          return {
            id: `${p}-${Math.random().toString(36).slice(2, 7)}`,
            localPath: p,
            name,
            extension: dot >= 0 ? name.slice(dot).toLowerCase() : "(none)",
            size: 0,
            status: "queued",
          };
        });
        setQueue((prev) => [...prev, ...added]);
        onNotify("info", `Added ${added.length} files from folder`);
      } catch (err) {
        onNotify("error", "Folder scan failed", err instanceof Error ? err.message : String(err));
      }
    } else {
      // Allow adding a single local file path directly when running with local backend
      const p = folderScanPath.trim();
      const name = p.split(/[/\\]/).pop() || p;
      const dot = name.lastIndexOf(".");
      setQueue((prev) => [
        ...prev,
        {
          id: `${p}-${Date.now()}`,
          localPath: p,
          name,
          extension: dot >= 0 ? name.slice(dot).toLowerCase() : "(none)",
          size: 0,
          status: "queued",
        },
      ]);
      setFolderScanPath("");
    }
  };

  const handleToggleC2pa = (checked: boolean) => {
    if (!checked) {
      setShowC2paConfirm(true);
    } else {
      setPreserveC2pa(true);
      setAllowC2paRemoval(false);
    }
  };

  const processQueue = async (onlyFailed = false) => {
    cancelRef.current = false;
    setIsRunning(true);
    const options: CleanOptions = {
      preserve_c2pa: preserveC2pa,
      allow_c2pa_removal: allowC2paRemoval,
      keep_non_ai_metadata: keepNonAiMetadata,
      also_layer_a_text: alsoLayerAText,
      normalize_spaces: normalizeSpaces,
      nfkc,
      output_dir: outputDir.trim() || undefined,
    };

    for (const item of queue) {
      if (cancelRef.current) {
        setQueue((prev) =>
          prev.map((q) => (q.status === "queued" ? { ...q, status: "cancelled" } : q))
        );
        break;
      }
      if (onlyFailed && item.status !== "failed") continue;
      if (!onlyFailed && item.status !== "queued") continue;

      setQueue((prev) => prev.map((q) => (q.id === item.id ? { ...q, status: "processing", error: undefined } : q)));
      try {
        const b64 = item.file ? await fileToBase64(item.file) : undefined;
        const res = await api.cleanFile({
          file: b64,
          path: item.localPath,
          name: item.name,
          options,
          operation_type: "clean",
        });
        setQueue((prev) =>
          prev.map((q) =>
            q.id === item.id
              ? {
                  ...q,
                  size: res.bytes_in || q.size,
                  status: res.status === "warning" ? "warning" : "success",
                  durationMs: res.duration_ms,
                  result: res,
                }
              : q
          )
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setQueue((prev) =>
          prev.map((q) => (q.id === item.id ? { ...q, status: "failed", error: msg } : q))
        );
      }
    }

    setIsRunning(false);
    onCompleteOperation();
    onNotify("success", "Cleaning queue finished");
  };

  const completedCount = queue.filter((q) => q.status === "success" || q.status === "warning").length;
  const failedCount = queue.filter((q) => q.status === "failed").length;
  const progressPct = queue.length > 0 ? Math.round(((completedCount + failedCount) / queue.length) * 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">File Cleaner</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Non-destructive multi-format cleaning for Text, Images, Documents, Audio, and Video. Original files are never overwritten by default.
        </p>
      </div>

      {/* Dropzone & Controls */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              addBrowserFiles(e.dataTransfer.files);
            }}
            className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 text-center hover:border-emerald-500 transition-colors"
          >
            <Upload className="h-8 w-8 text-emerald-500 mb-3" />
            <p className="text-sm font-semibold">Drag and drop files here, or browse from disk</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Supports PNG, JPEG, WebP, AVIF, HEIC, BMP, GIF, TIFF, PDF, DOCX, XLSX, PPTX, ODT, EPUB, SVG, HTML, MD, MP4, MOV, WAV, MP3, FLAC & Code/Text
            </p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => addBrowserFiles(e.target.files)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
            >
              <FolderOpen className="h-4 w-4" />
              <span>Browse Files</span>
            </button>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={folderScanPath}
              onChange={(e) => setFolderScanPath(e.target.value)}
              placeholder="Or enter local file / directory path (e.g. C:\Users\...\file.png)"
              className="flex-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
            />
            <button
              type="button"
              onClick={handleScanFolder}
              className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3.5 py-2 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Add Path
            </button>
          </div>
        </div>

        {/* Cleaning Options Panel */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3.5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Cleaning Policy & Output
          </h2>

          <label className="flex items-start gap-2.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={preserveC2pa}
              onChange={(e) => handleToggleC2pa(e.target.checked)}
              className="mt-0.5 rounded border-slate-300 text-emerald-600"
            />
            <div>
              <span className="font-semibold flex items-center gap-1">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                Preserve C2PA Provenance
              </span>
              <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                Retains cryptographic Content Credentials by default.
              </span>
            </div>
          </label>

          <label className="flex items-start gap-2.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={keepNonAiMetadata}
              onChange={(e) => setKeepNonAiMetadata(e.target.checked)}
              className="mt-0.5 rounded border-slate-300 text-emerald-600"
            />
            <div>
              <span className="font-medium">Keep Non-AI Camera/Author Metadata</span>
              <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                Only strip AI-generator markers when enabled.
              </span>
            </div>
          </label>

          <label className="flex items-start gap-2.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={alsoLayerAText}
              onChange={(e) => setAlsoLayerAText(e.target.checked)}
              className="mt-0.5 rounded border-slate-300 text-emerald-600"
            />
            <div>
              <span className="font-medium">Scrub Invisible Unicode (Layer A)</span>
              <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                Removes zero-width characters & variation selectors.
              </span>
            </div>
          </label>

          <label className="flex items-center gap-2.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={normalizeSpaces}
              onChange={(e) => setNormalizeSpaces(e.target.checked)}
              className="rounded border-slate-300 text-emerald-600"
            />
            <span className="font-medium">Normalize Space Homoglyphs</span>
          </label>

          <label className="flex items-center gap-2.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={nfkc}
              onChange={(e) => setNfkc(e.target.checked)}
              className="rounded border-slate-300 text-emerald-600"
            />
            <span className="font-medium">NFKC Compatibility Normalization</span>
          </label>

          <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
            <label className="block text-[11px] font-medium text-slate-500 mb-1">
              Output Directory (Non-Destructive)
            </label>
            <input
              type="text"
              value={outputDir}
              onChange={(e) => setOutputDir(e.target.value)}
              placeholder="Default: <filename>.originclean.<ext>"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5 text-xs"
            />
          </div>
        </div>
      </div>

      {/* Queue Controls & Progress */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold">Processing Queue ({queue.length})</h2>
            {queue.length > 0 && (
              <span className="text-xs text-slate-500">
                {completedCount} completed · {failedCount} failed · {progressPct}%
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => processQueue(false)}
              disabled={isRunning || !queue.some((q) => q.status === "queued")}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
            >
              {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              <span>Process Queue</span>
            </button>

            {isRunning && (
              <button
                type="button"
                onClick={() => {
                  cancelRef.current = true;
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
              >
                <Ban className="h-3.5 w-3.5" />
                <span>Cancel</span>
              </button>
            )}

            {failedCount > 0 && !isRunning && (
              <button
                type="button"
                onClick={() => processQueue(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Retry Failed ({failedCount})</span>
              </button>
            )}

            {queue.length > 0 && !isRunning && (
              <button
                type="button"
                onClick={() => setQueue([])}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-500/10"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Clear Queue</span>
              </button>
            )}
          </div>
        </div>

        {queue.length > 0 && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className="h-full bg-emerald-500 transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}

        {queue.length === 0 ? (
          <p className="py-8 text-center text-xs text-slate-400">
            Queue is empty. Add one or more files above to start cleaning.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-400">
                  <th className="pb-2 font-medium">Original Filename</th>
                  <th className="pb-2 font-medium">Ext</th>
                  <th className="pb-2 font-medium">Size</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Duration</th>
                  <th className="pb-2 font-medium">Summary / Output</th>
                  <th className="pb-2 text-right font-medium">Export</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {queue.map((item) => (
                  <tr key={item.id}>
                    <td className="py-3 font-medium">{item.name}</td>
                    <td className="py-3 font-mono text-[11px] text-slate-500">{item.extension}</td>
                    <td className="py-3 font-mono text-[11px] text-slate-500">
                      {formatBytes(item.result?.bytes_in ?? item.size)}
                      {item.result && ` → ${formatBytes(item.result.bytes_out)}`}
                    </td>
                    <td className="py-3">
                      {item.status === "queued" && (
                        <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-medium">
                          Queued
                        </span>
                      )}
                      {item.status === "processing" && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold text-sky-500">
                          <Loader2 className="h-3 w-3 animate-spin" /> Processing
                        </span>
                      )}
                      {item.status === "success" && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="h-3 w-3" /> Cleaned
                        </span>
                      )}
                      {item.status === "warning" && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                          <AlertTriangle className="h-3 w-3" /> Warning
                        </span>
                      )}
                      {item.status === "failed" && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold text-rose-600 dark:text-rose-400">
                          <XCircle className="h-3 w-3" /> Failed
                        </span>
                      )}
                      {item.status === "cancelled" && (
                        <span className="rounded-full bg-slate-200 dark:bg-slate-800 px-2 py-0.5 text-[10px]">
                          Cancelled
                        </span>
                      )}
                    </td>
                    <td className="py-3 font-mono text-[11px] text-slate-500">
                      {item.durationMs !== undefined ? formatDuration(item.durationMs) : "—"}
                    </td>
                    <td className="py-3 text-[11px] text-slate-600 dark:text-slate-300 max-w-xs truncate">
                      {item.error
                        ? item.error
                        : item.result?.report?.actions?.join("; ") ||
                          item.result?.output_location ||
                          "—"}
                    </td>
                    <td className="py-3 text-right">
                      {item.result && (
                        <button
                          type="button"
                          onClick={() =>
                            downloadBase64File(item.result!.cleaned, item.result!.output_filename)
                          }
                          className="inline-flex items-center gap-1 rounded-md bg-emerald-600/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-600/20"
                        >
                          <Download className="h-3.5 w-3.5" />
                          <span>Export</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={showC2paConfirm}
        title="Authorize C2PA Provenance Modification?"
        description="Disabling C2PA preservation will strip cryptographic Content Credentials and digital authenticity manifests from processed files. Modified provenance can never be represented as original or verified. Do you explicitly authorize removing C2PA provenance?"
        confirmLabel="Authorize C2PA Removal"
        cancelLabel="Keep C2PA Protected"
        variant="warning"
        onConfirm={() => {
          setPreserveC2pa(false);
          setAllowC2paRemoval(true);
          setShowC2paConfirm(false);
        }}
        onCancel={() => {
          setPreserveC2pa(true);
          setAllowC2paRemoval(false);
          setShowC2paConfirm(false);
        }}
      />
    </div>
  );
};

