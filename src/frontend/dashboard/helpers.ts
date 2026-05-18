import type { AppSettings } from "../../shared/types";
import { RESTART_REQUIRED_SETTINGS } from "../../shared/settings";

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
