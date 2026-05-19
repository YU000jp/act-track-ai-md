import { cleanupDevFrontend } from "./cleanup-dev-frontend.mjs";

cleanupDevFrontend();

await import("./dev-frontend.mjs");
