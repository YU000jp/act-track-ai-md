import { createClassifier } from "./classifier";
import { createDatastores, type Datastores } from "./db";
import { classifyWithGemini } from "./gemini";
import { createMarkdownExporter } from "./md-exporter";
import { createNotifierPolicy } from "./notifier";
import { createSummarizer } from "./summarizer";
import { createWindowsFFIBindings, isIdle, type TrackerBindings } from "./tracker";
import type { ActivityCategory } from "../shared/types";

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

function parseNumberSetting(value: string | null, fallback: number): number {
  if (value === null) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
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

  const apiKeyFromSettings = datastores.getSetting("geminiApiKey");
  const apiKey = apiKeyFromSettings || process.env.GEMINI_API_KEY || "";

  const pollIntervalMs = parseNumberSetting(datastores.getSetting("pollIntervalMs"), 3_000);
  const idleTimeoutMs = parseNumberSetting(datastores.getSetting("idleTimeoutMs"), 300_000);
  const graceMs = parseNumberSetting(datastores.getSetting("gracePeriodMs"), 30_000);
  const cooldownMs = parseNumberSetting(datastores.getSetting("notificationCooldownMs"), 300_000);

  const electrobun = loadElectrobun();

  const app = createApp({
    tracker: createWindowsFFIBindings(),
    datastores,
    apiKey,
    pollIntervalMs,
    idleTimeoutMs,
    graceMs,
    cooldownMs,
    notify: (title, body) => {
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

  const summarizer = createSummarizer({ datastores, apiKey });
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

    const previousDayDate = new Date(`${today}T00:00:00Z`);
    previousDayDate.setUTCDate(previousDayDate.getUTCDate() - 1);
    const previousDay = previousDayDate.toISOString().slice(0, 10);

    void runDailyExport(previousDay);
    lastSeenDay = today;
  }, 60_000);
}
