import { describe, expect, it } from "vitest";
import { formatDuration, getRestartRequiredKeys, parseIntegerInput } from "../../src/frontend/dashboard/helpers";
import type { AppSettings } from "../../src/shared/types";

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
