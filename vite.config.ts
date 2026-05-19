import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const dashboardRoot = resolve(projectRoot, "src/frontend/dashboard");
const dashboardDistRoot = resolve(projectRoot, "src-tauri/dist/dashboard");
const tauriDevHost = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [solidPlugin()],
  root: dashboardRoot,
  base: "./",
  cacheDir: resolve(projectRoot, "node_modules/.vite-dashboard"),
  clearScreen: false,
  server: {
    host: tauriDevHost || "127.0.0.1",
    port: 1420,
    strictPort: true,
    fs: {
      allow: [projectRoot],
    },
    hmr: tauriDevHost
      ? {
          host: tauriDevHost,
          port: 1420,
          protocol: "ws",
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    outDir: dashboardDistRoot,
    emptyOutDir: true,
  },
});
