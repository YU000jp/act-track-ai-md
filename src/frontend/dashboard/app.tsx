import type { TrackingStatus } from "../../shared/types";
import type { MemoryStatus } from "../../shared/types";
import brandMarkUrl from "../assets/icon.png";
import type { DashboardClient } from "./tauri-bridge";
import { ActivityLogPanel } from "./ActivityLogPanel";
import { ClassificationPanel } from "./ClassificationPanel";
import { DashboardTabs } from "./DashboardTabs";
import { ErrorBanner } from "./ErrorBanner";
import { DashboardStatusChip } from "./DashboardStatusChip";
import { MemoryPanel } from "./MemoryPanel";
import { SettingsPanel } from "./SettingsPanel";
import { StatisticsPanel } from "./StatisticsPanel";
import { TodayPanel } from "./TodayPanel";
import { ToastRegion } from "./ToastRegion";
import { useDashboardController } from "./useDashboardController";
import {
  subscribeActivityLogUpdates,
  subscribeBrowserHistoryUpdates,
  subscribeGeminiApiKeySettings,
  subscribeMarkdownExportFailures,
} from "./tauri-bridge";

type AppProps = {
  rpc: DashboardClient;
  subscribeTrackingStatus?: (listener: (status: TrackingStatus) => void) => Promise<() => void>;
  subscribeGeminiApiKeySettings?: (listener: () => void) => Promise<() => void>;
  subscribeActivityLogUpdates?: (listener: () => void) => Promise<() => void>;
  subscribeBrowserHistoryUpdates?: (listener: () => void) => Promise<() => void>;
  subscribeMarkdownExportFailures?: (
    listener: (payload: import("../../shared/types").MarkdownExportFailure) => void,
  ) => Promise<() => void>;
};

function describeTrackingState(status: TrackingStatus): string {
  if (!status.running) {
    return "Paused";
  }

  switch (status.state) {
    case "productive":
      return "Productive";
    case "distracted":
      return "Distracted";
    case "idle":
      return "Idle";
    default:
      return "Active";
  }
}

function describeMemoryStatus(status: MemoryStatus | null): string {
  if (!status) {
    return "Loading memory";
  }

  if (!status.enabled) {
    return "Memory disabled";
  }

  return `${status.total} entries`;
}

function describeAutoClassificationStatus(geminiApiKeyConfigured: boolean): string {
  return geminiApiKeyConfigured ? "Rules + cache + Gemini" : "Rules + cache";
}

function describeTrackingToggleLabel(status: TrackingStatus, isPending: boolean): string {
  if (isPending) {
    return status.running ? "Pausing..." : "Resuming...";
  }

  return status.running ? "Pause tracking" : "Resume tracking";
}

