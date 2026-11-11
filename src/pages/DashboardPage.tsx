import React from "react";
import {
  CheckCircle2,
  XCircle,
  HardDrive,
  Clock,
  Sparkles,
  SearchCode,
  Stamp,
  Database,
  History,
  RefreshCw,
  FileText,
  ShieldCheck,
  Cpu,
} from "lucide-react";
import type { DashboardPayload, NavigationTab } from "../types/originclean";
import { formatBytes, formatDuration } from "../utils/formatters";

interface DashboardPageProps {
  data: DashboardPayload | null;
  loading: boolean;
  onRefresh: () => void;
  onNavigate: (tab: NavigationTab) => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  data,
  loading,
  onRefresh,
  onNavigate,
}) => {
  const stats = data?.stats || {
    total_files_processed: 0,
    successful_files: 0,
    failed_operations: 0,
    warning_operations: 0,
    total_bytes_in: 0,
    total_bytes_removed: 0,
    avg_duration_ms: 0,
    by_format: {},
    by_operation: {},
    recent_activities: [],
    recent_files: [],
  };
  const caps = data?.capabilities;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Real-time local processing telemetry, engine status, and recent file operations.
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          <span>Refresh Telemetry</span>
        </button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Files Processed</span>
            <FileText className="h-4 w-4 text-slate-400" />
          </div>
          <p className="mt-2 text-2xl font-bold" data-testid="stat-total-processed">
            {stats.total_files_processed}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Volume scanned: {formatBytes(stats.total_bytes_in)}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Successfully Processed</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </div>
          <p className="mt-2 text-2xl font-bold text-emerald-600 dark:text-emerald-400" data-testid="stat-successful">
            {stats.successful_files}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Metadata stripped: {formatBytes(stats.total_bytes_removed)}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Failed Operations</span>
            <XCircle className="h-4 w-4 text-rose-500" />
          </div>
          <p className="mt-2 text-2xl font-bold text-rose-600 dark:text-rose-400" data-testid="stat-failed">
            {stats.failed_operations}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Warnings / residual notices: {stats.warning_operations}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Avg Processing Time</span>
            <Clock className="h-4 w-4 text-sky-500" />
          </div>
          <p className="mt-2 text-2xl font-bold">{formatDuration(stats.avg_duration_ms)}</p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            100% local-first execution
          </p>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Quick Actions</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <button
            type="button"
            onClick={() => onNavigate("cleaner")}
            className="flex items-center gap-3 rounded-lg border border-slate-200 dark:border-slate-800 p-3 text-left hover:border-emerald-500/50 hover:bg-emerald-500/5 transition-colors"
          >
            <Sparkles className="h-5 w-5 text-emerald-500 shrink-0" />
            <div>
              <div className="text-xs font-semibold">Select Files</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Clean & export safely</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate("inspector")}
            className="flex items-center gap-3 rounded-lg border border-slate-200 dark:border-slate-800 p-3 text-left hover:border-emerald-500/50 hover:bg-emerald-500/5 transition-colors"
          >
            <SearchCode className="h-5 w-5 text-sky-500 shrink-0" />
            <div>
              <div className="text-xs font-semibold">Inspect File</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Deep signature & C2PA</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate("watermark")}
            className="flex items-center gap-3 rounded-lg border border-slate-200 dark:border-slate-800 p-3 text-left hover:border-emerald-500/50 hover:bg-emerald-500/5 transition-colors"
          >
            <Stamp className="h-5 w-5 text-amber-500 shrink-0" />
            <div>
              <div className="text-xs font-semibold">Remove Watermarks</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Detect & scrub marks</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate("metadata")}
            className="flex items-center gap-3 rounded-lg border border-slate-200 dark:border-slate-800 p-3 text-left hover:border-emerald-500/50 hover:bg-emerald-500/5 transition-colors"
          >
            <Database className="h-5 w-5 text-purple-500 shrink-0" />
            <div>
              <div className="text-xs font-semibold">Manage Metadata</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Edit & strip tags</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate("history")}
            className="flex items-center gap-3 rounded-lg border border-slate-200 dark:border-slate-800 p-3 text-left hover:border-emerald-500/50 hover:bg-emerald-500/5 transition-colors"
          >
            <History className="h-5 w-5 text-slate-500 shrink-0" />
            <div>
              <div className="text-xs font-semibold">Processing History</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Audit local operations</div>
            </div>
          </button>
        </div>
      </div>

      {/* Backend Service Status & Recent Activities */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Cpu className="h-4 w-4 text-emerald-500" />
              <span>Backend Service Status</span>
            </h2>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                data
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-rose-500/10 text-rose-600 dark:text-rose-400"
              }`}
            >
              {data ? "Active" : "Disconnected"}
            </span>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between py-1 border-b border-slate-100 dark:border-slate-800">
              <span className="text-slate-500">Stdlib Multi-Format Engine</span>
              <span className="font-mono text-emerald-600 dark:text-emerald-400">Ready</span>
            </div>
            <div className="flex items-center justify-between py-1 border-b border-slate-100 dark:border-slate-800">
              <span className="text-slate-500">C2PA Provenance Guard</span>
              <span className="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
                <ShieldCheck className="h-3.5 w-3.5" /> Protected
              </span>
            </div>
            <div className="flex items-center justify-between py-1 border-b border-slate-100 dark:border-slate-800">
              <span className="text-slate-500">Stylometry & Layer A Unicode</span>
              <span className="font-mono text-emerald-600 dark:text-emerald-400">Ready</span>
            </div>
            {caps && (
              <div className="pt-2">
                <p className="text-[11px] font-medium text-slate-400 mb-2">Optional System Binaries</p>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(caps.tools).map(([tool, present]) => (
                    <span
                      key={tool}
                      className={`rounded px-2 py-0.5 text-[10px] font-mono ${
                        present
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          : "bg-slate-100 dark:bg-slate-800 text-slate-500"
                      }`}
                    >
                      {tool}: {present ? "detected" : "stdlib fallback"}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {Object.keys(stats.by_format).length > 0 && (
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
              <p className="text-[11px] font-medium text-slate-400 mb-2">Processed Formats Breakdown</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(stats.by_format).map(([fmt, count]) => (
                  <span
                    key={fmt}
                    className="rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-1 text-[11px] font-mono"
                  >
                    .{fmt} ({count})
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Recent Activities & Recent Files */}
        <div className="lg:col-span-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-sky-500" />
              <span>Recent Activities & Files</span>
            </h2>
            {stats.recent_activities.length > 0 && (
              <button
                type="button"
                onClick={() => onNavigate("history")}
                className="text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:underline"
              >
                View Full History →
              </button>
            )}
          </div>

          {stats.recent_activities.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <FileText className="h-8 w-8 text-slate-300 dark:text-slate-700 mb-2" />
              <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                No file operations recorded yet
              </p>
              <p className="mt-1 text-[11px] text-slate-400">
                Select files in File Cleaner or File Inspector to populate real processing statistics.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-400">
                    <th className="pb-2 font-medium">File</th>
                    <th className="pb-2 font-medium">Format</th>
                    <th className="pb-2 font-medium">Operation</th>
                    <th className="pb-2 font-medium">Size</th>
                    <th className="pb-2 font-medium">Duration</th>
                    <th className="pb-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {stats.recent_activities.slice(0, 7).map((act) => (
                    <tr key={act.id}>
                      <td className="py-2.5 font-medium truncate max-w-[180px]" title={act.original_filename}>
                        {act.original_filename}
                      </td>
                      <td className="py-2.5 font-mono uppercase text-[11px] text-slate-500">
                        {act.file_format}
                      </td>
                      <td className="py-2.5 capitalize text-slate-600 dark:text-slate-300">
                        {act.operation_type.replace("_", " ")}
                      </td>
                      <td className="py-2.5 font-mono text-[11px] text-slate-500">
                        {formatBytes(act.bytes_in)}
                      </td>
                      <td className="py-2.5 font-mono text-[11px] text-slate-500">
                        {formatDuration(act.processing_duration_ms)}
                      </td>
                      <td className="py-2.5">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            act.processing_result === "success"
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              : act.processing_result === "warning"
                              ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                              : "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                          }`}
                        >
                          {act.processing_result}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

