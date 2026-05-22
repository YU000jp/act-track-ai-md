import type { AppErrorPayload } from "../../shared/app-error";
import type { ActivityCategory, ActivityLogEntry, StatisticsRange, StatisticsSnapshot } from "../../shared/types";

export type TodayStats = {
  trackedMs: number;
  productiveMs: number;
  distractionMs: number;
  neutralMs: number;
};

export type TopApp = {
  processName: string;
  durationMs: number;
  category: string;
};

export type RangeStatistics = StatisticsSnapshot;
export type StatisticsWindow = StatisticsRange;

export type ToastKind = "error" | "info" | "success";
export type TabKey = "today" | "activity" | "statistics" | "rules" | "memory" | "settings";

export type ActivityLogSourceFilter = "" | "foreground" | "browser";

export type ActivityLogFilters = {
  date: string;
  source: ActivityLogSourceFilter;
  app: string;
  category: "" | ActivityCategory;
  browser: string;
};

export type ActivityLogEntryView = ActivityLogEntry;

export type DashboardErrorState = {
  context: string;
  error: AppErrorPayload;
};

export type DashboardToast = {
  id: number;
  kind: ToastKind;
  title: string;
  message: string;
};
