import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRoot } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatDuration, getRestartRequiredKeys, parseIntegerInput } from "../../src/frontend/dashboard/helpers";
import type { DashboardClient } from "../../src/frontend/dashboard/tauri-bridge";
import { useDashboardController } from "../../src/frontend/dashboard/useDashboardController";
import { DEFAULT_SETTINGS, type AppSettings, type DailySummary, type DashboardBootstrapSnapshot, type MemoryRecord, type MemorySnapshot, type MemoryStatus, type TrackingStatus } from "../../src/shared/types";

const dashboardIndexPath = resolve(process.cwd(), "src/frontend/dashboard/index.html");

const BASE_SETTINGS: AppSettings = {
  geminiApiKeyConfigured: true,
  pollIntervalMs: 3000,
  idleTimeoutMs: 300_000,
  notificationCooldownMs: 300_000,
  gracePeriodMs: 30_000,
  markdownExportPath: "/tmp/act-track-logs",
  notificationsEnabled: true,
  autoStart: true,
  classificationRulesJson: '[{"processNamePattern":"code","category":"productive","label":"Coding"}]',
  summaryLanguage: "Japanese",
  summaryTone: "reflective",
  markdownPrivacyMode: true,
  startInBackground: true,
};

afterEach(() => {
  document.body.innerHTML = "";
});

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function createDashboardRpcStub(): DashboardClient {
  const summary: DailySummary = {
    date: "2026-05-19",
    totalTrackedMs: 7_200_000,
    productiveMs: 4_500_000,
    distractionMs: 1_500_000,
    neutralMs: 1_200_000,
    topApps: [{ processName: "code", durationMs: 3_600_000, category: "productive" }],
    aiSummary: "Draft summary",
  };
  const bootstrap: DashboardBootstrapSnapshot = {
    todaySummary: {
      trackedMs: summary.totalTrackedMs,
      productiveMs: summary.productiveMs,
      distractionMs: summary.distractionMs,
      neutralMs: summary.neutralMs,
    },
    topApps: summary.topApps,
    statisticsSnapshot: {
      rangeDays: 7,
      startDate: "2026-05-13",
      endDate: "2026-05-19",
      trackedMs: summary.totalTrackedMs,
      productiveMs: summary.productiveMs,
      distractionMs: summary.distractionMs,
      neutralMs: summary.neutralMs,
      activeDays: 1,
      dailyBreakdown: [
        {
          date: "2026-05-19",
          trackedMs: summary.totalTrackedMs,
          productiveMs: summary.productiveMs,
          distractionMs: summary.distractionMs,
          neutralMs: summary.neutralMs,
        },
      ],
      topApps: summary.topApps,
    },
    settings: DEFAULT_SETTINGS,
    trackingStatus: { running: false, state: "paused" },
    dailySummary: summary,
    memoryStatus: {
      enabled: true,
      backend: "sqlite",
      total: 1,
      pinned: 0,
    },
    memoryRecords: [
      {
        id: 1,
        type: "feedback",
        content: "Remember to keep the dashboard shell empty.",
        metadata: {},
        pinned: false,
        createdAt: Date.now(),
      },
    ],
  };
  const memorySnapshot: MemorySnapshot = {
    memoryStatus: {
      enabled: true,
      backend: "sqlite",
      total: 1,
      pinned: 0,
    },
    memoryRecords: [
      {
        id: 1,
        type: "feedback",
        content: "Remember to keep the dashboard shell empty.",
        metadata: {},
        pinned: false,
        createdAt: Date.now(),
      },
    ],
  };

  return {
    getTodaySummary: vi.fn(async () => ({
      trackedMs: summary.totalTrackedMs,
      productiveMs: summary.productiveMs,
      distractionMs: summary.distractionMs,
      neutralMs: summary.neutralMs,
    })),
    getTopApps: vi.fn(async () => summary.topApps),
    getStatisticsSnapshot: vi.fn(async (rangeDays: number = 7) => ({
      rangeDays,
      startDate: rangeDays === 14 ? "2026-05-06" : rangeDays === 30 ? "2026-04-20" : "2026-05-13",
      endDate: "2026-05-19",
      trackedMs: summary.totalTrackedMs * (rangeDays / 7),
      productiveMs: summary.productiveMs * (rangeDays / 7),
      distractionMs: summary.distractionMs * (rangeDays / 7),
      neutralMs: summary.neutralMs * (rangeDays / 7),
      activeDays: rangeDays,
      dailyBreakdown: [
        {
          date: "2026-05-19",
          trackedMs: summary.totalTrackedMs,
          productiveMs: summary.productiveMs,
          distractionMs: summary.distractionMs,
          neutralMs: summary.neutralMs,
        },
      ],
      topApps: summary.topApps,
    })),
    getTimeline: vi.fn(async () => []),
    getDailySummary: vi.fn(async () => summary),
    getSettings: vi.fn(async () => DEFAULT_SETTINGS),
    getTrackingStatus: vi.fn(async (): Promise<TrackingStatus> => ({ running: false, state: "paused" })),
    getDashboardBootstrap: vi.fn(async () => bootstrap),
    setSetting: vi.fn(async () => undefined),
    setSettings: vi.fn(async () => undefined),
    getSetting: vi.fn(async () => null),
    generateSummaryNow: vi.fn(async () => ({
      summary,
    })),
    saveSummaryFeedback: vi.fn(async () => undefined),
    getMemoryStatus: vi.fn(async (): Promise<MemoryStatus> => ({
      enabled: true,
      backend: "sqlite",
      total: 1,
      pinned: 0,
    })),
    listMemories: vi.fn(async (): Promise<MemoryRecord[]> => [
      {
        id: 1,
        type: "feedback",
        content: "Remember to keep the dashboard shell empty.",
        metadata: {},
        pinned: false,
        createdAt: Date.now(),
      },
    ]),
    getMemorySnapshot: vi.fn(async () => memorySnapshot),
    forgetMemory: vi.fn(async () => undefined),
    pinMemory: vi.fn(async () => undefined),
    toggleTracking: vi.fn(async () => true),
  };
}

