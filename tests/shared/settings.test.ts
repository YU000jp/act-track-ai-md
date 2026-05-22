import { describe, expect, it } from "vitest";
import { RESTART_REQUIRED_SETTINGS } from "../../src/shared/settings";
import { DEFAULT_SETTINGS, type AppSettings } from "../../src/shared/types";
import { getRestartRequiredKeys } from "../../src/frontend/dashboard/helpers";

describe("restart-required settings", () => {
  it("only marks start-in-background changes as restart-required", () => {
    expect(RESTART_REQUIRED_SETTINGS).toEqual(["startInBackground"]);
  });

  it("does not flag live-reactive timing settings", () => {
    const next: AppSettings = {
      ...DEFAULT_SETTINGS,
      pollIntervalMs: 4_000,
      idleTimeoutMs: 120_000,
      notificationCooldownMs: 15_000,
      gracePeriodMs: 5_000,
      browserHistoryPollIntervalMs: 30_000,
      autoStart: true,
    };

    expect(getRestartRequiredKeys(DEFAULT_SETTINGS, next)).toEqual([]);
  });

  it("flags start-in-background changes", () => {
    const next: AppSettings = {
      ...DEFAULT_SETTINGS,
      startInBackground: false,
    };

    expect(getRestartRequiredKeys(DEFAULT_SETTINGS, next)).toEqual(["startInBackground"]);
  });
});
