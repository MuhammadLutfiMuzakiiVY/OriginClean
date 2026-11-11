# Security Policy — OriginClean

## Supported Versions

Security updates target the latest release of **OriginClean** (`v1.0.x`) on the `main` branch.

| Version | Supported |
| ------- | --------- |
| `1.0.x` | Yes       |

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

Please report vulnerabilities privately via **[GitHub Security Advisories](https://github.com/MuhammadLutfiMuzakiiVY/OriginClean/security/advisories/new)** on the repository Security tab.

Include:
- A clear description of the vulnerability and its impact
- Steps to reproduce or a minimal proof of concept
- Affected version and operating system (Windows, macOS, or Linux)

## Scope

OriginClean is a local-first cross-platform desktop application (Tauri 2 + Rust + React TypeScript + Python). Security reports of highest priority include:
- Path traversal or unauthorized file overwrites outside the user-confirmed destination
- Unintended modification of C2PA provenance manifests without explicit user authorization
- Command injection or parser vulnerabilities when inspecting crafted media/documents
- Unauthorized network requests or data exfiltration from the local-first engine

---
**Maintainer & Publisher:** Muhammad Lutfi Muzaki (`@MuhammadLutfiMuzakiiVY`)
