import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import App from "../App";

const mockDashboard = {
  ok: true,
  app: {
    name: "OriginClean",
    product_name: "OriginClean",
    tagline: "Clean Your Files. Preserve Their Origin.",
    version: "1.0.0",
    identifier: "com.muhammadlutfimuzaki.originclean",
    developer: "Muhammad Lutfi Muzaki",
    creator: "Muhammad Lutfi Muzaki",
    publisher: "Muhammad Lutfi Muzaki",
    author: "Muhammad Lutfi Muzaki",
    copyright: "Copyright © 2026 Muhammad Lutfi Muzaki. All rights reserved.",
    github_owner: "MuhammadLutfiMuzakiiVY",
    repository_name: "OriginClean",
    repository_url: "https://github.com/MuhammadLutfiMuzakiiVY/OriginClean",
    license: "MIT",
    upstream_attribution: "Core inspection and cleaning algorithms adapted from watermarks-remover.",
  },
  capabilities: {
    version: "1.0.0",
    tools: {
      c2patool: false,
      exiftool: false,
      qpdf: false,
      ghostscript: false,
      ffmpeg: true,
    },
    pixel_backends: { ctrlregen: false, diffusion: false },
    scorers: { synthid: false, synthid_http: false, stylometry: true },
    text_detectors: { gumbel: true },
    text_generators: { synthid_http: false, markllm: false },
  },
  stats: {
    total_files_processed: 14,
    successful_files: 13,
    failed_operations: 1,
    warning_operations: 0,
    total_bytes_in: 512000,
    total_bytes_removed: 24800,
    avg_duration_ms: 18.4,
    by_format: { png: 8, docx: 4, txt: 2 },
    by_operation: { clean: 10, inspect: 4 },
    recent_activities: [],
    recent_files: [],
  },
};

const mockSettings = {
  ok: true,
  settings: {
    theme: "system",
    language: "en",
    default_output_dir: "",
    open_output_after_clean: false,
    preserve_c2pa_by_default: true,
    keep_non_ai_metadata: false,
    also_layer_a_text: true,
    normalize_spaces: true,
    nfkc_normalization: false,
    aggressive_homoglyphs: false,
    deep_images: "auto",
    clean_attachments: "always",
    batch_concurrency: 4,
    max_file_size_mb: 256,
    automatic_backup: true,
    secure_temp_cleanup: true,
    local_only_mode: true,
    allow_external_network: false,
    telemetry_enabled: false,
  },
};

const mockAbout = {
  ok: true,
  app: mockDashboard.app,
  capabilities: mockDashboard.capabilities,
  third_party_notices: [
    {
      name: "watermarks-remover",
      author: "Guillaume Meyer and contributors",
      license: "MIT",
      url: "https://github.com/guillaumemeyer/watermarks-remover",
      role: "Core multi-format inspection and metadata/Unicode cleaning algorithms",
    },
  ],
};

describe("OriginClean Desktop GUI", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/v1/dashboard")) {
        return new Response(JSON.stringify(mockDashboard), { status: 200 });
      }
      if (url.includes("/api/v1/settings")) {
        return new Response(JSON.stringify(mockSettings), { status: 200 });
      }
      if (url.includes("/api/v1/about")) {
        return new Response(JSON.stringify(mockAbout), { status: 200 });
      }
      if (url.includes("/api/v1/history")) {
        return new Response(JSON.stringify({ ok: true, items: [], count: 0 }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
  });

  it("renders real telemetry stats from backend and navigates across all 9 modules", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("stat-total-processed")).toHaveTextContent("14");
      expect(screen.getByTestId("stat-successful")).toHaveTextContent("13");
      expect(screen.getByTestId("stat-failed")).toHaveTextContent("1");
    });

    // Navigate to File Cleaner
    fireEvent.click(screen.getByRole("button", { name: /File Cleaner/i }));
    expect(screen.getByText(/Preserve C2PA Provenance/i)).toBeInTheDocument();

    // Navigate to File Inspector
    fireEvent.click(screen.getByRole("button", { name: /File Inspector/i }));
    expect(screen.getByText(/Select File to Inspect/i)).toBeInTheDocument();

    // Navigate to Watermark Tools
    fireEvent.click(screen.getByRole("button", { name: /Watermark Tools/i }));
    expect(screen.getByText(/Detection vs Removal Scope & Limitations/i)).toBeInTheDocument();

    // Navigate to Metadata Manager
    fireEvent.click(screen.getByRole("button", { name: /Metadata Manager/i }));
    expect(
      screen.getByText(/Drop or browse a file to inspect and manage its metadata/i)
    ).toBeInTheDocument();

    // Navigate to Batch Processing
    fireEvent.click(screen.getByRole("button", { name: /Batch Processing/i }));
    expect(screen.getByText(/Worker Concurrency/i)).toBeInTheDocument();

    // Navigate to Processing History
    fireEvent.click(screen.getByRole("button", { name: /Processing History/i }));
    expect(screen.getByPlaceholderText(/Search filename/i)).toBeInTheDocument();

    // Navigate to Settings
    fireEvent.click(screen.getByRole("button", { name: /Settings/i }));
    expect(screen.getByText(/Strict Local-First Processing Mode/i)).toBeInTheDocument();

    // Navigate to About OriginClean and verify developer attribution
    fireEvent.click(screen.getByRole("button", { name: /About OriginClean/i }));
    expect(screen.getAllByText(/Muhammad Lutfi Muzaki/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/com\.muhammadlutfimuzaki\.originclean/i)).toBeInTheDocument();
  });
});

