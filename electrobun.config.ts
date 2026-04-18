import type { ElectrobunConfig } from "electrobun";
import { APP_META } from "./src/shared/app-meta";

export default {
  app: {
    name: APP_META.displayName,
    identifier: APP_META.identifier,
    version: "1.0.0",
  },

  runtime: {
    exitOnLastWindowClosed: false, // tray app — no persistent main window
  },

  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
    },

    views: {
      dashboard: {
        entrypoint: "src/views/dashboard/main.ts",
      },
    },

    copy: {
      "src/views/dashboard/index.html": "views/dashboard/index.html",
      "src/views/dashboard/style.css": "views/dashboard/style.css",
      "src/views/assets/icon.png": "views/assets/icon.png",
    },

    win: {
      bundleCEF: false,
      defaultRenderer: "native",
    },
  },
} satisfies ElectrobunConfig;
