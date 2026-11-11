export type NavigationTab =
  | "dashboard"
  | "cleaner"
  | "inspector"
  | "watermark"
  | "metadata"
  | "batch"
  | "history"
  | "settings"
  | "about";

export type FileKind = "text" | "image" | "container" | "av" | "unknown";

export interface AppMetadata {
  name: string;
  product_name: string;
  tagline: string;
  version: string;
  identifier: string;
  developer: string;
  creator: string;
  publisher: string;
  author: string;
  copyright: string;
  github_owner: string;
  repository_name: string;
  repository_url: string;
  license: string;
  upstream_attribution: string;
}

export interface BackendCapabilities {
  version: string;
  tools: {
    c2patool: boolean;
    exiftool: boolean;
    qpdf: boolean;
    ghostscript: boolean;
    ffmpeg: boolean;
  };
  pixel_backends: {
    ctrlregen: boolean;
    diffusion: boolean;
  };
  scorers: {
    synthid: boolean;
    synthid_http: boolean;
    stylometry: boolean;
  };
  text_detectors: Record<string, boolean>;
  text_generators: {
    synthid_http: boolean;
    markllm: boolean;
  };
}

export interface HistoryItem {
  id: string;
  original_filename: string;
  output_filename: string;
  file_format: string;
  file_kind: string;
  operation_type: string;
  processing_date: string;
  processing_duration_ms: number;
  processing_result: "success" | "warning" | "failed" | "skipped";
  bytes_in: number;
  bytes_out: number;
  c2pa_preserved: boolean;
  error_details: string;
  output_location: string;
  summary: {
    actions?: string[];
    changed?: boolean;
    has_c2pa_before?: boolean;
    c2pa_preserved?: boolean;
    verdict?: boolean;
    has_c2pa?: boolean;
    has_ai_metadata?: boolean;
    indicators_count?: number;
    removed_count?: number;
  };
}

export interface RecentFileSummary {
  filename: string;
  output_filename: string;
  file_format: string;
  file_kind: string;
  last_operation: string;
  last_result: string;
  last_date: string;
  bytes_in: number;
  bytes_out: number;
  output_location: string;
}

export interface DashboardStats {
  total_files_processed: number;
  successful_files: number;
  failed_operations: number;
  warning_operations: number;
  total_bytes_in: number;
  total_bytes_removed: number;
  avg_duration_ms: number;
  by_format: Record<string, number>;
  by_operation: Record<string, number>;
  recent_activities: HistoryItem[];
  recent_files: RecentFileSummary[];
}

export interface DashboardPayload {
  ok: boolean;
  app: AppMetadata;
  capabilities: BackendCapabilities;
  stats: DashboardStats;
}

export interface MetadataField {
  key: string;
  label: string;
  category: string;
  value: string;
  removable: boolean;
  editable: boolean;
  is_provenance: boolean;
}

export interface MetadataInspectResponse {
  ok: boolean;
  filename: string;
  kind: FileKind;
  format: string;
  has_c2pa: boolean;
  has_ai_metadata: boolean;
  supports_editing: boolean;
  fields: MetadataField[];
  categories: string[];
}

export interface EvidenceClass {
  present: boolean;
  strength: string;
  description: string;
  signals: Record<string, unknown>;
}

export interface SuspiciousReport {
  verdict: boolean;
  description: string;
  classes: {
    provenance: EvidenceClass;
    layer_a_unicode: EvidenceClass;
    watermark_detector: EvidenceClass;
    stylometry: EvidenceClass;
  };
}

export interface WatermarkIndicator {
  type: string;
  label: string;
  codepoint?: string;
  count?: number;
  score?: number;
  strength: string;
  removable: boolean;
}

export interface InspectionResponse {
  ok: boolean;
  file_name: string;
  file_path: string | null;
  file_size: number;
  mime_type: string;
  file_extension: string;
  kind: FileKind;
  detected_format: string;
  created_at: string | null;
  modified_at: string | null;
  duration_ms?: number;
  signatures: {
    sha256: string;
    magic_hex: string;
    magic_description: string;
  };
  suspicious: SuspiciousReport;
  provenance: {
    has_c2pa: boolean;
    has_ai_metadata: boolean;
    c2pa_preserved_by_default: boolean;
    tools_probe: Record<string, unknown>;
    notes: string[];
  };
  watermark_indicators: WatermarkIndicator[];
  detections: Array<Record<string, unknown>>;
  metadata: MetadataInspectResponse;
  raw_report: Record<string, unknown>;
}

export interface CleanOptions {
  preserve_c2pa?: boolean;
  allow_c2pa_removal?: boolean;
  keep_non_ai_metadata?: boolean;
  strip_all_metadata?: boolean;
  also_layer_a_text?: boolean;
  normalize_spaces?: boolean;
  nfkc?: boolean;
  aggressive_homoglyphs?: boolean;
  deep_images?: "auto" | "always" | "lossless" | "never";
  clean_attachments?: "auto" | "always" | "never";
  remove_pixel?: "ctrlregen" | "diffusion" | "";
  remove_audio_watermark?: boolean;
  output_dir?: string;
  detect_before?: boolean;
  detect_after?: boolean;
}

export interface CleanResponse {
  ok: boolean;
  operation_id: string | null;
  original_filename: string;
  output_filename: string;
  output_location: string;
  kind: FileKind;
  format: string;
  bytes_in: number;
  bytes_out: number;
  changed: boolean;
  c2pa_preserved: boolean;
  duration_ms: number;
  status: "success" | "warning" | "failed";
  cleaned: string;
  report: {
    actions?: string[];
    findings?: string[];
    post_findings?: string[];
    still_has_c2pa?: boolean;
    still_has_ai_metadata?: boolean;
    stats?: {
      removed_count: number;
      replaced_count: number;
    };
    [key: string]: unknown;
  };
  error?: string;
  requires_c2pa_confirmation?: boolean;
}

export interface MetadataCleanResponse {
  ok: boolean;
  filename: string;
  output_filename: string;
  output_location: string;
  kind: FileKind;
  format: string;
  bytes_in: number;
  bytes_out: number;
  changed: boolean;
  c2pa_preserved: boolean;
  duration_ms: number;
  actions: string[];
  before_fields: MetadataField[];
  after_fields: MetadataField[];
  removed_fields: MetadataField[];
  cleaned: string;
}

export interface MetadataEditResponse {
  ok: boolean;
  filename: string;
  output_filename: string;
  output_location: string;
  actions: string[];
  duration_ms: number;
  after_metadata: MetadataInspectResponse;
  edited: string;
}

export interface AppSettings {
  theme: "light" | "dark" | "system";
  language: "en" | "id";
  default_output_dir: string;
  open_output_after_clean: boolean;
  preserve_c2pa_by_default: boolean;
  keep_non_ai_metadata: boolean;
  also_layer_a_text: boolean;
  normalize_spaces: boolean;
  nfkc_normalization: boolean;
  aggressive_homoglyphs: boolean;
  deep_images: "auto" | "always" | "lossless" | "never";
  clean_attachments: "auto" | "always" | "never";
  batch_concurrency: number;
  max_file_size_mb: number;
  automatic_backup: boolean;
  secure_temp_cleanup: boolean;
  local_only_mode: boolean;
  allow_external_network: boolean;
  telemetry_enabled: boolean;
}

export interface ThirdPartyNotice {
  name: string;
  author: string;
  license: string;
  url: string;
  role: string;
}

export interface AboutPayload {
  ok: boolean;
  app: AppMetadata;
  capabilities: BackendCapabilities;
  third_party_notices: ThirdPartyNotice[];
}

