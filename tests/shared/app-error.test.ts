import { describe, expect, it } from "vitest";
import { AppErrorSchema, describeAppError, formatAppError, normalizeAppError } from "../../src/shared/app-error";

describe("app error normalization", () => {
  it("accepts tagged backend payloads", () => {
    const parsed = AppErrorSchema.parse({
      kind: "database",
      command: "get_today_summary",
      message: "lock poisoned",
    });

    expect(parsed.kind).toBe("database");
    expect(parsed.command).toBe("get_today_summary");
    expect(parsed.message).toBe("lock poisoned");
  });

  it("normalizes plain errors to internal payloads", () => {
    const payload = normalizeAppError(new Error("boom"));

    expect(payload.kind).toBe("internal");
    expect(formatAppError(payload)).toBe("boom");
  });

  it("formats command headings without raw snake case", () => {
    const payload = AppErrorSchema.parse({
      kind: "settings",
      command: "set_settings",
      message: "save failed",
    });

    expect(describeAppError(payload)).toBe("Save settings: save failed");
  });

  it("formats browser history commands with a readable label", () => {
    const payload = AppErrorSchema.parse({
      kind: "database",
      command: "get_browser_visits",
      message: "read failed",
    });

    expect(describeAppError(payload)).toBe("Browser visits: read failed");
  });

  it("formats activity log commands with a readable label", () => {
    const payload = AppErrorSchema.parse({
      kind: "database",
      command: "get_activity_log",
      message: "read failed",
    });

    expect(describeAppError(payload)).toBe("Activity log: read failed");
  });

  it("normalizes unknown values to a fallback error", () => {
    const payload = normalizeAppError(null);

    expect(payload.kind).toBe("internal");
    expect(payload.message).toBe("Unexpected application error");
  });

  it("normalizes structured objects with message fields", () => {
    const payload = normalizeAppError({
      kind: "settings",
      command: "set_settings",
      message: "save failed",
      stack: "ignored",
    });

    expect(payload.kind).toBe("settings");
    expect(payload.command).toBe("set_settings");
    expect(payload.message).toBe("save failed");
  });
});
