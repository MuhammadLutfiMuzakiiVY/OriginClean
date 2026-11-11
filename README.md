# OriginClean

> **Clean Your Files. Preserve Their Origin.**

**OriginClean** is a lightweight, privacy-first, cross-platform desktop application for deep file inspection, structured metadata management, and watermark cleaning across images, documents, audio, video, and source/text files.

- **Developer & Creator:** Muhammad Lutfi Muzaki
- **Publisher:** Muhammad Lutfi Muzaki
- **Application Identifier:** `com.muhammadlutfimuzaki.originclean`
- **Repository:** [https://github.com/MuhammadLutfiMuzakiiVY/OriginClean](https://github.com/MuhammadLutfiMuzakiiVY/OriginClean)
- **License:** MIT (`Copyright © 2026 Muhammad Lutfi Muzaki. All rights reserved.`)

---

## Key Features

1. **Dashboard & Real-Time Telemetry**
   - Live metrics computed directly from your local SQLite processing history (total files processed, successful operations, failed operations, bytes removed, format breakdown, and engine capability status).
2. **File Cleaner**
   - Drag-and-drop and multi-file queue with automatic format detection, non-destructive `.originclean` export, custom output folder support, and C2PA provenance preservation by default.
3. **File Inspector**
   - Displays SHA-256 digests, magic header bytes, MIME types, filesystem creation/modification dates, C2PA Content Credentials indicators, and a 4-class suspicious evidence breakdown (`Provenance`, `Layer A Unicode`, `Watermark Detector`, `Stylometry`) with one-click JSON report export.
4. **Watermark Tools**
   - Inspects and removes supported deterministic watermarks (invisible Unicode Layer A codepoints, space homoglyphs, and AI generator container chunks) with side-by-side Original vs Processed previews and transparent reporting of optional pixel/audio backends (`SynthID`, `CtrlRegen`, `MarkDiffusion`, `FFmpeg`).
5. **Metadata Manager**
   - Dedicated metadata viewer, selective remover, and tag editor for:
     - **Images:** PNG (`tEXt`/`iTXt`/`zTXt`/`eXIf`/`caBX`), JPEG (`APP1` EXIF/XMP, `APP11` C2PA/JUMBF, `APP13` IPTC, `COM`), WebP, AVIF, HEIC, BMP, GIF, TIFF (EXIF & GPS IFDs).
     - **Documents:** PDF (`/Info`, XMP, `/PieceInfo`, attachments), DOCX, XLSX, PPTX, ODT, EPUB, SVG, HTML, Markdown frontmatter, LaTeX.
     - **Audio:** MP3 (`ID3v2.3`/`v2.4`), FLAC (Vorbis comments & `APPLICATION` blocks), WAV (`LIST/INFO`, `iXML`, `c2pa`), M4A.
     - **Video:** MP4, MOV, M4V (ISOBMFF `moov/udta`, `uuid`, `jumb`/`c2pa`).
6. **Batch Processing**
   - Parallel multi-file processing with configurable worker concurrency (1–8 threads), per-file fault isolation, progress tracking, cancel/retry controls, and batch summary exports.
7. **Processing History**
   - Persistent local SQLite log with search, format/operation/result filtering, sorting, detailed inspection views, and confirmation-guarded history clearing. Never stores copies of your private files.
8. **Privacy & Security First**
   - **100% Local-First Execution:** No automatic external file uploads.
   - **C2PA Authenticity Protection:** Preserves C2PA and cryptographic provenance by default and requires explicit user authorization before modifying provenance records.
   - **Non-Destructive Defaults:** Original files are never overwritten by default.

---

## Technology Stack

- **Desktop Framework:** Tauri 2 + Rust (`src-tauri/`)
- **Frontend GUI:** React 18 + TypeScript (Strict Mode) + Vite + Tailwind CSS + Lucide Icons (`src/`)
- **Backend Engine:** Python 3.11+ (`backend/` + `service/scripts/`) + SQLite (`sqlite3`)
- **Automated Testing:** Vitest + React Testing Library (`src/__tests__/`) & Pytest (`backend/tests/` + `tests/`)
- **CI/CD & Packaging:** GitHub Actions (`.github/workflows/ci.yml` & `.github/workflows/release.yml`)

---

## Supported Operating Systems & Release Packages

| Platform | Architectures | Installer / Package Formats |
|---|---|---|
| **Windows 10 & 11** | `x86_64` | `OriginClean-Setup.exe` (NSIS), `OriginClean.msi` |
| **macOS 11+** | Intel (`x86_64`) & Apple Silicon (`ARM64`) | `OriginClean.dmg`, `OriginClean.app` |
| **Linux** (Ubuntu, Debian, Fedora) | `x86_64` | `OriginClean.AppImage`, `OriginClean.deb`, `OriginClean.rpm` |

---

## Development & Installation Guide

### 1. Start the Local Backend & Frontend in Development Mode

```bash
# 1. Install frontend dependencies
npm install

# 2. Launch both the Python backend (127.0.0.1:8765) and Vite UI (localhost:1420) in one command:
npm run dev:all

# Or launch the native Tauri 2 desktop window directly (automatically starts backend + Vite):
npx tauri dev
```

### 2. Run Automated Tests

```bash
# Run Frontend unit & integration tests (Vitest + React Testing Library)
npm run test

# Run OriginClean Backend test suite (Pytest)
pytest -v backend/tests/test_originclean_backend.py

# Run Rust desktop core tests
cd src-tauri && cargo test
```

### 3. Build Production Desktop Installers

```bash
npm run build
npx tauri build
```

---

## Architecture & Project Structure

```text
OriginClean/
├── src/                      # React + TypeScript Frontend GUI
│   ├── components/           # ConfirmDialog, Toast notifications
│   ├── layouts/              # SidebarLayout with theme switcher & status
│   ├── pages/                # 9 functional application modules
│   ├── services/             # Typed API client (api.ts)
│   ├── types/                # Strict TypeScript interfaces
│   ├── utils/                # Byte/duration formatters & file helpers
│   └── __tests__/            # Vitest + React Testing Library suite
├── src-tauri/                # Tauri 2 + Rust Desktop Core
│   ├── src/                  # Process lifecycle, IPC commands, unit tests
│   ├── capabilities/         # Tauri 2 security capabilities
│   ├── icons/                # Cross-platform app icons (.png, .ico, .icns)
│   ├── tauri.conf.json       # Multi-OS bundler & publisher configuration
│   └── Cargo.toml            # Rust crate & Windows version resource metadata
├── backend/                  # OriginClean Python Desktop Backend
│   ├── inspection/           # Deep signature, SHA-256, MIME & C2PA inspector
│   ├── metadata/             # Multi-format metadata viewer, stripper & editor
│   ├── processing/           # C2PA-safe cleaner & bounded batch engine
│   ├── service/              # HTTP/RPC server & SQLite history/settings DB
│   └── tests/                # Automated backend pytest suite
├── service/scripts/          # Upstream stdlib inspection & cleaning engine
├── docs/                     # Architecture audit & technical documentation
├── .github/workflows/        # Automated CI and multi-OS release pipelines
├── package.json
├── pyproject.toml
├── LICENSE
└── THIRD_PARTY_NOTICES.md
```

---

## Attribution & License

**OriginClean** is developed and published by **Muhammad Lutfi Muzaki**.  
Copyright © 2026 Muhammad Lutfi Muzaki. All rights reserved.

Core multi-format inspection and cleaning algorithms in `service/scripts/` are adapted from [watermarks-remover](https://github.com/guillaumemeyer/watermarks-remover) under the MIT License (`Copyright (c) 2026 Guillaume Meyer and contributors`). See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for full details.