describe("dashboard helpers", () => {
  it("formats durations correctly", () => {
    expect(formatDuration(3_600_000)).toBe("1h 0m");
    expect(formatDuration(45_000)).toBe("0m 45s");
    expect(formatDuration(0)).toBe("0m 0s");
  });

  it("identifies restart-required settings changes", () => {
    expect(
      getRestartRequiredKeys(BASE_SETTINGS, {
        ...BASE_SETTINGS,
        autoStart: false,
        pollIntervalMs: 5_000,
      }),
    ).toEqual(["pollIntervalMs", "autoStart"]);
  });

  it("parses numeric input with bounds", () => {
    expect(parseIntegerInput("5000", 3000, 1000)).toBe(5000);
    expect(parseIntegerInput("abc", 3000, 1000)).toBe(3000);
    expect(parseIntegerInput("500", 3000, 1000)).toBe(3000);
  });
});

describe("dashboard shell", () => {
  it("starts as an empty mount shell", () => {
    const html = readFileSync(dashboardIndexPath, "utf8");
    const parsedDocument = new DOMParser().parseFromString(html, "text/html");
    const root = parsedDocument.getElementById("dashboard-root");

    expect(root).not.toBeNull();
    expect(root?.children).toHaveLength(0);
    expect(parsedDocument.querySelector("#tab-bar")).toBeNull();
    expect(parsedDocument.querySelector("#panel-today")).toBeNull();
    expect(parsedDocument.querySelector("#panel-settings")).toBeNull();
    expect(parsedDocument.querySelector("#summary-feedback")).toBeNull();
  });

  it("routes tab and action handlers through the dashboard controller", async () => {
    const rpc = createDashboardRpcStub();
    let requestGeminiSettings: (() => void) | undefined;
    const subscribeGeminiApiKeySettings = vi.fn(async (listener: () => void) => {
      requestGeminiSettings = listener;
      return () => undefined;
    });
    let disposeRoot: (() => void) | undefined;
    const controller = createRoot((dispose) => {
      disposeRoot = dispose;
      return useDashboardController({
        rpc,
        subscribeGeminiApiKeySettings,
      });
    });

    expect(controller.activeTab()).toBe("today");
    controller.setActiveTab("statistics");
    expect(controller.activeTab()).toBe("statistics");

    await controller.generateSummaryNow();
    expect(rpc.generateSummaryNow).toHaveBeenCalledTimes(1);

    await controller.saveSettings(new Event("submit", { bubbles: true, cancelable: true }) as SubmitEvent);
    expect(rpc.setSettings).toHaveBeenCalledTimes(1);

    await controller.handleMemoryAction("pin", {
      id: 1,
      type: "feedback",
      content: "Remember to keep the dashboard shell empty.",
      metadata: {},
      pinned: false,
      createdAt: Date.now(),
    });
    expect(rpc.pinMemory).toHaveBeenCalledTimes(1);

    await controller.handleMemoryAction("forget", {
      id: 2,
      type: "feedback",
      content: "Remove this memory.",
      metadata: {},
      pinned: true,
      createdAt: Date.now(),
    });
    expect(rpc.forgetMemory).toHaveBeenCalledTimes(1);

    await controller.setRangeWindow(14);
    expect(controller.rangeWindow()).toBe(14);
    expect(rpc.getStatisticsSnapshot).toHaveBeenLastCalledWith(14);

    await flushMicrotasks();
    requestGeminiSettings?.();
    expect(controller.activeTab()).toBe("settings");

    disposeRoot?.();
  });
});
