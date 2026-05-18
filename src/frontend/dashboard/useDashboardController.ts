import { createSignal, onMount } from "solid-js";
import { normalizeAppError } from "../../shared/app-error";
import { APP_META } from "../../shared/app-meta";
import { type TrackingStatus } from "../../shared/types";
import type { DashboardClient } from "./tauri-bridge";
import type { DashboardErrorState, DashboardToast, TabKey } from "./types";
import { useMemoryController } from "./useMemoryController";
import { useSettingsController } from "./useSettingsController";
import { useSummaryController } from "./useSummaryController";
import { useStatsController } from "./useStatsController";
import { useTrackingController } from "./useTrackingController";

type ControllerProps = {
  rpc: DashboardClient;
  subscribeTrackingStatus?: (listener: (status: TrackingStatus) => void) => Promise<() => void>;
};

export type DashboardController = {
  dashboardTitle: string;
  activeTab: () => TabKey;
  setActiveTab: (tab: TabKey) => void;
  errorState: () => DashboardErrorState | null;
  toasts: () => DashboardToast[];
  todayStats: ReturnType<typeof useStatsController>["todayStats"];
  topApps: ReturnType<typeof useStatsController>["topApps"];
  settings: ReturnType<typeof useSettingsController>["settings"];
  geminiApiKey: ReturnType<typeof useSettingsController>["geminiApiKey"];
  settingsFeedback: ReturnType<typeof useSettingsController>["settingsFeedback"];
  trackingStatus: ReturnType<typeof useTrackingController>["trackingStatus"];
  memoryStatus: ReturnType<typeof useMemoryController>["memoryStatus"];
  memoryRecords: ReturnType<typeof useMemoryController>["memoryRecords"];
  summaryFeedback: ReturnType<typeof useSummaryController>["summaryFeedback"];
  summaryFeedbackStatus: ReturnType<typeof useSummaryController>["summaryFeedbackStatus"];
  setSummaryFeedback: ReturnType<typeof useSummaryController>["setSummaryFeedback"];
  setGeminiApiKey: ReturnType<typeof useSettingsController>["setGeminiApiKey"];
  onSettingChange: ReturnType<typeof useSettingsController>["onSettingChange"];
  saveSettings: ReturnType<typeof useSettingsController>["saveSettings"];
  generateSummaryNow: ReturnType<typeof useSummaryController>["generateSummaryNow"];
  saveSummaryFeedback: ReturnType<typeof useSummaryController>["saveSummaryFeedback"];
  handleMemoryAction: ReturnType<typeof useMemoryController>["handleMemoryAction"];
};

export function useDashboardController(props: ControllerProps): DashboardController {
  const dashboardTitle = `${APP_META.displayName} Dashboard`;
  const [activeTab, setActiveTab] = createSignal<TabKey>("today");
  const [errorState, setErrorState] = createSignal<DashboardErrorState | null>(null);
  const [toasts, setToasts] = createSignal<DashboardToast[]>([]);

  function pushToast(kind: DashboardToast["kind"], title: string, message: string): void {
    const toast: DashboardToast = {
      id: Date.now(),
      kind,
      title,
      message,
    };

    setToasts((current) => [...current, toast]);

    window.setTimeout(() => {
      setToasts((current) => current.filter((entry) => entry.id !== toast.id));
    }, 4200);
  }

  function clearDashboardError(): void {
    setErrorState(null);
  }

  function reportDashboardError(context: string, error: unknown): void {
    const normalized = normalizeAppError(error);
    console.error(`[dashboard] ${context}`, normalized);
    setErrorState({ context, error: normalized });
    pushToast("error", context, normalized.message);
  }

  const settingsController = useSettingsController({
    rpc: props.rpc,
    reportError: reportDashboardError,
    pushToast,
  });

  const statsController = useStatsController();
  const memoryController = useMemoryController({
    rpc: props.rpc,
    reportError: reportDashboardError,
    pushToast,
  });

  const summaryController = useSummaryController({
    rpc: props.rpc,
    memoryController,
    reportError: reportDashboardError,
    pushToast,
  });

  const trackingController = useTrackingController({
    subscribeTrackingStatus: props.subscribeTrackingStatus,
  });

  async function hydrateDashboard(): Promise<void> {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const [todaySummary, topAppsData, loadedSettings, tracking, summary, status, memories] = await Promise.all([
        props.rpc.getTodaySummary(),
        props.rpc.getTopApps(),
        props.rpc.getSettings(),
        props.rpc.getTrackingStatus(),
        props.rpc.getDailySummary(today),
        props.rpc.getMemoryStatus(),
        props.rpc.listMemories(10),
      ]);

      statsController.hydrateStats(todaySummary, topAppsData);
      settingsController.hydrateSettings(loadedSettings);
      summaryController.hydrateSummary(summary?.aiSummary);
      memoryController.hydrateMemory(status, memories);
      trackingController.hydrateTracking(tracking);
      clearDashboardError();
    } catch (error) {
      reportDashboardError("Failed to load dashboard data", error);
    }
  }

  onMount(() => {
    void hydrateDashboard();
  });

  return {
    dashboardTitle,
    activeTab,
    setActiveTab,
    errorState,
    toasts,
    todayStats: statsController.todayStats,
    topApps: statsController.topApps,
    settings: settingsController.settings,
    geminiApiKey: settingsController.geminiApiKey,
    settingsFeedback: settingsController.settingsFeedback,
    trackingStatus: trackingController.trackingStatus,
    memoryStatus: memoryController.memoryStatus,
    memoryRecords: memoryController.memoryRecords,
    summaryFeedback: summaryController.summaryFeedback,
    summaryFeedbackStatus: summaryController.summaryFeedbackStatus,
    setSummaryFeedback: summaryController.setSummaryFeedback,
    setGeminiApiKey: settingsController.setGeminiApiKey,
    onSettingChange: settingsController.onSettingChange,
    saveSettings: settingsController.saveSettings,
    generateSummaryNow: summaryController.generateSummaryNow,
    saveSummaryFeedback: summaryController.saveSummaryFeedback,
    handleMemoryAction: memoryController.handleMemoryAction,
  };
}
