import { createSignal, onMount } from "solid-js";
import { normalizeAppError } from "../../shared/app-error";
import { APP_META } from "../../shared/app-meta";
import type { DashboardBootstrapSnapshot } from "../../shared/types";
import { type TrackingStatus } from "../../shared/types";
import type { DashboardClient } from "./tauri-bridge";
import { createSubscriptionRegistrar, parseBootstrapTimeout, withTimeout } from "./helpers";
import type { DashboardErrorState, DashboardToast, TabKey } from "./types";
import { useBrowserHistoryController } from "./useBrowserHistoryController";
import { useActivityLogController } from "./useActivityLogController";
import { useMemoryController } from "./useMemoryController";
import { useClassificationController } from "./useClassificationController";
import { useSettingsController } from "./useSettingsController";
import { useSummaryController } from "./useSummaryController";
import { useStatsController } from "./useStatsController";
import { useTimelineController } from "./useTimelineController";
import { useTrackingController } from "./useTrackingController";

type ControllerProps = {
  rpc: DashboardClient;
  subscribeTrackingStatus?: (listener: (status: TrackingStatus) => void) => Promise<() => void>;
  subscribeGeminiApiKeySettings?: (listener: () => void) => Promise<() => void>;
  subscribeActivityLogUpdates?: (listener: () => void) => Promise<() => void>;
  subscribeBrowserHistoryUpdates?: (listener: () => void) => Promise<() => void>;
  subscribeMarkdownExportFailures?: (
    listener: (payload: import("../../shared/types").MarkdownExportFailure) => void,
  ) => Promise<() => void>;
};

export type DashboardController = {
  dashboardTitle: string;
  isHydrated: () => boolean;
  activeTab: () => TabKey;
  setActiveTab: (tab: TabKey) => void;
  errorState: () => DashboardErrorState | null;
  toasts: () => DashboardToast[];
  todayStats: ReturnType<typeof useStatsController>["todayStats"];
  topApps: ReturnType<typeof useStatsController>["topApps"];
  browserVisits: ReturnType<typeof useBrowserHistoryController>["browserVisits"];
  activityLog: ReturnType<typeof useActivityLogController>;
  recentWindows: ReturnType<typeof useTimelineController>["recentWindows"];
  rangeStats: ReturnType<typeof useStatsController>["rangeStats"];
  rangeWindow: ReturnType<typeof useStatsController>["rangeWindow"];
  rangeLoading: ReturnType<typeof useStatsController>["rangeLoading"];
  setRangeWindow: ReturnType<typeof useStatsController>["setRangeWindow"];
  settings: ReturnType<typeof useSettingsController>["settings"];
  geminiApiKey: ReturnType<typeof useSettingsController>["geminiApiKey"];
  settingsFeedback: ReturnType<typeof useSettingsController>["settingsFeedback"];
  classification: ReturnType<typeof useClassificationController>;
  trackingStatus: ReturnType<typeof useTrackingController>["trackingStatus"];
  isTogglingTracking: ReturnType<typeof useTrackingController>["isTogglingTracking"];
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
  toggleTracking: () => Promise<void>;
};

