import { invoke } from "@tauri-apps/api/core"
import { attachConsole } from "@tauri-apps/plugin-log"
import { normalizeAppError } from "../../shared/app-error"
import type { DashboardRPC, TrackingStatus } from "../../shared/types"

type TrackingStatusPayload = {
  running: boolean;
  state: TrackingStatus["state"];
};

export type DashboardClient = DashboardRPC["requests"];

let consoleAttached = false;
let rpcClient: DashboardClient | null = null;
const GEMINI_API_KEY_SETTINGS_EVENT = "gemini-api-key-settings-requested";

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
    void attachConsole().catch(() => {
      consoleAttached = false;
    });
  }

  rpcClient = {
    getTodaySummary: () => invokeDashboard("get_today_summary"),
    getTopApps: () => invokeDashboard("get_top_apps"),
    getStatisticsSnapshot: (rangeDays) =>
      invokeDashboard("get_statistics_snapshot", rangeDays == null ? undefined : { input: { rangeDays } }),
    getTimeline: (date) => invokeDashboard("get_timeline", { date }),
    getDailySummary: (date) => invokeDashboard("get_daily_summary", { date }),
    getSettings: () => invokeDashboard("get_settings"),
    getTrackingStatus: () => invokeDashboard("get_tracking_status"),
    setSetting: (input) => invokeDashboard("set_setting", { input }),
    setSettings: (input) => invokeDashboard("set_settings", { input }),
    getSetting: (key) => invokeDashboard("get_setting", { key }),
    generateSummaryNow: () => invokeDashboard("generate_summary_now"),
    saveSummaryFeedback: (input) => invokeDashboard("save_summary_feedback", { input }),
    getMemoryStatus: () => invokeDashboard("get_memory_status"),
    listMemories: (limit) => invokeDashboard("list_memories", { limit }),
    forgetMemory: (id) => invokeDashboard("forget_memory", { id }),
    pinMemory: (input) => invokeDashboard("pin_memory", { input }),
    toggleTracking: () => invokeDashboard("toggle_tracking"),
  };

  return rpcClient;
}

export async function subscribeTrackingStatus(
  listener: (status: TrackingStatusPayload) => void,
): Promise<() => void> {
  const eventChannel = await import("@tauri-apps/api/event");
  return eventChannel.listen<TrackingStatusPayload>("tracking-status", (event) => {
    listener(event.payload);
  });
}

export async function subscribeGeminiApiKeySettings(
  listener: () => void,
): Promise<() => void> {
  const eventChannel = await import("@tauri-apps/api/event");
  return eventChannel.listen(GEMINI_API_KEY_SETTINGS_EVENT, () => {
    listener();
  });
}
