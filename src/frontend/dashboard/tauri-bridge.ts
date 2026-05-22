import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { attachConsole } from "@tauri-apps/plugin-log";
import { normalizeAppError } from "../../shared/app-error";
import type { DashboardRPC, TrackingStatus } from "../../shared/types";

type TrackingStatusPayload = {
  running: boolean;
  state: TrackingStatus["state"];
};

export type DashboardClient = DashboardRPC["requests"];

let consoleAttached = false;
// Keep the console listener disposable so HMR does not stack log handlers.
let consoleUnlisten: (() => void) | null = null;
let rpcClient: DashboardClient | null = null;
const GEMINI_API_KEY_SETTINGS_EVENT = "gemini-api-key-settings-requested";
const ACTIVITY_LOG_UPDATED_EVENT = "activity-log-updated";
const BROWSER_HISTORY_UPDATED_EVENT = "browser-history-updated";

async function invokeDashboard<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw normalizeAppError(error);
  }
}

export async function installDashboardRPC(): Promise<DashboardClient> {
  if (rpcClient) {
    return rpcClient;
  }

  if (!consoleAttached) {
    consoleAttached = true;
    void attachConsole()
      .then((unlisten) => {
        consoleUnlisten = unlisten;
      })
      .catch(() => {
        consoleAttached = false;
        consoleUnlisten = null;
      });
  }

  rpcClient = {
    getTodaySummary: () => invokeDashboard("get_today_summary"),
    getTopApps: () => invokeDashboard("get_top_apps"),
    getBrowserVisits: (limit) => invokeDashboard("get_browser_visits", limit == null ? undefined : { limit }),
    getActivityLog: (query) => invokeDashboard("get_activity_log", { query }),
    getStatisticsSnapshot: (rangeDays) =>
      invokeDashboard("get_statistics_snapshot", rangeDays == null ? undefined : { input: { rangeDays } }),
    getTimeline: (date) => invokeDashboard("get_timeline", { date }),
    getDailySummary: (date) => invokeDashboard("get_daily_summary", { date }),
    getSettings: () => invokeDashboard("get_settings"),
    getTrackingStatus: () => invokeDashboard("get_tracking_status"),
    getDashboardBootstrap: () => invokeDashboard("get_dashboard_bootstrap"),
    getClassificationRules: () => invokeDashboard("get_classification_rules"),
    saveClassificationRule: (input) => invokeDashboard("save_classification_rule", { input }),
    deleteClassificationRule: (input) => invokeDashboard("delete_classification_rule", { input }),
    setClassificationRuleEnabled: (input) =>
      invokeDashboard("set_classification_rule_enabled", { input }),
    moveClassificationRule: (input) => invokeDashboard("move_classification_rule", { input }),
    reorderClassificationRule: (input) => invokeDashboard("reorder_classification_rule", { input }),
    setSetting: (input) => invokeDashboard("set_setting", { input }),
    setSettings: (input) => invokeDashboard("set_settings", { input }),
    getSetting: (key) => invokeDashboard("get_setting", { key }),
    generateSummaryNow: () => invokeDashboard("generate_summary_now"),
    saveSummaryFeedback: (input) => invokeDashboard("save_summary_feedback", { input }),
    getMemoryStatus: () => invokeDashboard("get_memory_status"),
    listMemories: (limit) => invokeDashboard("list_memories", { limit }),
    getMemorySnapshot: (limit) => invokeDashboard("get_memory_snapshot", { limit }),
    forgetMemory: (id) => invokeDashboard("forget_memory", { id }),
    pinMemory: (input) => invokeDashboard("pin_memory", { input }),
    toggleTracking: () => invokeDashboard("toggle_tracking"),
  };

  return rpcClient;
}

export async function subscribeTrackingStatus(
  listener: (status: TrackingStatusPayload) => void,
): Promise<() => void> {
  return listen<TrackingStatusPayload>("tracking-status", (event) => {
    listener(event.payload);
  });
}

export async function subscribeGeminiApiKeySettings(listener: () => void): Promise<() => void> {
  return listen(GEMINI_API_KEY_SETTINGS_EVENT, () => {
    listener();
  });
}

export async function subscribeActivityLogUpdates(listener: () => void): Promise<() => void> {
  return listen(ACTIVITY_LOG_UPDATED_EVENT, () => {
    listener();
  });
}

export async function subscribeBrowserHistoryUpdates(
  listener: () => void,
): Promise<() => void> {
  return listen(BROWSER_HISTORY_UPDATED_EVENT, () => {
    listener();
  });
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    consoleAttached = false;
    rpcClient = null;
    consoleUnlisten?.();
    consoleUnlisten = null;
  });
}
