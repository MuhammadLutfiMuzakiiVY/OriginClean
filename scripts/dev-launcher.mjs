#!/usr/bin/env node
/**
 * Smart development launcher for OriginClean (`npx tauri dev`).
 * - Automatically starts the local Python backend on 127.0.0.1:8765 if not already running.
 * - Starts Vite on port 1420 if free, or reuses an already-running Vite server on port 1420
 *   without failing with "Error: Port 1420 is already in use".
 */
import net from "node:net";
import { spawn } from "node:child_process";

function isPortListening(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(400);
    sock.once("connect", () => {
      sock.destroy();
      resolve(true);
    });
    sock.once("timeout", () => {
      sock.destroy();
      resolve(false);
    });
    sock.once("error", () => {
      sock.destroy();
      resolve(false);
    });
    sock.connect(port, host);
  });
}

async function isPortInUseAnyHost(port) {
  if (await isPortListening(port, "127.0.0.1")) return true;
  if (await isPortListening(port, "::1")) return true;
  if (await isPortListening(port, "localhost")) return true;
  return false;
}

const children = [];
function cleanup() {
  for (const child of children) {
    try {
      child.kill();
    } catch {
      // ignore
    }
  }
}
process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});

async function main() {
  // 1. Ensure Python backend on 127.0.0.1:8765 is running
  const backendActive = await isPortInUseAnyHost(8765);
  if (!backendActive) {
    const pyCmd = process.platform === "win32" ? "python" : "python3";
    const pyChild = spawn(pyCmd, ["backend/service/app_server.py"], {
      stdio: "inherit",
      shell: false,
    });
    pyChild.on("error", () => {
      // Fallback handled by Tauri Rust core if python is on another alias
    });
    children.push(pyChild);
  } else {
    console.log("[OriginClean] Reusing running Python backend on http://127.0.0.1:8765");
  }

  // 2. Ensure Vite dev server on port 1420 is running (or reuse existing one)
  const viteActive = await isPortInUseAnyHost(1420);
  if (viteActive) {
    console.log("[OriginClean] Port 1420 is already active — reusing existing Vite dev server.");
    // Keep process alive so Tauri's beforeDevCommand sees a healthy long-running dev server
    setInterval(() => {}, 60_000);
    return;
  }

  const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
  const viteChild = spawn(npxCmd, ["vite", "--port", "1420"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  children.push(viteChild);
  viteChild.on("exit", (code) => {
    cleanup();
    process.exit(code ?? 0);
  });
}

main();

