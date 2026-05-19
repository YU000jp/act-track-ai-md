import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRoot } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DASHBOARD_BOOTSTRAP_TIMEOUT_MS,
  formatDuration,
  getRestartRequiredKeys,
  parseIntegerInput,
} from "../../src/frontend/dashboard/helpers";
import type { DashboardClient } from "../../src/frontend/dashboard/tauri-bridge";
import { useDashboardController } from "../../src/frontend/dashboard/useDashboardController";
import { useSummaryController } from "../../src/frontend/dashboard/useSummaryController";
import { DEFAULT_SETTINGS, type ActivitySample, type AppSettings, type ClassificationRuleRecord, type DailySummary, type DashboardBootstrapSnapshot, type MemoryRecord, type MemorySnapshot, type MemoryStatus, type TrackingStatus } from "../../src/shared/types";

const dashboardIndexPath = resolve(process.cwd(), "src/frontend/dashboard/index.html");
const dashboardAppPath = resolve(process.cwd(), "src/frontend/dashboard/app.tsx");

const BASE_SETTINGS: AppSettings = {
  geminiApiKeyConfigured: true,
  dashboardBootstrapTimeoutMs: 5000,
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

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
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
    classificationRules: [
      {
        id: 1,
        priority: 1,
        processNamePattern: "code",
        windowTitlePattern: "index.ts - VSCode",
        category: "productive",
        label: "Coding",
        enabled: true,
        scope: "both",
        source: "manual",
        hitCount: 3,
        lastUsedAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ],
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
    getTimeline: vi.fn(async () => {
      const samples: ActivitySample[] = [
        {
          id: 1,
          timestamp: Date.now(),
          processName: "code",
          windowTitle: "index.ts - VSCode",
          durationMs: 5_000,
          category: "productive",
          label: "Coding",
        },
      ];

      return samples;
    }),
    getDailySummary: vi.fn(async () => summary),
    getSettings: vi.fn(async () => DEFAULT_SETTINGS),
    getTrackingStatus: vi.fn(async (): Promise<TrackingStatus> => ({ running: false, state: "paused" })),
    getDashboardBootstrap: vi.fn(async () => bootstrap),
    getClassificationRules: vi.fn(async () => bootstrap.classificationRules),
    saveClassificationRule: vi.fn(async ({ rule }): Promise<ClassificationRuleRecord> => ({
      id: 2,
      priority: 2,
      processNamePattern: rule.processNamePattern,
      windowTitlePattern: rule.windowTitlePattern,
      category: rule.category,
      label: rule.label,
      enabled: rule.enabled,
      scope: rule.scope,
      source: "manual",
      hitCount: 0,
      lastUsedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })),
    deleteClassificationRule: vi.fn(async () => undefined),
    setClassificationRuleEnabled: vi.fn(async ({ id, enabled }): Promise<ClassificationRuleRecord> => ({
      id,
      priority: 1,
      processNamePattern: "code",
      windowTitlePattern: "index.ts - VSCode",
      category: "productive",
      label: "Coding",
      enabled,
      scope: "both",
      source: "manual",
      hitCount: 4,
      lastUsedAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })),
    moveClassificationRule: vi.fn(async ({ id, direction }): Promise<ClassificationRuleRecord> => ({
      id,
      priority: direction === "up" ? 2 : 1,
      processNamePattern: "code",
      windowTitlePattern: "index.ts - VSCode",
      category: "productive",
      label: "Coding",
      enabled: true,
      scope: "both",
      source: "manual",
      hitCount: 4,
      lastUsedAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })),
    reorderClassificationRule: vi.fn(async ({ id, targetId, placement }): Promise<ClassificationRuleRecord> => ({
      id,
      priority: placement === "before" ? 2 : 1,
      processNamePattern: "code",
      windowTitlePattern: "index.ts - VSCode",
      category: "productive",
      label: `Coding ${targetId}`,
      enabled: true,
      scope: "both",
      source: "manual",
      hitCount: 4,
      lastUsedAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })),
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
    expect(parsedDocument.querySelector("#panel-classification")).toBeNull();
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
    controller.setActiveTab("memory");
    expect(controller.activeTab()).toBe("memory");

    await flushMicrotasks();
    await flushPromises();
    expect(controller.recentWindows()).toHaveLength(1);
    expect(controller.recentWindows()[0]?.windowTitle).toBe("index.ts - VSCode");
    expect(controller.classification.rules()).toHaveLength(1);
    expect(controller.classification.sourceOptions()).toEqual(["manual"]);
    expect(controller.classification.filteredRules()).toHaveLength(1);

    controller.classification.setSearchQuery("code");
    expect(controller.classification.filteredRules()).toHaveLength(1);
    controller.classification.setEnabledFilter("disabled");
    expect(controller.classification.filteredRules()).toHaveLength(0);
    controller.classification.resetFilters();
    controller.classification.setScopeFilter("both");
    controller.classification.setSourceFilter("manual");
    expect(controller.classification.filteredRules()).toHaveLength(1);

    controller.classification.beginCreateRuleFromWindow(controller.recentWindows()[0] as ActivitySample);
    expect(controller.classification.draft().processNamePattern).toBe("code");
    expect(controller.classification.draft().windowTitlePattern).toBe("");
    expect(controller.classification.draft().scope).toBe("process");
    expect(controller.classification.hasDuplicateDraft()).toBe(false);
    expect(controller.classification.duplicateSuggestions()).toHaveLength(0);
    expect(controller.classification.titleScopeSuggestion()).toBe(null);
    controller.classification.updateDraft("windowTitlePattern", "GitHub");
    expect(controller.classification.titleScopeSuggestion()).toBe("both");

    await controller.classification.duplicateRule(controller.classification.rules()[0] as ClassificationRuleRecord);
    expect(rpc.saveClassificationRule).toHaveBeenCalledTimes(1);
    expect(controller.classification.rules()).toHaveLength(2);

    await controller.classification.reorderRule(
      controller.classification.rules()[1] as ClassificationRuleRecord,
      controller.classification.rules()[0] as ClassificationRuleRecord,
      "before",
    );
    expect(rpc.reorderClassificationRule).toHaveBeenCalledTimes(1);

    await controller.classification.moveRule(controller.classification.rules()[0] as ClassificationRuleRecord, "down");
    expect(rpc.moveClassificationRule).toHaveBeenCalledTimes(1);

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

    await controller.toggleTracking();
    expect(rpc.toggleTracking).toHaveBeenCalledTimes(1);

    await flushMicrotasks();
    requestGeminiSettings?.();
    expect(controller.activeTab()).toBe("settings");

    disposeRoot?.();
  });

  it("renders a header toggle for tracking and prevents duplicate clicks while pending", async () => {
    const appSource = readFileSync(dashboardAppPath, "utf8");

    expect(appSource).toContain("tracking-toggle-btn");
    expect(appSource).toContain("Pause tracking");
    expect(appSource).toContain("Resume tracking");
    expect(appSource).toContain("aria-busy={isTrackingTogglePending()}");
  });

  it("falls back to staged dashboard data when bootstrap times out", async () => {
    vi.useFakeTimers();
    try {
      const fallbackSummary: DailySummary = {
        date: "2026-05-19",
        totalTrackedMs: 12_000,
        productiveMs: 9_000,
        distractionMs: 2_000,
        neutralMs: 1_000,
        topApps: [{ processName: "code", durationMs: 8_000, category: "productive" }],
        aiSummary: null,
      };
      const rpc: DashboardClient = {
        ...createDashboardRpcStub(),
        getDashboardBootstrap: vi.fn(() => new Promise<DashboardBootstrapSnapshot>(() => undefined)),
        getTodaySummary: vi.fn(async () => ({
          trackedMs: fallbackSummary.totalTrackedMs,
          productiveMs: fallbackSummary.productiveMs,
          distractionMs: fallbackSummary.distractionMs,
          neutralMs: fallbackSummary.neutralMs,
        })),
        getTopApps: vi.fn(async () => fallbackSummary.topApps),
        getSettings: vi.fn(async () => ({
          ...BASE_SETTINGS,
          markdownExportPath: "/tmp/fallback",
          geminiApiKeyConfigured: false,
        })),
        getClassificationRules: vi.fn(async () => []),
        getTrackingStatus: vi.fn(async (): Promise<TrackingStatus> => ({ running: true, state: "productive" })),
        getMemorySnapshot: vi.fn(async (): Promise<MemorySnapshot> => ({
          memoryStatus: {
            enabled: true,
            backend: "sqlite",
            total: 2,
            pinned: 1,
          },
          memoryRecords: [
            {
              id: 7,
              type: "pattern",
              content: "Fallback memory",
              metadata: {},
              pinned: true,
              createdAt: Date.now(),
            },
          ],
        })),
        getStatisticsSnapshot: vi.fn(async () => ({
          rangeDays: 7,
          startDate: "2026-05-13",
          endDate: "2026-05-19",
          trackedMs: fallbackSummary.totalTrackedMs,
          productiveMs: fallbackSummary.productiveMs,
          distractionMs: fallbackSummary.distractionMs,
          neutralMs: fallbackSummary.neutralMs,
          activeDays: 1,
          dailyBreakdown: [
            {
              date: "2026-05-19",
              trackedMs: fallbackSummary.totalTrackedMs,
              productiveMs: fallbackSummary.productiveMs,
              distractionMs: fallbackSummary.distractionMs,
              neutralMs: fallbackSummary.neutralMs,
            },
          ],
          topApps: fallbackSummary.topApps,
        })),
      };

      let disposeRoot: (() => void) | undefined;
      const controller = createRoot((dispose) => {
        disposeRoot = dispose;
        return useDashboardController({
          rpc,
        });
      });

      expect(controller.isHydrated()).toBe(false);

      await vi.advanceTimersByTimeAsync(DASHBOARD_BOOTSTRAP_TIMEOUT_MS + 1);
      await flushPromises();

      expect(controller.isHydrated()).toBe(true);
      expect(controller.errorState()).not.toBeNull();
      expect(controller.todayStats().trackedMs).toBe(fallbackSummary.totalTrackedMs);
      expect(controller.topApps()[0]?.processName).toBe("code");
      expect(controller.settings().markdownExportPath).toBe("/tmp/fallback");
      expect(controller.trackingStatus().running).toBe(true);
      expect(controller.memoryStatus()?.total).toBe(2);
      expect(controller.memoryRecords()).toHaveLength(1);

      disposeRoot?.();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps summary generation successful when memory refresh is blocked", async () => {
    const rpc = createDashboardRpcStub();
    const reportError = vi.fn();
    const pushToast = vi.fn();
    const memoryController = {
      refreshMemorySnapshot: vi.fn(async () => {
        throw new Error("get_memory_snapshot not allowed. Command not found");
      }),
    };

    let disposeRoot: (() => void) | undefined;
    const controller = createRoot((dispose) => {
      disposeRoot = dispose;
      return useSummaryController({
        rpc,
        memoryController,
        reportError,
        pushToast,
      });
    });

    await controller.generateSummaryNow();

    expect(reportError).not.toHaveBeenCalled();
    expect(controller.summaryFeedbackStatus()).toBe("Summary generated and exported.");
    expect(rpc.generateSummaryNow).toHaveBeenCalledTimes(1);
    expect(memoryController.refreshMemorySnapshot).toHaveBeenCalledTimes(1);
    expect(pushToast).toHaveBeenCalledTimes(1);

    disposeRoot?.();
  });
});
