import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const require = createRequire(import.meta.url);
const vitePackageJson = require.resolve("vite/package.json");
const viteBin = resolve(dirname(vitePackageJson), "bin", "vite.js");

// Keep Vite as a direct child so shutdown can clean up the dev server tree.
const child = spawn(process.execPath, [viteBin, ...process.argv.slice(2)], {
  cwd: repoRoot,
  stdio: "inherit",
});

let shuttingDown = false;
let hardKillTimer;

function forceKillChild() {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) {
    return;
  }

  // Windows needs an explicit tree kill when the normal signal path does not land.
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
    });
    return;
  }

  child.kill("SIGKILL");
}

function requestShutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  if (child.exitCode === null && child.signalCode === null) {
    child.kill(signal === "SIGBREAK" ? "SIGTERM" : signal);
    hardKillTimer = setTimeout(forceKillChild, 1500);
    hardKillTimer.unref?.();
  }
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
  process.on(signal, () => requestShutdown(signal));
}

process.on("exit", () => {
  if (hardKillTimer) {
    clearTimeout(hardKillTimer);
  }

  forceKillChild();
});

child.on("exit", (code, signal) => {
  if (hardKillTimer) {
    clearTimeout(hardKillTimer);
  }

  const exitCode = code ?? (signal ? 1 : 0);
  process.exit(exitCode);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
