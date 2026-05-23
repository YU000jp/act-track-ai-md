import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const releaseAssetsDir = resolve(repoRoot, "release-assets");
// Cargo can place Tauri output under the workspace target or a custom target dir.
const cargoTargetDirs = [
  process.env.CARGO_TARGET_DIR ? resolve(process.env.CARGO_TARGET_DIR) : null,
  resolve(repoRoot, "target"),
  resolve(repoRoot, "src-tauri", "target"),
].filter(Boolean);

function getExistingBundleRoot() {
  for (const cargoTargetDir of cargoTargetDirs) {
    const bundleRoot = resolve(cargoTargetDir, "release", "bundle");
    if (existsSync(bundleRoot)) {
      return bundleRoot;
    }
  }

  return null;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    const display = [command, ...args].join(" ");
    throw new Error(`Build step failed: ${display}`);
  }
}

function collectReleaseArtifacts() {
  const tauriBundleRoot = getExistingBundleRoot();
  if (!tauriBundleRoot) {
    const searched = cargoTargetDirs.map((dir) => resolve(dir, "release", "bundle")).join(", ");
    throw new Error(`Release bundle directory was not found. Checked: ${searched}`);
  }

  if (existsSync(releaseAssetsDir)) {
    rmSync(releaseAssetsDir, { recursive: true, force: true });
  }

  mkdirSync(releaseAssetsDir, { recursive: true });

  const allowedExtensions = new Set([".exe", ".msi", ".zip"]);
  const stack = [tauriBundleRoot];
  const artifacts = [];

  // Tauri emits platform-specific bundles under nested directories, so we normalize
  // the distributable files into a single release-assets folder for release publishing.
  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) {
      continue;
    }

    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (allowedExtensions.has(extname(fullPath))) {
        artifacts.push(fullPath);
      }
    }
  }

  const uniqueArtifacts = [...new Set(artifacts)].sort();
  if (uniqueArtifacts.length === 0) {
    throw new Error(`No packaged release artifacts were found under ${tauriBundleRoot}`);
  }

  for (const artifact of uniqueArtifacts) {
    copyFileSync(artifact, join(releaseAssetsDir, basename(artifact)));
  }

  return uniqueArtifacts;
}

run("pnpm", ["run", "tauri:build"]);

const artifacts = collectReleaseArtifacts();
console.log("");
console.log("Release artifacts:");
for (const artifact of artifacts) {
  console.log(`- ${artifact}`);
}
