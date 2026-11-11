import React, { useState, useRef } from "react";
import {
  Layers,
  Upload,
  Play,
  RotateCcw,
  Trash2,
  Download,
  CheckCircle2,
  XCircle,
  Loader2,
  Ban,
} from "lucide-react";
import { api } from "../services/api";
import type { CleanResponse } from "../types/originclean";
import {
  downloadBase64File,
  downloadTextFile,
  fileToBase64,
  formatBytes,
  formatDuration,
} from "../utils/formatters";

interface BatchJob {
  id: string;
  file: File;
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  result?: CleanResponse;
  error?: string;
}

interface BatchProcessingPageProps {
  defaultConcurrency: number;
  defaultOutputDir: string;
  onCompleteOperation: () => void;
  onNotify: (type: "success" | "error" | "info", title: string, message?: string) => void;
}

export const BatchProcessingPage: React.FC<BatchProcessingPageProps> = ({
  defaultConcurrency,
  defaultOutputDir,
  onCompleteOperation,
  onNotify,
}) => {
  const [jobs, setJobs] = useState<BatchJob[]>([]);
  const [concurrency, setConcurrency] = useState(defaultConcurrency || 4);
  const [outputDir, setOutputDir] = useState(defaultOutputDir);
  const [preserveC2pa, setPreserveC2pa] = useState(true);
  const [running, setRunning] = useState(false);
  const cancelRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const next: BatchJob[] = Array.from(files).map((f) => ({
      id: `${f.name}-${f.size}-${Math.random().toString(36).slice(2, 7)}`,
      file: f,
      status: "pending",
    }));
    setJobs((prev) => [...prev, ...next]);
  };

  const runBatchJobs = async (retryFailedOnly = false) => {
    cancelRef.current = false;
    setRunning(true);
    const targetJobs = jobs.filter((j) =>
      retryFailedOnly ? j.status === "failed" : j.status === "pending"
    );

    const chunkSize = Math.max(1, Math.min(concurrency, 8));
    for (let i = 0; i < targetJobs.length; i += chunkSize) {
      if (cancelRef.current) {
        setJobs((prev) =>
          prev.map((j) => (j.status === "pending" ? { ...j, status: "cancelled" } : j))
        );
        break;
      }
      const slice = targetJobs.slice(i, i + chunkSize);
      const sliceIds = new Set(slice.map((s) => s.id));
      setJobs((prev) =>
        prev.map((j) => (sliceIds.has(j.id) ? { ...j, status: "running", error: undefined } : j))
      );

      try {
        const encodedFiles = await Promise.all(
          slice.map(async (s) => ({
            name: s.file.name,
            file: await fileToBase64(s.file),
          }))
        );
        const batchRes = await api.runBatch({
          files: encodedFiles,
          concurrency: chunkSize,
          options: {
            preserve_c2pa: preserveC2pa,
            allow_c2pa_removal: !preserveC2pa,
            output_dir: outputDir.trim() || undefined,
          },
        });

        setJobs((prev) =>
          prev.map((j) => {
            const idxInSlice = slice.findIndex((s) => s.id === j.id);
            if (idxInSlice === -1) return j;
            const r = batchRes.results[idxInSlice];
            if (r && r.ok) {
              return { ...j, status: "done", result: r };
            }
            return { ...j, status: "failed", error: r?.error || "Processing error" };
          })
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setJobs((prev) =>
          prev.map((j) => (sliceIds.has(j.id) ? { ...j, status: "failed", error: msg } : j))
        );
      }
    }

    setRunning(false);
    onCompleteOperation();
    onNotify("success", "Batch execution completed");
  };

  const doneCount = jobs.filter((j) => j.status === "done").length;
  const failCount = jobs.filter((j) => j.status === "failed").length;
  const progress = jobs.length > 0 ? Math.round(((doneCount + failCount) / jobs.length) * 100) : 0;

  const exportSummaryReport = () => {
    const summary = jobs.map((j) => ({
      name: j.file.name,
      size: j.file.size,
      status: j.status,
      duration_ms: j.result?.duration_ms,
      bytes_out: j.result?.bytes_out,
      actions: j.result?.report?.actions,
      error: j.error,
    }));
    downloadTextFile(JSON.stringify(summary, null, 2), "originclean-batch-report.json");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Batch Processing</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Process large queues with bounded concurrency limits, fault isolation, and detailed error reporting.
          </p>
        </div>
        {jobs.length > 0 && (
          <button
            type="button"
            onClick={exportSummaryReport}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export Batch Report</span>
          </button>
        )}
      </div>

      {/* Batch Configuration & Dropzone */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            addFiles(e.dataTransfer.files);
          }}
          className="lg:col-span-2 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 text-center hover:border-emerald-500 transition-colors"
        >
          <Layers className="h-8 w-8 text-emerald-500 mb-2" />
          <p className="text-sm font-semibold">Drop multiple files for parallel batch cleaning</p>
          <p className="mt-1 text-xs text-slate-500">
            Per-file failures are isolated and never abort the rest of the batch.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => addFiles(e.target.files)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            <Upload className="h-4 w-4" />
            <span>Add Files to Batch</span>
          </button>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Concurrency & Resource Limits
          </h2>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="font-medium">Worker Concurrency</span>
              <span className="font-mono font-semibold text-emerald-600">{concurrency} threads</span>
            </div>
            <input
              type="range"
              min={1}
              max={8}
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value))}
              className="w-full accent-emerald-600"
            />
            <span className="text-[10px] text-slate-400">
              Capped at 8 concurrent workers to prevent memory exhaustion on large media containers.
            </span>
          </div>

          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={preserveC2pa}
              onChange={(e) => setPreserveC2pa(e.target.checked)}
              className="rounded border-slate-300 text-emerald-600"
            />
            <span className="font-medium">Preserve C2PA Provenance</span>
          </label>

          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Output Directory</label>
            <input
              type="text"
              value={outputDir}
              onChange={(e) => setOutputDir(e.target.value)}
              placeholder="Optional local directory path..."
              className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5 text-xs"
            />
          </div>
        </div>
      </div>

      {/* Batch Queue Table */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Batch Queue ({jobs.length} files)</h2>
            <p className="text-xs text-slate-500">
              {doneCount} succeeded · {failCount} failed · Overall progress: {progress}%
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={running || !jobs.some((j) => j.status === "pending")}
              onClick={() => runBatchJobs(false)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
            >
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              <span>Start Batch</span>
            </button>

            {running && (
              <button
                type="button"
                onClick={() => {
                  cancelRef.current = true;
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white"
              >
                <Ban className="h-3.5 w-3.5" />
                <span>Cancel Pending</span>
              </button>
            )}

            {failCount > 0 && !running && (
              <button
                type="button"
                onClick={() => runBatchJobs(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Retry Failed ({failCount})</span>
              </button>
            )}

            {jobs.length > 0 && !running && (
              <button
                type="button"
                onClick={() => setJobs([])}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-rose-600"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Clear</span>
              </button>
            )}
          </div>
        </div>

        {jobs.length > 0 && (
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}

        {jobs.length === 0 ? (
          <p className="py-8 text-center text-xs text-slate-400">No batch jobs queued.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-400">
                  <th className="pb-2 font-medium">File</th>
                  <th className="pb-2 font-medium">Size</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Duration</th>
                  <th className="pb-2 font-medium">Details / Error</th>
                  <th className="pb-2 text-right font-medium">Export</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td className="py-2.5 font-medium">{j.file.name}</td>
                    <td className="py-2.5 font-mono text-[11px] text-slate-500">
                      {formatBytes(j.file.size)}
                    </td>
                    <td className="py-2.5">
                      {j.status === "done" && (
                        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Done
                        </span>
                      )}
                      {j.status === "failed" && (
                        <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 font-semibold">
                          <XCircle className="h-3.5 w-3.5" /> Failed
                        </span>
                      )}
                      {j.status === "running" && (
                        <span className="inline-flex items-center gap-1 text-sky-500 font-semibold">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Running
                        </span>
                      )}
                      {(j.status === "pending" || j.status === "cancelled") && (
                        <span className="text-slate-400 capitalize">{j.status}</span>
                      )}
                    </td>
                    <td className="py-2.5 font-mono text-[11px] text-slate-500">
                      {j.result ? formatDuration(j.result.duration_ms) : "—"}
                    </td>
                    <td className="py-2.5 text-[11px] text-slate-600 dark:text-slate-300 max-w-xs truncate">
                      {j.error || j.result?.report?.actions?.join("; ") || "—"}
                    </td>
                    <td className="py-2.5 text-right">
                      {j.result && (
                        <button
                          type="button"
                          onClick={() =>
                            downloadBase64File(j.result!.cleaned, j.result!.output_filename)
                          }
                          className="inline-flex items-center gap-1 rounded bg-emerald-600/10 px-2 py-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400"
                        >
                          <Download className="h-3 w-3" /> Export
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
    </div>
  );
};

