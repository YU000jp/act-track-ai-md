import { createClassifier } from "./classifier";
import { createDatastores, type Datastores } from "./db";
import { classifyWithGemini } from "./gemini";
import { createMarkdownExporter } from "./md-exporter";
import { createNotifierPolicy } from "./notifier";
import { createSummarizer } from "./summarizer";
import { createWindowsFFIBindings, isIdle, type TrackerBindings } from "./tracker";
import { loadAppSettings } from "../shared/settings";
import type { ActivityCategory } from "../shared/types";
import { createMemoryStore } from "../lib/memory";

type GeminiClassifyFn = (opts: {
  apiKey: string;
  processName: string;
  windowTitle: string;
}) => Promise<{ category: ActivityCategory; label: string; confidence: number }>;

export type AppDeps = {
  tracker: TrackerBindings;
  datastores: Datastores;
  apiKey: string;
  pollIntervalMs: number;
  idleTimeoutMs: number;
  graceMs: number;
  cooldownMs: number;
  notify: (title: string, body: string) => void;
  now: () => number;
  selfProcessName?: string;
  geminiClassify?: GeminiClassifyFn;
};

export type App = {
  start: () => void;
  stop: () => void;
  isRunning: () => boolean;
  tick: () => Promise<void>;
};

type PreviousSample = {
  id: number;
  timestamp: number;
  processName: string;
  windowTitle: string;
};

export function createApp(deps: AppDeps): App {
  const classifier = createClassifier({
    datastores: deps.datastores,
    geminiClassify: deps.geminiClassify ?? classifyWithGemini,
    apiKey: deps.apiKey,
  });

  const notifier = createNotifierPolicy({
    notify: deps.notify,
    now: deps.now,
    graceMs: deps.graceMs,
    cooldownMs: deps.cooldownMs,
  });

  let previousSample: PreviousSample | null = null;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  async function tick() {
    const snapshot = deps.tracker.getForegroundWindow();
    if (!snapshot) {
      return;
    }

    if (isIdle(deps.tracker.getIdleMs(), deps.idleTimeoutMs)) {
      return;
    }

    const classification = await classifier.classify(snapshot.processName, snapshot.windowTitle);
    const timestamp = deps.now();

    if (
      previousSample &&
      (previousSample.processName !== snapshot.processName ||
        previousSample.windowTitle !== snapshot.windowTitle)
    ) {
      const durationMs = Math.max(0, timestamp - previousSample.timestamp);
      deps.datastores.setActivityDuration(previousSample.id, durationMs);
    }

    const id = deps.datastores.insertActivitySample({
      timestamp,
      processName: snapshot.processName,
      windowTitle: snapshot.windowTitle,
      category: classification.category,
      label: classification.label,
    });

    previousSample = {
      id,
      timestamp,
      processName: snapshot.processName,
      windowTitle: snapshot.windowTitle,
    };

    notifier.onSample({
      category: classification.category,
      processName: snapshot.processName,
      windowTitle: snapshot.windowTitle,
    });
  }

  function start() {
    if (intervalId) {
      return;
    }

    intervalId = setInterval(() => {
      void tick();
    }, deps.pollIntervalMs);
  }

  function stop() {
    if (!intervalId) {
      return;
    }

    clearInterval(intervalId);
    intervalId = null;
  }

  function isRunning() {
    return intervalId !== null;
  }

  return {
    start,
    stop,
    isRunning,
    tick,
  };
}

type ElectrobunLike = {
  Utils?: {
    showNotification?: (opts: { title: string; body: string }) => void;
  };
};

function loadElectrobun(): ElectrobunLike | null {
  try {
    const maybeGlobal = globalThis as { require?: (moduleId: string) => unknown };
    if (!maybeGlobal.require) {
      return null;
    }

    const mod = maybeGlobal.require("electrobun");
    if (typeof mod !== "object" || mod === null) {
      return null;
    }

    return mod as ElectrobunLike;
  } catch {
    return null;
  }
}

export function startApp(): void {
  const datastores = createDatastores("act-track-cache.db", "act-track-activity.db");
  const memoryStore = createMemoryStore({ dbPath: "act-track-memory.db" });
  void memoryStore.initialize();
  const settings = loadAppSettings((key) => datastores.getSetting(key));
  const apiKey = settings.geminiApiKey || process.env.GEMINI_API_KEY || "";

  const electrobun = loadElectrobun();

  const app = createApp({
    tracker: createWindowsFFIBindings(),
    datastores,
    apiKey,
    pollIntervalMs: settings.pollIntervalMs,
    idleTimeoutMs: settings.idleTimeoutMs,
    graceMs: settings.gracePeriodMs,
    cooldownMs: settings.notificationCooldownMs,
    notify: (title, body) => {
      if (datastores.getSetting("notificationsEnabled") === "false") {
        return;
      }
      if (electrobun?.Utils?.showNotification) {
        electrobun.Utils.showNotification({ title, body });
        return;
      }
      console.log(`[notification] ${title}: ${body}`);
    },
    now: () => Date.now(),
    selfProcessName: process.title,
  });

  app.start();

  const summarizer = createSummarizer({ datastores, apiKey, memoryStore });
  let lastSeenDay = new Date().toISOString().slice(0, 10);

  const runDailyExport = async (date: string) => {
    try {
      await summarizer.generateDailySummary(date);
      const configuredOutputPath = datastores.getSetting("markdownExportPath");
      const exporter = createMarkdownExporter({
        datastores,
        outputDir: configuredOutputPath,
      });
      await exporter.exportDay(date);
    } catch (error) {
      console.error("[export] Failed to export markdown:", error);
    }
  };

  setInterval(() => {
    const today = new Date().toISOString().slice(0, 10);
    if (today === lastSeenDay) {
      return;
    }

    const previousDay = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

    void runDailyExport(previousDay);
    lastSeenDay = today;
  }, 60_000);
}
