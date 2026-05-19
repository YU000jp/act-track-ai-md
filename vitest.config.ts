import { defineConfig } from "vitest/config";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
  plugins: [solidPlugin()],
  resolve: {
    alias: [
      { find: /^solid-js\/web$/, replacement: "solid-js/web/dist/web.js" },
      { find: /^solid-js\/web\/dist\/server\.js$/, replacement: "solid-js/web/dist/web.js" },
      { find: /^solid-js$/, replacement: "solid-js/dist/solid.js" },
      { find: /^solid-js\/dist\/server\.js$/, replacement: "solid-js/dist/solid.js" },
    ],
    conditions: ["browser", "development"],
  },
  test: {
    environment: "jsdom",
    server: {
      deps: {
        inline: [/^solid-js/],
      },
    },
  },
});
