import React, { useState, useRef } from "react";
import {
  Database,
  Upload,
  Trash2,
  Save,
  Download,
  ShieldCheck,
  Edit3,
  Loader2,
  ArrowRightLeft,
} from "lucide-react";
import { api } from "../services/api";
import type {
  MetadataCleanResponse,
  MetadataField,
  MetadataInspectResponse,
} from "../types/originclean";
import { downloadBase64File, downloadTextFile, fileToBase64 } from "../utils/formatters";
import { ConfirmDialog } from "../components/ConfirmDialog";

interface MetadataManagerPageProps {
  onCompleteOperation: () => void;
  onNotify: (type: "success" | "error" | "info", title: string, message?: string) => void;
}

export const MetadataManagerPage: React.FC<MetadataManagerPageProps> = ({
  onCompleteOperation,
  onNotify,
}) => {
  const [fileBase64, setFileBase64] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [metaInfo, setMetaInfo] = useState<MetadataInspectResponse | null>(null);
  const [preservedKeys, setPreservedKeys] = useState<Record<string, boolean>>({});
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [newFieldKey, setNewFieldKey] = useState("title");
  const [newFieldValue, setNewFieldValue] = useState("");
  const [preserveC2pa, setPreserveC2pa] = useState(true);
  const [showC2paModal, setShowC2paModal] = useState(false);
  const [diffResult, setDiffResult] = useState<MetadataCleanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadFile = async (file: File) => {
    setLoading(true);
    setDiffResult(null);
    try {
      const b64 = await fileToBase64(file);
      setFileBase64(b64);
      setFileName(file.name);
      const res = await api.inspectMetadata({ file: b64, name: file.name });
      setMetaInfo(res);
      const initialEdits: Record<string, string> = {};
      res.fields.forEach((f) => {
        if (f.editable) initialEdits[f.key] = f.value;
      });
      setEditValues(initialEdits);
      setPreservedKeys({});
      onNotify("info", `Loaded metadata for ${file.name}`);
    } catch (err) {
      onNotify("error", "Metadata inspection failed", err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleStripMetadata = async (mode: "all_removable" | "ai_only") => {
    if (!fileBase64 || !fileName) return;
    setLoading(true);
    try {
      const preserveList = Object.entries(preservedKeys)
        .filter(([, keep]) => keep)
        .map(([k]) => k);
      const res = await api.cleanMetadata({
        file: fileBase64,
        name: fileName,
        mode,
        preserve_keys: preserveList,
        preserve_c2pa: preserveC2pa,
        allow_c2pa_removal: !preserveC2pa,
      });
      setDiffResult(res);
      setFileBase64(res.cleaned);
      setMetaInfo((prev) => (prev ? { ...prev, fields: res.after_fields } : prev));
      onCompleteOperation();
      onNotify("success", `Removed ${res.removed_fields.length} metadata field(s)`);
    } catch (err) {
      onNotify("error", "Metadata removal failed", err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleApplyEdits = async () => {
    if (!fileBase64 || !fileName) return;
    const updates = { ...editValues };
    if (newFieldKey.trim() && newFieldValue.trim()) {
      updates[newFieldKey.trim()] = newFieldValue.trim();
    }
    if (Object.keys(updates).length === 0) return;

    setLoading(true);
    try {
      const res = await api.editMetadata({
        file: fileBase64,
        name: fileName,
        updates,
        preserve_c2pa: preserveC2pa,
        allow_c2pa_removal: !preserveC2pa,
      });
      setFileBase64(res.edited);
      setMetaInfo(res.after_metadata);
      setNewFieldValue("");
      onCompleteOperation();
      downloadBase64File(res.edited, res.output_filename);
      onNotify("success", `Updated metadata & exported ${res.output_filename}`);
    } catch (err) {
      onNotify("error", "Metadata edit failed", err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const exportMetadataReport = () => {
    if (!metaInfo) return;
    downloadTextFile(
      JSON.stringify({ current: metaInfo, comparison: diffResult }, null, 2),
      `${fileName}.metadata-report.json`,
      "application/json"
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Metadata Manager</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Inspect, preserve, edit, and compare metadata across Images (EXIF/IPTC/XMP/GPS), Documents (PDF/OOXML/ODT/EPUB), Audio (ID3/FLAC/WAV/M4A), and Video (MP4/MOV).
          </p>
        </div>
        {metaInfo && (
          <button
            type="button"
            onClick={exportMetadataReport}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export Metadata Report</span>
          </button>
        )}
      </div>

      {/* File Loader */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) loadFile(f);
        }}
        className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 text-center hover:border-purple-500 transition-colors"
      >
        {loading ? (
          <Loader2 className="h-7 w-7 animate-spin text-purple-500 mb-2" />
        ) : (
          <Database className="h-7 w-7 text-purple-500 mb-2" />
        )}
        <p className="text-xs font-semibold">
          {fileName ? `Active File: ${fileName} (${metaInfo?.format.toUpperCase()})` : "Drop or browse a file to inspect and manage its metadata"}
        </p>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) loadFile(f);
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-purple-700"
        >
          <Upload className="h-3.5 w-3.5" />
          <span>Select File</span>
        </button>
      </div>

      {metaInfo && (
        <div className="space-y-6">
          {/* Action Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={preserveC2pa}
                onChange={(e) => {
                  if (!e.target.checked) setShowC2paModal(true);
                  else setPreserveC2pa(true);
                }}
                className="rounded border-slate-300 text-emerald-600"
              />
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              <span>Preserve C2PA & Digital Authenticity Records</span>
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={loading}
                onClick={() => handleStripMetadata("ai_only")}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <Trash2 className="h-3.5 w-3.5 text-amber-500" />
                <span>Remove AI Metadata Only</span>
              </button>

              <button
                type="button"
                disabled={loading}
                onClick={() => handleStripMetadata("all_removable")}
                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Remove All Unchecked Metadata</span>
              </button>

              {diffResult && (
                <button
                  type="button"
                  onClick={() => downloadBase64File(diffResult.cleaned, diffResult.output_filename)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Download Cleaned File</span>
                </button>
              )}
            </div>
          </div>

          {/* Metadata Table & Editor */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
              <h2 className="text-sm font-semibold">
                Detected Metadata Fields ({metaInfo.fields.length})
              </h2>
              {metaInfo.fields.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-400">
                  No removable or editable metadata tags found in this file.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-400">
                        <th className="pb-2 font-medium">Preserve</th>
                        <th className="pb-2 font-medium">Category</th>
                        <th className="pb-2 font-medium">Field</th>
                        <th className="pb-2 font-medium">Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                      {metaInfo.fields.map((field: MetadataField) => (
                        <tr key={field.key}>
                          <td className="py-2.5">
                            <input
                              type="checkbox"
                              disabled={!field.removable || (field.is_provenance && preserveC2pa)}
                              checked={
                                field.is_provenance && preserveC2pa
                                  ? true
                                  : Boolean(preservedKeys[field.key])
                              }
                              onChange={(e) =>
                                setPreservedKeys((prev) => ({
                                  ...prev,
                                  [field.key]: e.target.checked,
                                }))
                              }
                              className="rounded border-slate-300 text-emerald-600"
                            />
                          </td>
                          <td className="py-2.5">
                            <span className="rounded bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-mono">
                              {field.category}
                            </span>
                          </td>
                          <td className="py-2.5 font-medium">{field.label}</td>
                          <td className="py-2.5">
                            {field.editable ? (
                              <input
                                type="text"
                                value={editValues[field.key] ?? field.value}
                                onChange={(e) =>
                                  setEditValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                                }
                                className="w-full rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 py-1 text-xs"
                              />
                            ) : (
                              <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300 break-all">
                                {field.value}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Metadata Field Editor */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Edit3 className="h-4 w-4 text-purple-500" />
                <span>Edit Metadata Fields</span>
              </h2>
              {!metaInfo.supports_editing ? (
                <p className="text-xs text-slate-500">
                  Direct tag editing is not supported for format{" "}
                  <code className="font-mono">{metaInfo.format}</code>. Metadata stripping remains available.
                </p>
              ) : (
                <div className="space-y-3 text-xs">
                  <p className="text-slate-500">
                    Add or modify standard metadata tags for <code className="font-mono">{metaInfo.format.toUpperCase()}</code>:
                  </p>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Tag Name</label>
                    <select
                      value={newFieldKey}
                      onChange={(e) => setNewFieldKey(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5 text-xs"
                    >
                      <option value="title">Title (title / INAM / TIT2)</option>
                      <option value="creator">Author / Creator (creator / IART / TPE1)</option>
                      <option value="description">Description / Comment (description / ICMT)</option>
                      <option value="subject">Subject / Album (subject / TALB)</option>
                      <option value="copyright">Copyright (copyright / ICOP)</option>
                      <option value="software">Software (software / ISFT / TSSE)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">New Value</label>
                    <input
                      type="text"
                      value={newFieldValue}
                      onChange={(e) => setNewFieldValue(e.target.value)}
                      placeholder="Enter tag value..."
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5 text-xs"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={handleApplyEdits}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-purple-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-purple-700"
                  >
                    <Save className="h-3.5 w-3.5" />
                    <span>Save & Export Edited File</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Before vs After Comparison */}
          {diffResult && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <ArrowRightLeft className="h-4 w-4 text-emerald-500" />
                <span>Metadata Comparison (Before vs After)</span>
              </h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 text-xs">
                <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3">
                  <div className="font-semibold text-rose-600 dark:text-rose-400 mb-2">
                    Removed Fields ({diffResult.removed_fields.length})
                  </div>
                  {diffResult.removed_fields.length === 0 ? (
                    <p className="text-slate-400">None</p>
                  ) : (
                    <ul className="space-y-1 font-mono text-[11px]">
                      {diffResult.removed_fields.map((f) => (
                        <li key={f.key}>
                          - [{f.category}] {f.label}: {f.value}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                  <div className="font-semibold text-emerald-600 dark:text-emerald-400 mb-2">
                    Retained / Protected Fields ({diffResult.after_fields.length})
                  </div>
                  {diffResult.after_fields.length === 0 ? (
                    <p className="text-slate-400">All removable metadata stripped cleanly.</p>
                  ) : (
                    <ul className="space-y-1 font-mono text-[11px]">
                      {diffResult.after_fields.map((f) => (
                        <li key={f.key}>
                          + [{f.category}] {f.label}: {f.value}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={showC2paModal}
        title="Remove C2PA Authenticity Provenance?"
        description="C2PA Content Credentials verify the origin and edit history of a file. Removing C2PA manifests invalidates digital provenance. Confirm if you are authorized to strip C2PA data from this file."
        confirmLabel="Authorize Removal"
        cancelLabel="Preserve C2PA"
        variant="warning"
        onConfirm={() => {
          setPreserveC2pa(false);
          setShowC2paModal(false);
        }}
        onCancel={() => {
          setPreserveC2pa(true);
          setShowC2paModal(false);
        }}
      />
    </div>
  );
};

