import { onCleanup } from "solid-js";
import type { AppSettings } from "../../shared/types";
import { RESTART_REQUIRED_SETTINGS } from "../../shared/settings";

export const DASHBOARD_BOOTSTRAP_TIMEOUT_MS = 5_000;

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m ${seconds}s`;
}

export function formatMemoryDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

export function formatActivityTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatActivityDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

export function formatBrowserVisitUrl(url: string, redactQuery: boolean): string {
  if (!redactQuery) {
    return url;
  }

  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url.split("?")[0]?.split("#")[0] ?? url;
  }
}

export function formatPercent(part: number, whole: number): number {
  if (whole <= 0) {
    return 0;
  }

  return Math.round((part / whole) * 100);
}

export function getRestartRequiredKeys(previous: AppSettings, next: AppSettings): Array<keyof AppSettings> {
  return RESTART_REQUIRED_SETTINGS.filter((key) => previous[key] !== next[key]);
}

export function parseIntegerInput(value: string, fallback: number, minValue = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minValue) {
    return fallback;
  }

  return parsed;
}

export function parseBootstrapTimeout(value: string | null | undefined): number {
  return parseIntegerInput(value ?? "", DASHBOARD_BOOTSTRAP_TIMEOUT_MS, 1000);
}

export function getCurrentUtcDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

export function createSubscriptionRegistrar(): (dispose: (() => void) | undefined) => void {
  const disposers: Array<() => void> = [];

  onCleanup(() => {
    while (disposers.length > 0) {
      const dispose = disposers.pop();
      try {
        dispose?.();
      } catch (error) {
        console.warn("[dashboard] failed to dispose subscription", error);
      }
    }
  });

  return (dispose) => {
    if (dispose) {
      disposers.push(dispose);
    }
  };
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timerId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timerId = window.setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timerId !== undefined) {
      window.clearTimeout(timerId);
    }
  }
}
