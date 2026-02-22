import { beforeEach, describe, expect, it } from "bun:test";
import { createApp } from "../../src/bun/index";
import { createDatastores, type Datastores } from "../../src/bun/db";
import type { ActivityCategory, WindowSnapshot } from "../../src/shared/types";

describe("createApp", () => {
  let datastores: Datastores;
  let nowMs: number;
  let currentWindow: WindowSnapshot | null;
  let idleMs: number;
  let notifications: Array<{ title: string; body: string }>;

  beforeEach(() => {
    datastores = createDatastores(":memory:", ":memory:");
    nowMs = 1_000;
    currentWindow = null;
    idleMs = 0;
    notifications = [];
  });

  function createTestApp(category: ActivityCategory, apiKey = "test-key") {
    return createApp({
      tracker: {
        getForegroundWindow: () => currentWindow,
        getIdleMs: () => idleMs,
      },
      datastores,
      apiKey,
      pollIntervalMs: 3_000,
      idleTimeoutMs: 300_000,
      graceMs: 30_000,
      cooldownMs: 300_000,
      notify: (title, body) => {
        notifications.push({ title, body });
      },
      now: () => nowMs,
      geminiClassify: async ({ apiKey: key, processName }) => {
        if (!key) {
          throw new Error("Missing API key");
        }

        return {
          category,
          label: processName,
          confidence: 0.9,
        };
      },
    });
  }

  it("tick classifies foreground window and inserts activity", async () => {
    const app = createTestApp("productive");
    currentWindow = { processName: "code.exe", windowTitle: "file.ts" };

    await app.tick();

    const samples = datastores.getActivityRange(0, 10_000);
    expect(samples.length).toBe(1);
    expect(samples[0].processName).toBe("code.exe");
    expect(samples[0].windowTitle).toBe("file.ts");
    expect(samples[0].category).toBe("productive");
  });

  it("tick skips when foreground window is null", async () => {
    const app = createTestApp("productive");
    currentWindow = null;

    await app.tick();

    const samples = datastores.getActivityRange(0, 10_000);
    expect(samples.length).toBe(0);
  });

  it("tick skips when idle", async () => {
    const app = createTestApp("productive");
    currentWindow = { processName: "code.exe", windowTitle: "file.ts" };
    idleMs = 600_000;

    await app.tick();

    const samples = datastores.getActivityRange(0, 10_000);
    expect(samples.length).toBe(0);
  });

  it("tick sets duration on previous sample when window switches", async () => {
    const app = createTestApp("productive");

    nowMs = 1_000;
    currentWindow = { processName: "code.exe", windowTitle: "a.ts" };
    await app.tick();

    nowMs = 4_000;
    currentWindow = { processName: "chrome.exe", windowTitle: "docs" };
    await app.tick();

    const samples = datastores.getActivityRange(0, 10_000);
    expect(samples.length).toBe(2);
    expect(samples[0].durationMs).toBe(3_000);
  });

  it("tick triggers notifier on distraction", async () => {
    const app = createApp({
      tracker: {
        getForegroundWindow: () => currentWindow,
        getIdleMs: () => idleMs,
      },
      datastores,
      apiKey: "test-key",
      pollIntervalMs: 3_000,
      idleTimeoutMs: 300_000,
      graceMs: 0,
      cooldownMs: 0,
      notify: (title, body) => {
        notifications.push({ title, body });
      },
      now: () => nowMs,
      geminiClassify: async () => ({
        category: "distraction",
        label: "Social",
        confidence: 0.9,
      }),
    });
    currentWindow = { processName: "chrome.exe", windowTitle: "YouTube" };

    await app.tick();

    expect(notifications.length).toBe(1);
  });

  it("start/stop controls polling loop", () => {
    const app = createTestApp("productive");

    app.start();
    expect(app.isRunning()).toBe(true);

    app.stop();
    expect(app.isRunning()).toBe(false);
  });

  it("tick uses fallback when no API key", async () => {
    const app = createTestApp("productive", "");
    currentWindow = { processName: "code.exe", windowTitle: "file.ts" };

    await app.tick();

    const samples = datastores.getActivityRange(0, 10_000);
    expect(samples.length).toBe(1);
    expect(samples[0].category).toBe("unknown");
    expect(samples[0].label).toBe("Uncategorized");
  });
});
