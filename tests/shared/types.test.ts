import { describe, expect, it } from "vitest";
import {
  ACTIVITY_CATEGORIES,
  type ActivityCategory,
  type ActivityLogEntry,
  type ActivityLogQuery,
  type ActivitySample,
  type BrowserVisit,
  type ClassificationResult,
  type DailySummary,
  type StatisticsSnapshot,
  type WindowSnapshot,
} from "../../src/shared/types";

describe("shared types", () => {
  it("defines all activity categories", () => {
    const vals: ActivityCategory[] = ["productive", "distraction", "neutral", "unknown"];
    expect(vals).toEqual([...ACTIVITY_CATEGORIES]);
  });

  it("ActivitySample has required fields", () => {
    const sample: ActivitySample = {
      id: 1,
      timestamp: Date.now(),
      processName: "code.exe",
      windowTitle: "index.ts - VSCode",
      durationMs: 5000,
      category: "productive",
      label: "Coding",
    };
    expect(sample.processName).toBe("code.exe");
    expect(sample.category).toBe("productive");
  });

  it("ClassificationResult has source field", () => {
    const result: ClassificationResult = {
      category: "distraction",
      label: "Social Media",
      confidence: 0.95,
      source: "gemini",
    };
    expect(result.source).toBe("gemini");
  });

  it("WindowSnapshot is minimal", () => {
    const snap: WindowSnapshot = {
      processName: "chrome.exe",
      windowTitle: "YouTube",
    };
    expect(snap.processName).toBe("chrome.exe");
  });

  it("BrowserVisit models browser history rows", () => {
    const visit: BrowserVisit = {
      browser: "firefox",
      profile: "Default",
      url: "https://example.com/path?q=1",
      title: "Example",
      visitedAt: 1_700_000_000_000,
      lastVisitAt: 1_700_000_010_000,
      source: "history-db",
    };

    expect(visit.browser).toBe("firefox");
    expect(visit.source).toBe("history-db");
  });

  it("ActivityLogEntry represents unified activity rows", () => {
    const entry: ActivityLogEntry = {
      id: "activity:1",
      timestamp: 1_700_000_000_000,
      source: "foreground",
      origin: "activity-log",
      appName: "code.exe",
      title: "index.ts - VSCode",
      category: "productive",
      label: "Coding",
      durationMs: 5_000,
      browser: null,
      profile: null,
      url: null,
    };

    const query: ActivityLogQuery = {
      date: "2026-05-19",
      source: "foreground",
      app: "code",
      category: "productive",
      browser: "",
      limit: 50,
    };

    expect(entry.source).toBe("foreground");
    expect(query.date).toBe("2026-05-19");
  });

  it("DailySummary has all aggregate fields", () => {
    const summary: DailySummary = {
      date: "2026-02-22",
      totalTrackedMs: 28800000,
      productiveMs: 21600000,
      distractionMs: 5400000,
      neutralMs: 1800000,
      topApps: [{ processName: "code.exe", durationMs: 14400000, category: "productive" }],
      aiSummary: "Good day.",
    };
    expect(summary.date).toBe("2026-02-22");
    expect(summary.topApps.length).toBe(1);
  });

  it("StatisticsSnapshot models range-based aggregates", () => {
    const snapshot: StatisticsSnapshot = {
      rangeDays: 7,
      startDate: "2026-05-13",
      endDate: "2026-05-19",
      trackedMs: 144000000,
      productiveMs: 96000000,
      distractionMs: 24000000,
      neutralMs: 24000000,
      activeDays: 6,
      dailyBreakdown: [
        {
          date: "2026-05-13",
          trackedMs: 21600000,
          productiveMs: 14400000,
          distractionMs: 3600000,
          neutralMs: 3600000,
        },
      ],
      topApps: [{ processName: "code.exe", durationMs: 72000000, category: "productive" }],
    };

    expect(snapshot.rangeDays).toBe(7);
    expect(snapshot.dailyBreakdown[0].date).toBe("2026-05-13");
  });

  it("default settings include advanced customization fields", async () => {
    const mod = await import("../../src/shared/types");
    expect(mod.DEFAULT_SETTINGS.dashboardBootstrapTimeoutMs).toBe(5000);
    expect(mod.DEFAULT_SETTINGS.summaryLanguage).toBe("Japanese");
    expect(mod.DEFAULT_SETTINGS.summaryTone).toBe("encouraging");
    expect(mod.DEFAULT_SETTINGS.markdownPrivacyMode).toBe(false);
    expect(mod.DEFAULT_SETTINGS.startInBackground).toBe(true);
    expect(mod.DEFAULT_SETTINGS.browserHistoryEnabled).toBe(false);
    expect(mod.DEFAULT_SETTINGS.browserHistoryPollIntervalMs).toBe(15000);
    expect(mod.DEFAULT_SETTINGS.browserHistoryRedactQuery).toBe(true);
    expect(mod.DEFAULT_SETTINGS.geminiApiKeyConfigured).toBe(false);
  });
});
