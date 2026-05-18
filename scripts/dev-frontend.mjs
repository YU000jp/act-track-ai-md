import { createServer } from "node:http";
import { watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import {
  buildDashboard,
  dashboardDevUrl,
  dashboardDevHost,
  dashboardDevPort,
  developmentOutputRoot,
  getContentType,
  injectReloadClient,
  projectRoot,
  resolveDashboardOutputPath,
} from "./frontend-core.mjs";

const reloadClients = new Set();

function broadcastReload() {
  for (const response of reloadClients) {
    response.write("event: reload\n");
    response.write("data: reload\n\n");
  }
}

function createReloadStream(response) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });
  response.write("retry: 1000\n\n");
  reloadClients.add(response);

  response.on("close", () => {
    reloadClients.delete(response);
  });
}

async function serveDashboardAsset(response, outputPath) {
  if (!outputPath) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  try {
    const data = await readFile(outputPath);
    response.writeHead(200, {
      "Content-Type": getContentType(outputPath),
      "Cache-Control": "no-store",
    });
    response.end(data);
  } catch (error) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(error instanceof Error ? error.message : "Not found");
  }
}

async function serveDashboardIndex(response, outputPath) {
  try {
    const html = await readFile(outputPath, "utf8");
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(injectReloadClient(html));
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(error instanceof Error ? error.message : "Unable to load dashboard");
  }
}

async function rebuildDashboard() {
  try {
    await buildDashboard(developmentOutputRoot, { sourcemap: "inline" });
    broadcastReload();
    console.log(`[dev-frontend] rebuilt dashboard at ${new Date().toISOString()}`);
  } catch (error) {
    console.error("[dev-frontend] rebuild failed", error);
  }
}

function createDashboardWatcher() {
  let scheduled = false;
  let timer = null;
  const sourceRoot = resolve(projectRoot, "src");

  const scheduleRebuild = () => {
    if (timer) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      timer = null;
      scheduled = false;
      void rebuildDashboard();
    }, 120);
  };

  const watcher = watch(
    sourceRoot,
    {
      recursive: true,
    },
    () => {
      if (!scheduled) {
        scheduled = true;
        scheduleRebuild();
      }
    },
  );

  return () => {
    watcher.close();
    if (timer) {
      clearTimeout(timer);
    }
  };
}

async function main() {
  await buildDashboard(developmentOutputRoot, { sourcemap: "inline" });

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", dashboardDevUrl);

    if (url.pathname === "/__dev_reload") {
      createReloadStream(response);
      return;
    }

    const outputPath = resolveDashboardOutputPath(developmentOutputRoot, url.pathname);

    if (!outputPath) {
      response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Forbidden");
      return;
    }

    if (extname(outputPath) === ".html") {
      await serveDashboardIndex(response, outputPath);
      return;
    }

    await serveDashboardAsset(response, outputPath);
  });

  const closeWatcher = createDashboardWatcher();

  server.listen(dashboardDevPort, dashboardDevHost, () => {
    console.log(`[dev-frontend] serving ${dashboardDevUrl}`);
  });

  const shutdown = () => {
    closeWatcher();
    server.close();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
