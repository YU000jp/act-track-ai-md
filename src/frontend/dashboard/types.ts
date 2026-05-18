import type { AppErrorPayload } from "../../shared/app-error";

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

export type ToastKind = "error" | "info" | "success";
export type TabKey = "today" | "statistics" | "settings";

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