export function useDashboardController(props: ControllerProps): DashboardController {
  const dashboardTitle = `${APP_META.displayName} Dashboard`;
  const [activeTab, setActiveTab] = createSignal<TabKey>("today");
  const [errorState, setErrorState] = createSignal<DashboardErrorState | null>(null);
  const [toasts, setToasts] = createSignal<DashboardToast[]>([]);
  const [isHydrated, setIsHydrated] = createSignal(false);
  const registerSubscriptionDispose = createSubscriptionRegistrar();

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

  // If the aggregate snapshot stalls, rehydrate the visible shell from smaller RPCs
  // so the dashboard can become interactive instead of staying on the loading hint.
  async function hydrateDashboardFallback(): Promise<void> {
    const [
      todaySummaryResult,
      topAppsResult,
      browserVisitsResult,
      settingsResult,
      trackingResult,
      memorySnapshotResult,
      classificationRulesResult,
    ] =
      await Promise.allSettled([
        props.rpc.getTodaySummary(),
        props.rpc.getTopApps(),
        props.rpc.getBrowserVisits(12),
        props.rpc.getSettings(),
        props.rpc.getTrackingStatus(),
        props.rpc.getMemorySnapshot(10),
        props.rpc.getClassificationRules(),
      ]);

    if (todaySummaryResult.status === "fulfilled" && topAppsResult.status === "fulfilled") {
      const todaySummary = todaySummaryResult.value;
      const topApps = topAppsResult.value;

      statsController.hydrateStats(todaySummary, topApps, null, 7);

      void props.rpc
        .getStatisticsSnapshot(7)
        .then((statisticsSnapshot) => {
          statsController.hydrateStats(todaySummary, topApps, statisticsSnapshot, 7);
        })
        .catch((error) => {
          console.warn(
            "[dashboard] failed to load deferred statistics snapshot",
            normalizeAppError(error),
          );
        });
    }

    if (settingsResult.status === "fulfilled") {
      settingsController.hydrateSettings(settingsResult.value);
    }

    if (browserVisitsResult.status === "fulfilled") {
      browserHistoryController.hydrateBrowserVisits(browserVisitsResult.value);
    }

    if (trackingResult.status === "fulfilled") {
      trackingController.hydrateTracking(trackingResult.value);
    }

    if (memorySnapshotResult.status === "fulfilled") {
      memoryController.hydrateMemory(
        memorySnapshotResult.value.memoryStatus,
        memorySnapshotResult.value.memoryRecords,
      );
    }

    if (classificationRulesResult.status === "fulfilled") {
      classificationController.hydrateRules(classificationRulesResult.value);
    }

    await timelineController.refreshTodayTimeline();
  }

  const settingsController = useSettingsController({
    rpc: props.rpc,
    reportError: reportDashboardError,
    pushToast,
  });

  const statsController = useStatsController({
    rpc: props.rpc,
    reportError: reportDashboardError,
  });
  const memoryController = useMemoryController({
    rpc: props.rpc,
    reportError: reportDashboardError,
    pushToast,
  });

  const browserHistoryController = useBrowserHistoryController({
    rpc: props.rpc,
    reportError: reportDashboardError,
    pushToast,
  });

  const activityLogController = useActivityLogController({
    rpc: props.rpc,
    reportError: reportDashboardError,
    pushToast,
    subscribeActivityLogUpdates: props.subscribeActivityLogUpdates,
    subscribeBrowserHistoryUpdates: props.subscribeBrowserHistoryUpdates,
  });

  const classificationController = useClassificationController({
    rpc: props.rpc,
    reportError: reportDashboardError,
    pushToast,
    syncSettingsJson: (value) => settingsController.onSettingChange("classificationRulesJson", value),
  });

  const summaryController = useSummaryController({
    rpc: props.rpc,
    memoryController,
    reportError: reportDashboardError,
    pushToast,
  });

  const timelineController = useTimelineController({
    rpc: props.rpc,
    subscribeActivityLogUpdates: props.subscribeActivityLogUpdates,
  });

  const trackingController = useTrackingController({
    rpc: props.rpc,
    subscribeTrackingStatus: props.subscribeTrackingStatus,
  });

  onMount(() => {
    if (props.subscribeGeminiApiKeySettings) {
      void props.subscribeGeminiApiKeySettings(() => {
        setActiveTab("settings");
      })
        .then(registerSubscriptionDispose)
        .catch((error) => {
          console.warn("[dashboard] failed to subscribe to Gemini settings updates", error);
        });
    }

    if (props.subscribeBrowserHistoryUpdates) {
      void props.subscribeBrowserHistoryUpdates(() => {
        void browserHistoryController.refreshBrowserVisits();
      })
        .then(registerSubscriptionDispose)
        .catch((error) => {
          console.warn("[dashboard] failed to subscribe to browser history updates", error);
        });
    }

    if (props.subscribeMarkdownExportFailures) {
      void props.subscribeMarkdownExportFailures((payload) => {
        pushToast("error", "Markdown export failed", `${payload.date}: ${payload.error.message}`);
      })
        .then(registerSubscriptionDispose)
        .catch((error) => {
          console.warn("[dashboard] failed to subscribe to markdown export failures", error);
        });
    }
  });

  async function hydrateDashboard(): Promise<void> {
    try {
      const configuredTimeout = parseBootstrapTimeout(
        await props.rpc.getSetting("dashboardBootstrapTimeoutMs"),
      );
      const bootstrap: DashboardBootstrapSnapshot = await withTimeout(
        props.rpc.getDashboardBootstrap(),
        configuredTimeout,
        "dashboard snapshot",
      );

      statsController.hydrateStats(
        bootstrap.todaySummary,
        bootstrap.topApps,
        bootstrap.statisticsSnapshot,
        7,
      );
      settingsController.hydrateSettings(bootstrap.settings);
      classificationController.hydrateRules(bootstrap.classificationRules);
      summaryController.hydrateSummary(bootstrap.dailySummary?.aiSummary);
      memoryController.hydrateMemory(bootstrap.memoryStatus, bootstrap.memoryRecords);
      browserHistoryController.hydrateBrowserVisits(bootstrap.browserVisits);
      trackingController.hydrateTracking(bootstrap.trackingStatus);
      await timelineController.refreshTodayTimeline();
      clearDashboardError();
    } catch (error) {
      reportDashboardError("Failed to load dashboard snapshot", error);
      void hydrateDashboardFallback().catch((fallbackError) => {
        console.warn(
          "[dashboard] fallback dashboard hydration failed",
          normalizeAppError(fallbackError),
        );
      });
    } finally {
      setIsHydrated(true);
    }
  }

  onMount(() => {
    void hydrateDashboard();
  });

  return {
    dashboardTitle,
    isHydrated,
    activeTab,
    setActiveTab,
    errorState,
    toasts,
    todayStats: statsController.todayStats,
    topApps: statsController.topApps,
    browserVisits: browserHistoryController.browserVisits,
    activityLog: activityLogController,
    recentWindows: timelineController.recentWindows,
    rangeStats: statsController.rangeStats,
    rangeWindow: statsController.rangeWindow,
    rangeLoading: statsController.rangeLoading,
    setRangeWindow: statsController.setRangeWindow,
    settings: settingsController.settings,
    geminiApiKey: settingsController.geminiApiKey,
    settingsFeedback: settingsController.settingsFeedback,
    classification: classificationController,
    trackingStatus: trackingController.trackingStatus,
    isTogglingTracking: trackingController.isTogglingTracking,
    memoryStatus: memoryController.memoryStatus,
    memoryRecords: memoryController.memoryRecords,
    summaryFeedback: summaryController.summaryFeedback,
    summaryFeedbackStatus: summaryController.summaryFeedbackStatus,
    setSummaryFeedback: summaryController.setSummaryFeedback,
    setGeminiApiKey: settingsController.setGeminiApiKey,
    onSettingChange: settingsController.onSettingChange,
    saveSettings: async (event: SubmitEvent) => {
      const saved = await settingsController.saveSettings(event);
      if (saved) {
        await classificationController.reloadRules();
      }
      return saved;
    },
    generateSummaryNow: summaryController.generateSummaryNow,
    saveSummaryFeedback: summaryController.saveSummaryFeedback,
    handleMemoryAction: memoryController.handleMemoryAction,
    toggleTracking: async () => {
      try {
        await trackingController.toggleTracking();
      } catch (error) {
        reportDashboardError("Failed to toggle tracking", error);
      }
    },
  };
}
