import { describe, expect, it, beforeEach } from "bun:test";
import { createDatastores, type Datastores } from "../../src/bun/db";

let stores: Datastores;

beforeEach(() => {
  stores = createDatastores(":memory:", ":memory:");
});

describe("schema creation", () => {
  it("creates classification_cache table", () => {
    const row = stores.cache.query("SELECT name FROM sqlite_master WHERE type='table' AND name='classification_cache'").get();
    expect(row).toBeTruthy();
  });

  it("creates activity_log table", () => {
    const row = stores.activity.query("SELECT name FROM sqlite_master WHERE type='table' AND name='activity_log'").get();
    expect(row).toBeTruthy();
  });

  it("creates daily_summary table", () => {
    const row = stores.activity.query("SELECT name FROM sqlite_master WHERE type='table' AND name='daily_summary'").get();
    expect(row).toBeTruthy();
  });

  it("creates settings table", () => {
    const row = stores.activity.query("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'").get();
    expect(row).toBeTruthy();
  });
});

describe("classification cache", () => {
  it("returns null for unknown entry", () => {
    const result = stores.getCachedClassification("chrome.exe", "Google");
    expect(result).toBeNull();
  });

  it("upserts and retrieves classification", () => {
    stores.upsertCachedClassification("chrome.exe", "YouTube", "distraction", "Video Streaming", 0.95);
    const result = stores.getCachedClassification("chrome.exe", "YouTube");
    expect(result).not.toBeNull();
    expect(result!.category).toBe("distraction");
    expect(result!.label).toBe("Video Streaming");
    expect(result!.confidence).toBe(0.95);
  });

  it("overwrites on duplicate key", () => {
    stores.upsertCachedClassification("chrome.exe", "YouTube", "distraction", "Video", 0.9);
    stores.upsertCachedClassification("chrome.exe", "YouTube", "neutral", "Research", 0.8);
    const result = stores.getCachedClassification("chrome.exe", "YouTube");
    expect(result!.category).toBe("neutral");
  });

  it("returns cache count", () => {
    stores.upsertCachedClassification("a.exe", "A", "productive", "Work", 1);
    stores.upsertCachedClassification("b.exe", "B", "neutral", "Util", 1);
    expect(stores.getCacheCount()).toBe(2);
  });

  it("clears cache", () => {
    stores.upsertCachedClassification("a.exe", "A", "productive", "Work", 1);
    stores.clearCache();
    expect(stores.getCacheCount()).toBe(0);
  });
});

describe("activity log", () => {
  it("inserts and returns activity sample id", () => {
    const id = stores.insertActivitySample({
      timestamp: 1000,
      processName: "code.exe",
      windowTitle: "index.ts",
      category: "productive",
      label: "Coding",
    });
    expect(id).toBeGreaterThan(0);
  });

  it("updates duration on previous sample", () => {
    const id = stores.insertActivitySample({
      timestamp: 1000,
      processName: "code.exe",
      windowTitle: "index.ts",
      category: "productive",
      label: "Coding",
    });
    stores.setActivityDuration(id, 5000);
    const samples = stores.getActivityRange(0, 2000);
    expect(samples[0].durationMs).toBe(5000);
  });

  it("queries activity by time range", () => {
    stores.insertActivitySample({ timestamp: 1000, processName: "a.exe", windowTitle: "A", category: "productive", label: "Work" });
    stores.insertActivitySample({ timestamp: 5000, processName: "b.exe", windowTitle: "B", category: "distraction", label: "Play" });
    stores.insertActivitySample({ timestamp: 9000, processName: "c.exe", windowTitle: "C", category: "neutral", label: "Util" });

    const range = stores.getActivityRange(1000, 6000);
    expect(range.length).toBe(2);
  });
});

describe("today stats", () => {
  it("aggregates duration by category", () => {
    const dayStart = new Date("2026-02-22T00:00:00").getTime();
    stores.insertActivitySample({ timestamp: dayStart + 1000, processName: "code.exe", windowTitle: "A", category: "productive", label: "Coding" });
    stores.setActivityDuration(1, 10000);
    stores.insertActivitySample({ timestamp: dayStart + 11000, processName: "yt.exe", windowTitle: "B", category: "distraction", label: "Video" });
    stores.setActivityDuration(2, 5000);

    const stats = stores.getStatsForDay("2026-02-22");
    expect(stats.productiveMs).toBe(10000);
    expect(stats.distractionMs).toBe(5000);
    expect(stats.totalTrackedMs).toBe(15000);
  });
});

describe("top apps", () => {
  it("returns apps sorted by duration", () => {
    const dayStart = new Date("2026-02-22T00:00:00").getTime();
    stores.insertActivitySample({ timestamp: dayStart + 1000, processName: "code.exe", windowTitle: "A", category: "productive", label: "Coding" });
    stores.setActivityDuration(1, 20000);
    stores.insertActivitySample({ timestamp: dayStart + 21000, processName: "chrome.exe", windowTitle: "B", category: "distraction", label: "Browse" });
    stores.setActivityDuration(2, 5000);

    const apps = stores.getTopAppsForDay("2026-02-22", 10);
    expect(apps.length).toBe(2);
    expect(apps[0].processName).toBe("code.exe");
    expect(apps[0].durationMs).toBe(20000);
  });
});

describe("settings", () => {
  it("returns null for missing key", () => {
    expect(stores.getSetting("nonexistent")).toBeNull();
  });

  it("sets and gets setting", () => {
    stores.setSetting("geminiApiKey", "test-key-123");
    expect(stores.getSetting("geminiApiKey")).toBe("test-key-123");
  });

  it("overwrites existing setting", () => {
    stores.setSetting("pollInterval", "3000");
    stores.setSetting("pollInterval", "5000");
    expect(stores.getSetting("pollInterval")).toBe("5000");
  });
});

describe("daily summary", () => {
  it("saves and retrieves summary", () => {
    stores.saveDailySummary({
      date: "2026-02-22",
      totalTrackedMs: 28800000,
      productiveMs: 21600000,
      distractionMs: 5400000,
      neutralMs: 1800000,
      topApps: [{ processName: "code.exe", durationMs: 14400000, category: "productive" as const }],
      aiSummary: "Great day!",
    });
    const summary = stores.getDailySummary("2026-02-22");
    expect(summary).not.toBeNull();
    expect(summary!.aiSummary).toBe("Great day!");
    expect(summary!.topApps[0].processName).toBe("code.exe");
  });

  it("returns null for missing date", () => {
    expect(stores.getDailySummary("1999-01-01")).toBeNull();
  });
});
