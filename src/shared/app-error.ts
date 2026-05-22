import { z } from "zod";

const APP_ERROR_KINDS = [
  "database",
  "keyring",
  "http",
  "settings",
  "validation",
  "externalApi",
  "internal",
] as const;

export type AppErrorKind = (typeof APP_ERROR_KINDS)[number];

export const AppErrorSchema = z
  .object({
    kind: z.enum(APP_ERROR_KINDS),
    command: z.string().min(1).optional(),
    message: z.string().min(1),
  })
  .passthrough();

export type AppErrorPayload = z.infer<typeof AppErrorSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function tryParseStructuredError(value: string): unknown | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

export function normalizeAppError(error: unknown): AppErrorPayload {
  const parsed = AppErrorSchema.safeParse(error);
  if (parsed.success) {
    return parsed.data;
  }

  if (typeof error === "string" && error.trim()) {
    const structured = tryParseStructuredError(error);
    if (structured) {
      return normalizeAppError(structured);
    }

    return {
      kind: "internal",
      message: error.trim(),
    };
  }

  if (error instanceof Error && error.message.trim()) {
    const structured = tryParseStructuredError(error.message);
    if (structured) {
      return normalizeAppError(structured);
    }

    return {
      kind: "internal",
      message: error.message.trim(),
    };
  }

  if (isRecord(error)) {
    const message = readString(error, "message") ?? readString(error, "error");
    if (message) {
      const kind = readString(error, "kind");
      const command = readString(error, "command");
      if (kind && APP_ERROR_KINDS.includes(kind as AppErrorKind)) {
        const normalizedKind = kind as AppErrorKind;
        return {
          kind: normalizedKind,
          ...(command ? { command } : {}),
          message,
        };
      }

      const structured = tryParseStructuredError(message);
      if (structured) {
        return normalizeAppError(structured);
      }

      return {
        kind: "internal",
        ...(command ? { command } : {}),
        message,
      };
    }
  }

  return {
    kind: "internal",
    message: "Unexpected application error",
  };
}

export function formatAppError(error: AppErrorPayload): string {
  return error.message;
}

const COMMAND_LABELS: Partial<Record<string, string>> = {
  get_today_summary: "Today summary",
  get_top_apps: "Top apps",
  get_statistics_snapshot: "Statistics snapshot",
  get_timeline: "Timeline",
  get_activity_log: "Activity log",
  get_daily_summary: "Daily summary",
  get_settings: "Settings",
  get_tracking_status: "Tracking status",
  get_dashboard_bootstrap: "Dashboard bootstrap",
  get_browser_visits: "Browser visits",
  set_setting: "Update setting",
  set_settings: "Save settings",
  get_setting: "Read setting",
  generate_summary_now: "Generate summary",
  save_summary_feedback: "Save feedback",
  get_memory_status: "Memory status",
  get_memory_snapshot: "Memory snapshot",
  list_memories: "Memory list",
  forget_memory: "Forget memory",
  pin_memory: "Pin memory",
  toggle_tracking: "Toggle tracking",
  load_tracking_enabled: "Load tracking enabled",
  daily_export: "Daily export",
};

function humanizeSnakeCase(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function describeAppError(error: AppErrorPayload, context?: string): string {
  const heading = context?.trim() || (error.command ? COMMAND_LABELS[error.command] ?? humanizeSnakeCase(error.command) : "Application error");
  return `${heading}: ${error.message}`;
}
