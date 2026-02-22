import { describe, expect, it } from "bun:test";
import {
  ACTIVITY_CATEGORIES,
  type ActivityCategory,
  type ActivitySample,
  type ClassificationResult,
  type DailySummary,
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
});
