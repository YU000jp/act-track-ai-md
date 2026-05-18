import { copyFile, mkdir } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { build } from "esbuild";

export const projectRoot = resolve(import.meta.dirname, "..");
export const sourceRoot = resolve(projectRoot, "src");
export const dashboardRoot = resolve(sourceRoot, "frontend", "dashboard");
export const dashboardAssetRoot = resolve(sourceRoot, "frontend", "assets");
export const productionOutputRoot = resolve(projectRoot, "src-tauri", "dist", "dashboard");
export const developmentOutputRoot = resolve(projectRoot, "src-tauri", "dist", "dashboard-dev");
export const dashboardDevHost = "127.0.0.1";
export const dashboardDevPort = 1420;
export const dashboardDevUrl = `http://${dashboardDevHost}:${dashboardDevPort}`;

const commonBuildOptions = {
  entryPoints: [resolve(dashboardRoot, "main.tsx")],
  bundle: true,
  target: "chrome120",
  format: "esm",
  splitting: false,
  minify: false,
  platform: "browser",
  loader: {
    ".ts": "ts",
    ".tsx": "tsx",
  },
  jsx: "automatic",
  jsxImportSource: "solid-js/h",
  tsconfigRaw: {
    compilerOptions: {
      jsx: "preserve",
      jsxImportSource: "solid-js/h",
    },
  },
};

export function createBuildOptions(outdir, { sourcemap = false } = {}) {
  return {
    ...commonBuildOptions,
    outdir,
    sourcemap,
  };
}

export async function buildDashboard(outdir, options = {}) {
  await mkdir(outdir, { recursive: true });
  await build(createBuildOptions(outdir, options));
  await copyDashboardAssets(outdir);
}

export async function copyDashboardAssets(outdir) {
  await mkdir(outdir, { recursive: true });

  const assets = [
    [resolve(dashboardRoot, "index.html"), resolve(outdir, "index.html")],
    [resolve(dashboardRoot, "style.css"), resolve(outdir, "style.css")],
    [resolve(dashboardAssetRoot, "icon.png"), resolve(outdir, "icon.png")],
  ];

  for (const [source, target] of assets) {
    await copyFile(source, target);
  }
}

export function injectReloadClient(html) {
  const reloadClient = `<script>
(() => {
  const connect = () => {
    const source = new EventSource("/__dev_reload");
    source.addEventListener("reload", () => {
      source.close();
      window.location.reload();
    });
    source.onerror = () => {
      source.close();
      window.setTimeout(connect, 1000);
    };
  };

  connect();
})();
</script>`;

  if (html.includes("</body>")) {
    return html.replace("</body>", `${reloadClient}\n</body>`);
  }

  return `${html}\n${reloadClient}`;
}

export function resolveDashboardOutputPath(outputRoot, requestPath) {
  const normalizedPath = requestPath === "/" ? "/index.html" : requestPath;
  const resolvedPath = resolve(outputRoot, `.${normalizedPath}`);

  if (!resolvedPath.startsWith(outputRoot + sep)) {
    return null;
  }

  return resolvedPath;
}

export function getContentType(fileName) {
  switch (extname(fileName)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}
