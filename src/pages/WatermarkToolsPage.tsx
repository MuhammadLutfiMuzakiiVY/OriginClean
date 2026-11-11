import React, { useState, useRef } from "react";
import {
  Stamp,
  Upload,
  Sparkles,
  Download,
  AlertCircle,
  CheckCircle2,
  Eye,
  ShieldCheck,
  Loader2,
} from "lucide-react";
import { api } from "../services/api";
import type { BackendCapabilities, CleanResponse, InspectionResponse } from "../types/originclean";
import {
  base64ToUtf8,
  downloadBase64File,
  fileToBase64,
  formatBytes,
  formatDuration,
} from "../utils/formatters";

interface WatermarkToolsPageProps {
  capabilities: BackendCapabilities | null;
  onCompleteOperation: () => void;
  onNotify: (type: "success" | "error" | "info", title: string, message?: string) => void;
}

export const WatermarkToolsPage: React.FC<WatermarkToolsPageProps> = ({
  capabilities,
  onCompleteOperation,
  onNotify,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [originalBase64, setOriginalBase64] = useState<string>("");
  const [inspection, setInspection] = useState<InspectionResponse | null>(null);
  const [cleanedResult, setCleanedResult] = useState<CleanResponse | null>(null);
  const [loadingInspect, setLoadingInspect] = useState(false);
  const [loadingClean, setLoadingClean] = useState(false);
  const [preserveC2pa, setPreserveC2pa] = useState(true);
  const [removeAudioWm, setRemoveAudioWm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleSelectFile = async (file: File) => {
    setSelectedFile(file);
    setCleanedResult(null);
    setLoadingInspect(true);
    try {
      const b64 = await fileToBase64(file);
      setOriginalBase64(b64);
      const insp = await api.inspectFile({
        file: b64,
        name: file.name,
        run_detectors: true,
        record_history: true,
      });
      setInspection(insp);
      onCompleteOperation();
    } catch (err) {
      onNotify("error", "Watermark analysis failed", err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingInspect(false);
    }
  };

  const handleRemoveWatermarks = async () => {
    if (!selectedFile || !originalBase64) return;
    setLoadingClean(true);
    try {
      const res = await api.cleanFile({
        file: originalBase64,
        name: selectedFile.name,
        operation_type: "watermark_remove",
        options: {
          preserve_c2pa: preserveC2pa,
          allow_c2pa_removal: !preserveC2pa,
          also_layer_a_text: true,
          normalize_spaces: true,
          remove_audio_watermark: removeAudioWm,
        },
      });
      setCleanedResult(res);
      onCompleteOperation();
      onNotify("success", `Processed watermark removal for ${selectedFile.name}`);
    } catch (err) {
      onNotify("error", "Watermark removal failed", err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingClean(false);
    }
  };

  const isImage = inspection?.kind === "image";
  const isText = inspection?.kind === "text";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Watermark Tools</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Inspect supported files for watermark patterns, preview original vs processed results, and remove supported watermarks honestly without simulation.
        </p>
      </div>

      {/* Honest Scope & Capability Banner */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-xs space-y-2">
        <div className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-200">
          <AlertCircle className="h-4 w-4 text-sky-500 shrink-0" />
          <span>Detection vs Removal Scope & Limitations</span>
        </div>
        <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
          • <strong>Deterministic Removal (Supported Out-of-the-Box):</strong> Invisible Unicode Layer A carriers (zero-width spaces, variation selectors, Bidi controls, space homoglyphs) in text/documents, and AI/generator metadata chunks in PNG, JPEG, WebP, AVIF, HEIC, BMP, GIF, TIFF, PDF, OOXML, ODT, EPUB, SVG, HTML, Markdown, MP4, MOV, WAV, MP3, and FLAC.
          <br />• <strong>Statistical & Pixel Watermarks:</strong> Statistical text detectors (Gumbel/Stylometry) and pixel/audio purifiers are reported transparently. Pixel-level diffusion purification requires optional local GPU backends (
          <code className="font-mono">
            ctrlregen: {capabilities?.pixel_backends.ctrlregen ? "available" : "not configured"}
          </code>
          ,{" "}
          <code className="font-mono">
            diffusion: {capabilities?.pixel_backends.diffusion ? "available" : "not configured"}
          </code>
          ). Respect copyright and file ownership before modifying any file.
        </p>
      </div>

      {/* File Upload & Action Controls */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) handleSelectFile(f);
          }}
          className="lg:col-span-2 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 text-center hover:border-amber-500 transition-colors"
        >
          <Stamp className="h-7 w-7 text-amber-500 mb-2" />
          <p className="text-xs font-semibold">
            {selectedFile ? `Loaded: ${selectedFile.name} (${formatBytes(selectedFile.size)})` : "Select or drop a file to detect and remove supported watermarks"}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleSelectFile(f);
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
          >
            <Upload className="h-3.5 w-3.5" />
            <span>Select File</span>
          </button>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3.5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Removal Parameters
          </h2>

          <label className="flex items-start gap-2.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={preserveC2pa}
              onChange={(e) => setPreserveC2pa(e.target.checked)}
              className="mt-0.5 rounded border-slate-300 text-emerald-600"
            />
            <div>
              <span className="font-semibold flex items-center gap-1">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                Preserve C2PA Authenticity
              </span>
              <span className="block text-[11px] text-slate-500">
                Keep C2PA manifests intact while removing AI generator tags.
              </span>
            </div>
          </label>

          {inspection?.kind === "av" && (
            <label className="flex items-start gap-2.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={removeAudioWm}
                onChange={(e) => setRemoveAudioWm(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-emerald-600"
              />
              <div>
                <span className="font-medium">FFmpeg Acoustic Watermark Chain</span>
                <span className="block text-[11px] text-slate-500">
                  Applies micro pitch/tempo shift if FFmpeg is installed ({capabilities?.tools.ffmpeg ? "Ready" : "Unavailable"}).
                </span>
              </div>
            </label>
          )}

          <button
            type="button"
            disabled={!inspection || loadingClean || loadingInspect}
            onClick={handleRemoveWatermarks}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            {loadingClean ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            <span>Remove Supported Watermarks</span>
          </button>
        </div>
      </div>

      {/* Detection Results & Preview */}
      {inspection && (
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
            <h3 className="text-sm font-semibold">
              Watermark Detection Report — {inspection.file_name} ({inspection.detected_format.toUpperCase()})
            </h3>
            {inspection.watermark_indicators.length === 0 ? (
              <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
                <span>No watermark patterns or AI provenance markers detected in this file.</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {inspection.watermark_indicators.map((ind, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs"
                  >
                    <div>
                      <span className="font-semibold block">{ind.type}</span>
                      <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300">
                        {ind.label} {ind.count ? `(×${ind.count})` : ""}
                      </span>
                    </div>
                    <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                      {ind.removable ? "Removable" : "Detection Only"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Side-by-Side Original vs Processed Preview */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Eye className="h-4 w-4 text-sky-500" />
                  <span>Original File Preview</span>
                </h3>
                <span className="font-mono text-xs text-slate-500">{formatBytes(inspection.file_size)}</span>
              </div>

              {isImage && originalBase64 && (
                <div className="flex items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-950 p-4 max-h-64 overflow-hidden">
                  <img
                    src={`data:${inspection.mime_type};base64,${originalBase64}`}
                    alt="Original preview"
                    className="max-h-56 object-contain rounded"
                  />
                </div>
              )}

              {isText && originalBase64 && (
                <pre className="max-h-56 overflow-auto rounded-lg bg-slate-100 dark:bg-slate-950 p-3 font-mono text-[11px] whitespace-pre-wrap">
                  {base64ToUtf8(originalBase64).slice(0, 2000)}
                </pre>
              )}

              {!isImage && !isText && (
                <div className="rounded-lg bg-slate-50 dark:bg-slate-950 p-4 text-xs font-mono space-y-1">
                  <div>Format: {inspection.detected_format.toUpperCase()}</div>
                  <div>SHA-256: {inspection.signatures.sha256.slice(0, 32)}…</div>
                  <div>Metadata Fields: {inspection.metadata.fields.length}</div>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-emerald-500" />
                  <span>Processed Result Preview</span>
                </h3>
                {cleanedResult && (
                  <button
                    type="button"
                    onClick={() =>
                      downloadBase64File(
                        cleanedResult.cleaned,
                        cleanedResult.output_filename,
                        inspection.mime_type
                      )
                    }
                    className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Export Result</span>
                  </button>
                )}
              </div>

              {!cleanedResult ? (
                <p className="py-12 text-center text-xs text-slate-400">
                  Click "Remove Supported Watermarks" to process and preview the cleaned output.
                </p>
              ) : (
                <div className="space-y-3">
                  {isImage && (
                    <div className="flex items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-950 p-4 max-h-64 overflow-hidden">
                      <img
                        src={`data:${inspection.mime_type};base64,${cleanedResult.cleaned}`}
                        alt="Processed preview"
                        className="max-h-56 object-contain rounded"
                      />
                    </div>
                  )}

                  {isText && (
                    <pre className="max-h-56 overflow-auto rounded-lg bg-slate-100 dark:bg-slate-950 p-3 font-mono text-[11px] whitespace-pre-wrap">
                      {base64ToUtf8(cleanedResult.cleaned).slice(0, 2000)}
                    </pre>
                  )}

                  <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-3 text-xs space-y-1">
                    <div className="font-semibold text-emerald-700 dark:text-emerald-300">
                      Processed in {formatDuration(cleanedResult.duration_ms)} ·{" "}
                      {formatBytes(cleanedResult.bytes_in)} → {formatBytes(cleanedResult.bytes_out)}
                    </div>
                    <ul className="list-disc pl-4 text-[11px] text-slate-600 dark:text-slate-300">
                      {(cleanedResult.report.actions || []).map((act, i) => (
                        <li key={i}>{act}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

