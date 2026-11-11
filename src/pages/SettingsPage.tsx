import React, { useState } from "react";
import { Save, RotateCcw, RefreshCw, ShieldCheck } from "lucide-react";
import type { AppSettings, BackendCapabilities } from "../types/originclean";
import { ConfirmDialog } from "../components/ConfirmDialog";

interface SettingsPageProps {
  settings: AppSettings;
  appVersion: string;
  capabilities: BackendCapabilities | null;
  onSaveSettings: (patch: Partial<AppSettings>) => Promise<void>;
  onResetSettings: () => Promise<void>;
  onCheckStatus: () => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  settings,
  appVersion,
  capabilities,
  onSaveSettings,
  onResetSettings,
  onCheckStatus,
}) => {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [confirmReset, setConfirmReset] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSaveSettings(draft);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Settings</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Configure theme, processing defaults, concurrency limits, and local-first privacy policies.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-500/10"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Reset Defaults</span>
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            <Save className="h-3.5 w-3.5" />
            <span>Save Preferences</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* General Settings */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4 text-xs">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            General Preferences
          </h2>

          <div>
            <label className="block font-medium mb-1">Application Theme</label>
            <select
              value={draft.theme}
              onChange={(e) =>
                setDraft((d) => ({ ...d, theme: e.target.value as AppSettings["theme"] }))
              }
              className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2"
            >
              <option value="system">System Theme (Auto)</option>
              <option value="light">Light Mode</option>
              <option value="dark">Dark Mode</option>
            </select>
          </div>

          <div>
            <label className="block font-medium mb-1">Interface Language</label>
            <select
              value={draft.language}
              onChange={(e) =>
                setDraft((d) => ({ ...d, language: e.target.value as AppSettings["language"] }))
              }
              className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2"
            >
              <option value="en">English</option>
              <option value="id">Bahasa Indonesia</option>
            </select>
          </div>

          <div>
            <label className="block font-medium mb-1">Default Output Directory</label>
            <input
              type="text"
              value={draft.default_output_dir}
              onChange={(e) => setDraft((d) => ({ ...d, default_output_dir: e.target.value }))}
              placeholder="Leave blank to export alongside original file (.originclean)"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2"
            />
          </div>
        </div>

        {/* Processing Defaults */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4 text-xs">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Processing & Safety Limits
          </h2>

          <label className="flex items-center justify-between cursor-pointer">
            <span>Preserve C2PA Authenticity Provenance by Default</span>
            <input
              type="checkbox"
              checked={draft.preserve_c2pa_by_default}
              onChange={(e) =>
                setDraft((d) => ({ ...d, preserve_c2pa_by_default: e.target.checked }))
              }
              className="rounded border-slate-300 text-emerald-600"
            />
          </label>

          <label className="flex items-center justify-between cursor-pointer">
            <span>Keep Non-AI Metadata by Default</span>
            <input
              type="checkbox"
              checked={draft.keep_non_ai_metadata}
              onChange={(e) =>
                setDraft((d) => ({ ...d, keep_non_ai_metadata: e.target.checked }))
              }
              className="rounded border-slate-300 text-emerald-600"
            />
          </label>

          <label className="flex items-center justify-between cursor-pointer">
            <span>Automatic .bak Backup on Local In-Place Operations</span>
            <input
              type="checkbox"
              checked={draft.automatic_backup}
              onChange={(e) => setDraft((d) => ({ ...d, automatic_backup: e.target.checked }))}
              className="rounded border-slate-300 text-emerald-600"
            />
          </label>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <label className="block font-medium mb-1">Batch Concurrency (1–8)</label>
              <input
                type="number"
                min={1}
                max={8}
                value={draft.batch_concurrency}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, batch_concurrency: Number(e.target.value) }))
                }
                className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-1.5"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Max File Size Limit (MB)</label>
              <input
                type="number"
                min={1}
                max={256}
                value={draft.max_file_size_mb}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, max_file_size_mb: Number(e.target.value) }))
                }
                className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-1.5"
              />
            </div>
          </div>
        </div>

        {/* Privacy & Security */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4 text-xs">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            <span>Privacy & Security</span>
          </h2>

          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <span className="font-semibold block">Strict Local-First Processing Mode</span>
              <span className="text-[11px] text-slate-500">
                All file inspection and cleaning runs locally on your machine.
              </span>
            </div>
            <input
              type="checkbox"
              checked={draft.local_only_mode}
              onChange={(e) => setDraft((d) => ({ ...d, local_only_mode: e.target.checked }))}
              className="rounded border-slate-300 text-emerald-600"
            />
          </label>

          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <span className="font-medium block">Secure Temporary File Cleanup</span>
              <span className="text-[11px] text-slate-500">
                Immediately purges isolated working directories after every operation.
              </span>
            </div>
            <input
              type="checkbox"
              checked={draft.secure_temp_cleanup}
              onChange={(e) => setDraft((d) => ({ ...d, secure_temp_cleanup: e.target.checked }))}
              className="rounded border-slate-300 text-emerald-600"
            />
          </label>
        </div>

        {/* Application & Runtime Info */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 text-xs">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Application & Engine Version
          </h2>
          <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
            <span className="text-slate-500">OriginClean Desktop Version</span>
            <span className="font-mono font-semibold">{appVersion}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
            <span className="text-slate-500">Backend Engine Version</span>
            <span className="font-mono">{capabilities?.version || "1.0.0-local"}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
            <span className="text-slate-500">Publisher</span>
            <span className="font-semibold">Muhammad Lutfi Muzaki</span>
          </div>
          <div className="pt-2">
            <button
              type="button"
              onClick={onCheckStatus}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Verify Engine & Check Status</span>
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmReset}
        title="Reset All Settings to Defaults?"
        description="This will restore OriginClean's default theme, concurrency, and C2PA protection settings."
        confirmLabel="Reset Settings"
        variant="warning"
        onConfirm={async () => {
          setConfirmReset(false);
          await onResetSettings();
        }}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
};

