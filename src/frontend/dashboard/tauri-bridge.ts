import { invoke } from "@tauri-apps/api/core"
import type { DashboardRPC, TrackingStatus } from "../../shared/types"

type DashboardRPCLike = DashboardRPC["requests"];

declare global {
  interface Window {
    dashboardRPC?: DashboardRPCLike;
  }
}

type TrackingStatusPayload = {
  running: boolean;
  state: TrackingStatus["state"];
};

export async function installDashboardRPC(): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }

  if (window.dashboardRPC) {
    return;
  }

  window.dashboardRPC = {
    getTodaySummary: () => invoke("get_today_summary"),
    getTopApps: () => invoke("get_top_apps"),
    getTimeline: (date) => invoke("get_timeline", { date }),
    getDailySummary: (date) => invoke("get_daily_summary", { date }),
    getSettings: () => invoke("get_settings"),
    getTrackingStatus: () => invoke("get_tracking_status"),
    setSetting: (input) => invoke("set_setting", { input }),
    setSettings: (input) => invoke("set_settings", { input }),
    getSetting: (key) => invoke("get_setting", { key }),
    generateSummaryNow: () => invoke("generate_summary_now"),
    saveSummaryFeedback: (input) => invoke("save_summary_feedback", { input }),
    getMemoryStatus: () => invoke("get_memory_status"),
    listMemories: (limit) => invoke("list_memories", { limit }),
    forgetMemory: (id) => invoke("forget_memory", { id }),
    pinMemory: (input) => invoke("pin_memory", { input }),
    toggleTracking: () => invoke("toggle_tracking"),
  };

  const eventChannel = await import("@tauri-apps/api/event");
  await eventChannel.listen<TrackingStatusPayload>("tracking-status", (event) => {
    window.dispatchEvent(new CustomEvent<TrackingStatusPayload>("tracking-status", { detail: event.payload }));
  });
}