export function App(props: AppProps) {
  const controller = useDashboardController({
    rpc: props.rpc,
    subscribeTrackingStatus: props.subscribeTrackingStatus,
    subscribeGeminiApiKeySettings: props.subscribeGeminiApiKeySettings ?? subscribeGeminiApiKeySettings,
    subscribeActivityLogUpdates: props.subscribeActivityLogUpdates ?? subscribeActivityLogUpdates,
    subscribeBrowserHistoryUpdates: props.subscribeBrowserHistoryUpdates ?? subscribeBrowserHistoryUpdates,
    subscribeMarkdownExportFailures:
      props.subscribeMarkdownExportFailures ?? subscribeMarkdownExportFailures,
  });

  const trackingStatus = controller.trackingStatus;
  const settings = controller.settings;
  const isTrackingTogglePending = controller.isTogglingTracking;

  return (
    <div class={`dashboard-shell ${controller.isHydrated() ? "is-hydrated" : "is-loading"}`}>
      <div class="dashboard-glow dashboard-glow-a" aria-hidden="true"></div>
      <div class="dashboard-glow dashboard-glow-b" aria-hidden="true"></div>

      <header class="dashboard-hero">
        <div class="brand-block">
          <img class="brand-mark" src={brandMarkUrl} alt="ActTrack icon" />
          <div class="brand-copy">
            <h1>{controller.dashboardTitle}</h1>
            <p class="hero-description">Overview first. Management stays grouped behind the main navigation.</p>
          </div>
        </div>

        <div class="hero-status">
          <DashboardStatusChip
            label="Tracking"
            value={describeTrackingState(trackingStatus())}
            tone={trackingStatus().running ? "success" : "warning"}
          />
          <DashboardStatusChip
            label="Memory"
            value={describeMemoryStatus(controller.memoryStatus())}
            tone={controller.memoryStatus()?.enabled ? "accent" : "neutral"}
          />
          <DashboardStatusChip
            label="Automation"
            value={describeAutoClassificationStatus(settings().geminiApiKeyConfigured)}
            tone={settings().geminiApiKeyConfigured ? "success" : "warning"}
          />
          <button
            type="button"
            class={`btn-secondary tracking-toggle-btn ${trackingStatus().running ? "tracking-toggle-running" : "tracking-toggle-paused"}`}
            disabled={!controller.isHydrated() || isTrackingTogglePending()}
            aria-busy={isTrackingTogglePending()}
            onClick={() => void controller.toggleTracking()}
          >
            {describeTrackingToggleLabel(trackingStatus(), isTrackingTogglePending())}
          </button>
        </div>
      </header>

      <ErrorBanner errorState={controller.errorState()} />
      <ToastRegion toasts={controller.toasts()} />

      <main class="dashboard-workspace">
        <div class="workspace-header">
          <DashboardTabs activeTab={controller.activeTab()} onChange={controller.setActiveTab} />
          {!controller.isHydrated() && !controller.errorState() ? <p class="workspace-hint">Loading dashboard snapshot...</p> : null}
          {controller.errorState() ? <p class="workspace-hint workspace-hint-error">Showing fallback dashboard data.</p> : null}
        </div>

        <TodayPanel
          active={controller.activeTab() === "today"}
          todayStats={controller.todayStats()}
          topApps={controller.topApps()}
          browserVisits={controller.browserVisits()}
          browserHistoryRedactQuery={settings().browserHistoryRedactQuery}
          recentWindows={controller.recentWindows()}
          summaryFeedback={controller.summaryFeedback()}
          summaryFeedbackStatus={controller.summaryFeedbackStatus()}
          onSummaryFeedbackChange={controller.setSummaryFeedback}
          onGenerateSummaryNow={() => void controller.generateSummaryNow()}
          onSaveSummaryFeedback={() => void controller.saveSummaryFeedback()}
          onCreateRuleFromWindow={(sample) => {
            controller.classification.beginCreateRuleFromWindow(sample);
            controller.setActiveTab("rules");
          }}
        />

        <ActivityLogPanel
          active={controller.activeTab() === "activity"}
          controller={controller.activityLog}
          browserHistoryRedactQuery={settings().browserHistoryRedactQuery}
        />

        <StatisticsPanel
          active={controller.activeTab() === "statistics"}
          statisticsSnapshot={controller.rangeStats()}
          selectedRange={controller.rangeWindow()}
          isLoading={controller.rangeLoading()}
          onRangeChange={controller.setRangeWindow}
        />

        <SettingsPanel
          active={controller.activeTab() === "settings"}
          settings={settings()}
          trackingStatus={trackingStatus()}
          geminiApiKey={controller.geminiApiKey()}
          settingsFeedback={controller.settingsFeedback()}
          onSettingsSubmit={controller.saveSettings}
          onSettingChange={controller.onSettingChange}
          onGeminiApiKeyChange={controller.setGeminiApiKey}
        />

        <MemoryPanel
          active={controller.activeTab() === "memory"}
          memoryStatus={controller.memoryStatus()}
          memoryRecords={controller.memoryRecords()}
          onMemoryAction={(action, record) => void controller.handleMemoryAction(action, record)}
        />

        <ClassificationPanel
          active={controller.activeTab() === "rules"}
          controller={controller.classification}
        />
      </main>
    </div>
  );
}
