import { describe, expect, it, beforeEach } from "bun:test";
import { createNotifierPolicy, type NotifierPolicy } from "../../src/bun/notifier";

describe("notifier policy", () => {
  let notifications: string[];
  let currentTime: number;
  let policy: NotifierPolicy;

  beforeEach(() => {
    notifications = [];
    currentTime = 0;
    policy = createNotifierPolicy({
      notify: (title, body) => { notifications.push(`${title}|${body}`); },
      now: () => currentTime,
      graceMs: 30_000,
      cooldownMs: 300_000,
    });
  });

  it("does not notify for productive activity", () => {
    policy.onSample({ category: "productive", processName: "code.exe", windowTitle: "index.ts" });
    expect(notifications.length).toBe(0);
  });

  it("does not notify for neutral activity", () => {
    policy.onSample({ category: "neutral", processName: "explorer.exe", windowTitle: "" });
    expect(notifications.length).toBe(0);
  });

  it("does not notify for unknown activity", () => {
    policy.onSample({ category: "unknown", processName: "new.exe", windowTitle: "Something" });
    expect(notifications.length).toBe(0);
  });

  it("does not notify during grace period", () => {
    currentTime = 0;
    policy.onSample({ category: "distraction", processName: "chrome.exe", windowTitle: "YouTube" });
    currentTime = 15_000;
    policy.onSample({ category: "distraction", processName: "chrome.exe", windowTitle: "YouTube" });
    expect(notifications.length).toBe(0);
  });

  it("notifies after grace period expires", () => {
    currentTime = 0;
    policy.onSample({ category: "distraction", processName: "chrome.exe", windowTitle: "YouTube" });
    currentTime = 31_000;
    policy.onSample({ category: "distraction", processName: "chrome.exe", windowTitle: "YouTube" });
    expect(notifications.length).toBe(1);
  });

  it("suppresses second notification within cooldown", () => {
    currentTime = 0;
    policy.onSample({ category: "distraction", processName: "chrome.exe", windowTitle: "YouTube" });
    currentTime = 31_000;
    policy.onSample({ category: "distraction", processName: "chrome.exe", windowTitle: "YouTube" });
    expect(notifications.length).toBe(1);

    currentTime = 60_000;
    policy.onSample({ category: "distraction", processName: "chrome.exe", windowTitle: "Twitter" });
    expect(notifications.length).toBe(1);
  });

  it("allows notification after cooldown expires", () => {
    currentTime = 0;
    policy.onSample({ category: "distraction", processName: "chrome.exe", windowTitle: "YouTube" });
    currentTime = 31_000;
    policy.onSample({ category: "distraction", processName: "chrome.exe", windowTitle: "YouTube" });
    expect(notifications.length).toBe(1);

    currentTime = 331_001;
    policy.onSample({ category: "distraction", processName: "chrome.exe", windowTitle: "Twitter" });
    currentTime = 362_001;
    policy.onSample({ category: "distraction", processName: "chrome.exe", windowTitle: "Twitter" });
    expect(notifications.length).toBe(2);
  });

  it("resets grace period when user returns to productive", () => {
    currentTime = 0;
    policy.onSample({ category: "distraction", processName: "chrome.exe", windowTitle: "YouTube" });
    currentTime = 20_000;
    policy.onSample({ category: "productive", processName: "code.exe", windowTitle: "main.ts" });
    currentTime = 25_000;
    policy.onSample({ category: "distraction", processName: "chrome.exe", windowTitle: "YouTube" });
    currentTime = 40_000;
    policy.onSample({ category: "distraction", processName: "chrome.exe", windowTitle: "YouTube" });
    expect(notifications.length).toBe(0);
  });

  it("includes process name in notification body", () => {
    currentTime = 0;
    policy.onSample({ category: "distraction", processName: "chrome.exe", windowTitle: "YouTube" });
    currentTime = 31_000;
    policy.onSample({ category: "distraction", processName: "chrome.exe", windowTitle: "YouTube" });
    expect(notifications[0]).toContain("chrome.exe");
  });
});
