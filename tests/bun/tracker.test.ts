import { describe, expect, it } from "bun:test";
import {
  normalizeSnapshot,
  type RawWindowData,
} from "../../src/bun/tracker";

describe("tracker normalization", () => {
  it("normalizes process name to lowercase", () => {
    const raw: RawWindowData = { processPath: "C:\\Program Files\\Code.exe", windowTitle: "index.ts" };
    const snap = normalizeSnapshot(raw);
    expect(snap!.processName).toBe("code.exe");
  });

  it("extracts filename from full path", () => {
    const raw: RawWindowData = { processPath: "C:\\Users\\irdan\\AppData\\Local\\Programs\\chrome.exe", windowTitle: "Google" };
    const snap = normalizeSnapshot(raw);
    expect(snap!.processName).toBe("chrome.exe");
  });

  it("returns null when no foreground window", () => {
    const snap = normalizeSnapshot(null);
    expect(snap).toBeNull();
  });

  it("returns null for empty title and empty process", () => {
    const raw: RawWindowData = { processPath: "", windowTitle: "" };
    const snap = normalizeSnapshot(raw);
    expect(snap).toBeNull();
  });

  it("trims whitespace from title", () => {
    const raw: RawWindowData = { processPath: "notepad.exe", windowTitle: "  Untitled  " };
    const snap = normalizeSnapshot(raw);
    expect(snap!.windowTitle).toBe("Untitled");
  });

  it("truncates very long titles to 200 chars", () => {
    const longTitle = "A".repeat(300);
    const raw: RawWindowData = { processPath: "app.exe", windowTitle: longTitle };
    const snap = normalizeSnapshot(raw);
    expect(snap!.windowTitle.length).toBe(200);
  });

  it("identifies self process as ignored", () => {
    const raw: RawWindowData = { processPath: "C:\\ActTrackAI\\bun.exe", windowTitle: "ActTrack AI" };
    const snap = normalizeSnapshot(raw, "bun.exe");
    expect(snap).toBeNull();
  });

  it("handles forward-slash paths", () => {
    const raw: RawWindowData = { processPath: "/usr/bin/firefox", windowTitle: "Mozilla" };
    const snap = normalizeSnapshot(raw);
    expect(snap!.processName).toBe("firefox");
  });
});

describe("idle detection", () => {
  it("reports idle when last input exceeds timeout", async () => {
    const { isIdle } = await import("../../src/bun/tracker");
    expect(isIdle(310_000, 300_000)).toBe(true);
  });

  it("reports active when last input within timeout", async () => {
    const { isIdle } = await import("../../src/bun/tracker");
    expect(isIdle(100_000, 300_000)).toBe(false);
  });
});
