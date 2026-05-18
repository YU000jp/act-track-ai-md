import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const projectRoot = resolve(import.meta.dirname, "..");
const sourceDir = resolve(projectRoot, "src", "frontend", "dashboard");
const outputDir = resolve(projectRoot, "src-tauri", "dist", "dashboard");

async function main() {
  await mkdir(outputDir, { recursive: true });

  await build({
    entryPoints: [resolve(sourceDir, "main.ts")],
    bundle: true,
    outdir: outputDir,
    target: "chrome120",
    format: "esm",
    splitting: false,
    minify: false,
    sourcemap: false,
    platform: "browser",
  });

  const assets = [
    ["src/frontend/dashboard/index.html", "index.html"],
    ["src/frontend/dashboard/style.css", "style.css"],
    ["src/frontend/assets/icon.png", "icon.png"],
  ];

  for (const [source, target] of assets) {
    await copyFile(resolve(projectRoot, source), resolve(outputDir, target));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
