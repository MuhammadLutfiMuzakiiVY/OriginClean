import type {
  AboutPayload,
  AppSettings,
  CleanOptions,
  CleanResponse,
  DashboardPayload,
  HistoryItem,
  InspectionResponse,
  MetadataCleanResponse,
  MetadataEditResponse,
  MetadataInspectResponse,
} from "../types/originclean";

let cachedBaseUrl = "http://127.0.0.1:8765";

export async function resolveBackendUrl(): Promise<string> {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const url = await invoke<string>("get_backend_url");
      if (url) {
        cachedBaseUrl = url;
      }
    } catch {
      // Fallback to default loopback port
    }
  }
  return cachedBaseUrl;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrl = await resolveBackendUrl();
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!res.ok || data.ok === false) {
    const err = new Error(data.error || `Request failed with status ${res.status}`) as Error & {
      requires_c2pa_confirmation?: boolean;
    };
    if (data.requires_c2pa_confirmation) {
      err.requires_c2pa_confirmation = true;
    }
    throw err;
  }
  return data as T;
}

export const api = {
  getDashboard(): Promise<DashboardPayload> {
    return requestJson<DashboardPayload>("/api/v1/dashboard");
  },

  getAbout(): Promise<AboutPayload> {
    return requestJson<AboutPayload>("/api/v1/about");
  },

  inspectFile(payload: {
    file?: string;
    name: string;
    path?: string;
    run_detectors?: boolean;
    record_history?: boolean;
  }): Promise<InspectionResponse> {
    return requestJson<InspectionResponse>("/api/v1/inspect", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  cleanFile(payload: {
    file?: string;
    name: string;
    path?: string;
    options?: CleanOptions;
    operation_type?: string;
  }): Promise<CleanResponse> {
    return requestJson<CleanResponse>("/api/v1/clean", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  inspectMetadata(payload: { file?: string; name: string; path?: string }): Promise<MetadataInspectResponse> {
    return requestJson<MetadataInspectResponse>("/api/v1/metadata/inspect", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  cleanMetadata(payload: {
    file?: string;
    name: string;
    path?: string;
    mode?: "all_removable" | "ai_only";
    preserve_keys?: string[];
    preserve_c2pa?: boolean;
    allow_c2pa_removal?: boolean;
    output_dir?: string;
  }): Promise<MetadataCleanResponse> {
    return requestJson<MetadataCleanResponse>("/api/v1/metadata/clean", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  editMetadata(payload: {
    file?: string;
    name: string;
    path?: string;
    updates: Record<string, string>;
    preserve_c2pa?: boolean;
    allow_c2pa_removal?: boolean;
    output_dir?: string;
  }): Promise<MetadataEditResponse> {
    return requestJson<MetadataEditResponse>("/api/v1/metadata/edit", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  runBatch(payload: {
    files: Array<{ name: string; file?: string; path?: string; options?: CleanOptions }>;
    concurrency?: number;
    options?: CleanOptions;
  }): Promise<{
    ok: boolean;
    total_files: number;
    succeeded: number;
    failed: number;
    concurrency_used: number;
    total_duration_ms: number;
    results: CleanResponse[];
  }> {
    return requestJson("/api/v1/batch", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  getHistory(params?: {
    search?: string;
    format?: string;
    operation?: string;
    result?: string;
    sort_by?: string;
    sort_dir?: "asc" | "desc";
  }): Promise<{ ok: boolean; items: HistoryItem[]; count: number }> {
    const qs = new URLSearchParams();
    if (params?.search) qs.set("search", params.search);
    if (params?.format) qs.set("format", params.format);
    if (params?.operation) qs.set("operation", params.operation);
    if (params?.result) qs.set("result", params.result);
    if (params?.sort_by) qs.set("sort_by", params.sort_by);
    if (params?.sort_dir) qs.set("sort_dir", params.sort_dir);
    return requestJson(`/api/v1/history?${qs.toString()}`);
  },

  clearHistory(): Promise<{ ok: boolean; deleted: number }> {
    return requestJson("/api/v1/history/clear", { method: "POST", body: "{}" });
  },

  getSettings(): Promise<{ ok: boolean; settings: AppSettings }> {
    return requestJson("/api/v1/settings");
  },

  updateSettings(patch: Partial<AppSettings>): Promise<{ ok: boolean; settings: AppSettings }> {
    return requestJson("/api/v1/settings", {
      method: "POST",
      body: JSON.stringify(patch),
    });
  },

  resetSettings(): Promise<{ ok: boolean; settings: AppSettings }> {
    return requestJson("/api/v1/settings/reset", { method: "POST", body: "{}" });
  },
};

