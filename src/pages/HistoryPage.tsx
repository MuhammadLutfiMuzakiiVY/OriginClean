import React, { useState, useEffect, useCallback } from "react";
import {
  Search,
  Trash2,
  ArrowUpDown,
  Eye,
  Download,
  RefreshCw,
} from "lucide-react";
import { api } from "../services/api";
import type { HistoryItem } from "../types/originclean";
import { downloadTextFile, formatBytes, formatDuration } from "../utils/formatters";
import { ConfirmDialog } from "../components/ConfirmDialog";

interface HistoryPageProps {
  onHistoryChanged: () => void;
  onNotify: (type: "success" | "error" | "info", title: string, message?: string) => void;
}

export const HistoryPage: React.FC<HistoryPageProps> = ({ onHistoryChanged, onNotify }) => {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [formatFilter, setFormatFilter] = useState("all");
  const [operationFilter, setOperationFilter] = useState("all");
  const [resultFilter, setResultFilter] = useState("all");
  const [sortBy, setSortBy] = useState("processing_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedItem, setSelectedItem] = useState<HistoryItem | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getHistory({
        search,
        format: formatFilter,
        operation: operationFilter,
        result: resultFilter,
        sort_by: sortBy,
        sort_dir: sortDir,
      });
      setItems(res.items);
    } catch (err) {
      onNotify("error", "Failed to load history", err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [search, formatFilter, operationFilter, resultFilter, sortBy, sortDir, onNotify]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const handleClearHistory = async () => {
    setConfirmClear(false);
    try {
      const res = await api.clearHistory();
      setItems([]);
      setSelectedItem(null);
      onHistoryChanged();
      onNotify("success", `Cleared ${res.deleted} history record(s)`);
    } catch (err) {
      onNotify("error", "Failed to clear history", err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Processing History</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Local SQLite audit log of operations. User file contents are never stored in the history database.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchHistory}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>
          {items.length > 0 && (
            <>
              <button
                type="button"
                onClick={() =>
                  downloadTextFile(JSON.stringify(items, null, 2), "originclean-history.json")
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Export Log</span>
              </button>
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Clear History</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Filters & Search */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <div className="relative">
          <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search filename, output location, or error..."
            className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 pl-8 pr-3 py-1.5 text-xs"
          />
        </div>

        <select
          value={formatFilter}
          onChange={(e) => setFormatFilter(e.target.value)}
          className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5 text-xs"
        >
          <option value="all">All Formats</option>
          <option value="png">PNG</option>
          <option value="jpeg">JPEG</option>
          <option value="webp">WebP</option>
          <option value="avif">AVIF / HEIC</option>
          <option value="pdf">PDF</option>
          <option value="docx">DOCX / XLSX / PPTX</option>
          <option value="mp4">MP4 / MOV</option>
          <option value="mp3">MP3 / WAV / FLAC</option>
          <option value="txt">Text / Markdown</option>
        </select>

        <select
          value={operationFilter}
          onChange={(e) => setOperationFilter(e.target.value)}
          className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5 text-xs"
        >
          <option value="all">All Operations</option>
          <option value="clean">File Clean</option>
          <option value="inspect">Inspect</option>
          <option value="watermark_remove">Watermark Remove</option>
          <option value="metadata_clean">Metadata Clean</option>
          <option value="metadata_edit">Metadata Edit</option>
          <option value="batch_clean">Batch Clean</option>
        </select>

        <select
          value={resultFilter}
          onChange={(e) => setResultFilter(e.target.value)}
          className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5 text-xs"
        >
          <option value="all">All Results</option>
          <option value="success">Success</option>
          <option value="warning">Warning</option>
          <option value="failed">Failed</option>
        </select>

        <div className="flex gap-1.5">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="flex-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-2 py-1.5 text-xs"
          >
            <option value="processing_date">Sort: Date</option>
            <option value="original_filename">Sort: Name</option>
            <option value="processing_duration_ms">Sort: Duration</option>
            <option value="bytes_in">Sort: Size</option>
          </select>
          <button
            type="button"
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            className="rounded-lg border border-slate-200 dark:border-slate-800 px-2.5 py-1.5 text-xs"
            title="Toggle sort direction"
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* History Table */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        {items.length === 0 ? (
          <p className="py-10 text-center text-xs text-slate-400">
            No history records match your current filter.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-400">
                  <th className="pb-2 font-medium">Operation ID</th>
                  <th className="pb-2 font-medium">Original File</th>
                  <th className="pb-2 font-medium">Format</th>
                  <th className="pb-2 font-medium">Operation</th>
                  <th className="pb-2 font-medium">Date</th>
                  <th className="pb-2 font-medium">Duration</th>
                  <th className="pb-2 font-medium">Result</th>
                  <th className="pb-2 text-right font-medium">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="py-2.5 font-mono text-[11px] text-slate-400">
                      {item.id.slice(0, 8)}
                    </td>
                    <td className="py-2.5 font-medium">{item.original_filename}</td>
                    <td className="py-2.5 font-mono uppercase text-[11px] text-slate-500">
                      {item.file_format}
                    </td>
                    <td className="py-2.5 capitalize">{item.operation_type.replace("_", " ")}</td>
                    <td className="py-2.5 font-mono text-[11px] text-slate-500">
                      {item.processing_date.replace("T", " ").slice(0, 19)}
                    </td>
                    <td className="py-2.5 font-mono text-[11px] text-slate-500">
                      {formatDuration(item.processing_duration_ms)}
                    </td>
                    <td className="py-2.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          item.processing_result === "success"
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : item.processing_result === "warning"
                            ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                            : "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                        }`}
                      >
                        {item.processing_result}
                      </span>
                    </td>
                    <td className="py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => setSelectedItem(item)}
                        className="inline-flex items-center gap-1 rounded bg-slate-100 dark:bg-slate-800 px-2 py-1 text-[11px] font-medium hover:bg-slate-200 dark:hover:bg-slate-700"
                      >
                        <Eye className="h-3 w-3" /> View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Selected History Details Drawer */}
      {selectedItem && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              Operation Details — {selectedItem.original_filename}
            </h3>
            <button
              type="button"
              onClick={() => setSelectedItem(null)}
              className="text-slate-400 hover:text-slate-600"
            >
              Close
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <span className="text-slate-400 block text-[11px]">Operation ID</span>
              <span className="font-mono text-[11px]">{selectedItem.id}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px]">Output Filename</span>
              <span className="font-mono">{selectedItem.output_filename || "N/A"}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px]">Byte Delta</span>
              <span className="font-mono">
                {formatBytes(selectedItem.bytes_in)} → {formatBytes(selectedItem.bytes_out)}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px]">Output Location</span>
              <span className="font-mono text-[11px] break-all">
                {selectedItem.output_location || "N/A"}
              </span>
            </div>
          </div>
          {selectedItem.error_details && (
            <div className="rounded bg-rose-500/10 p-2.5 text-rose-600 font-mono">
              Error: {selectedItem.error_details}
            </div>
          )}
          <pre className="rounded bg-slate-100 dark:bg-slate-950 p-3 font-mono text-[11px] overflow-x-auto">
            {JSON.stringify(selectedItem.summary, null, 2)}
          </pre>
        </div>
      )}

      <ConfirmDialog
        open={confirmClear}
        title="Clear All Processing History?"
        description="This will permanently delete all local operation records and reset dashboard statistics. Your processed files on disk will not be deleted."
        confirmLabel="Clear History"
        variant="danger"
        onConfirm={handleClearHistory}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
};

