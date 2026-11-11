# Contributing to OriginClean

Thank you for contributing to **OriginClean** (*Clean Your Files. Preserve Their Origin.*), created and maintained by **Muhammad Lutfi Muzaki** (`@MuhammadLutfiMuzakiiVY`).

## Development Prerequisites

- **Node.js 20+** and `npm`
- **Python 3.11+** (100% standard library runtime)
- **Rust Stable Toolchain** (`cargo`, `rustc`) for Tauri 2 desktop builds

## Project Layout

| Directory / File | Description |
| --- | --- |
| `src/` | React 18 + TypeScript Strict + Tailwind CSS desktop GUI (9 modules) |
| `src-tauri/` | Tauri 2 + Rust native windowing, IPC commands, and process lifecycle |
| `backend/` | OriginClean Python API (`/api/v1/*`), SQLite persistence, and C2PA-safe metadata manager |
| `service/scripts/` | Core multi-format inspection, watermark detection, and cleaning engine |
| `tests/` & `backend/tests/` | Automated Python regression and integration test suites |
| `.github/workflows/` | Automated CI (`ci.yml`) and multi-OS release bundler (`release.yml`) |

## Running Tests Before Submitting a PR

```bash
# 1. Python backend tests
python -m pytest -v backend/tests/test_originclean_backend.py

# 2. Frontend TypeScript & Vitest suite
npm run test
npm run build

# 3. Rust / Tauri compilation & unit tests
cd src-tauri && cargo test
```

## Core Principles

1. **Preserve Originals by Default**: Never overwrite user files unless explicitly requested; output `.originclean` copies by default.
2. **Preserve C2PA Provenance**: Never strip C2PA / JUMBF authenticity manifests unless explicit authorization is confirmed.
3. **100% Local-First**: All inspection, cleaning, and history logging run locally without external telemetry.
