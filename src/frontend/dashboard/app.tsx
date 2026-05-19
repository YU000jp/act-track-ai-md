import type { TrackingStatus } from "../../shared/types";
import type { MemoryStatus } from "../../shared/types";
import type { DashboardClient } from "./tauri-bridge";
import { DashboardTabs } from "./DashboardTabs";
import { ErrorBanner } from "./ErrorBanner";
import { DashboardStatusChip } from "./DashboardStatusChip";
import { SettingsPanel } from "./SettingsPanel";
import { StatisticsPanel } from "./StatisticsPanel";
import { TodayPanel } from "./TodayPanel";
import { ToastRegion } from "./ToastRegion";
import { useDashboardController } from "./useDashboardController";
import { subscribeGeminiApiKeySettings } from "./tauri-bridge";

type AppProps = {
  rpc: DashboardClient;
  subscribeTrackingStatus?: (listener: (status: TrackingStatus) => void) => Promise<() => void>;
};

function describeTrackingState(status: TrackingStatus): string {
  if (!status.running) {
    return "Paused";
  }

  switch (status.state) {
    case "productive":
      return "Tracking productive";
    case "distracted":
      return "Tracking distracted";
    case "idle":
      return "Tracking idle";
    default:
      return "Tracking live";
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

export function App(props: AppProps) {
  const controller = useDashboardController({
    rpc: props.rpc,
    subscribeTrackingStatus: props.subscribeTrackingStatus,
    subscribeGeminiApiKeySettings,
  });

  const trackingStatus = controller.trackingStatus;
  const memoryStatus = controller.memoryStatus;
  const settings = controller.settings;

  return (
    <div class={`dashboard-shell ${controller.isHydrated() ? "is-hydrated" : "is-loading"}`}>
      <div class="dashboard-glow dashboard-glow-a" aria-hidden="true"></div>
      <div class="dashboard-glow dashboard-glow-b" aria-hidden="true"></div>

      <header class="dashboard-hero">
        <div class="brand-block">
          <img class="brand-mark" src="./icon.png" alt="ActTrack icon" />
          <div class="brand-copy">
            <p class="eyebrow">ActTrack AI MD</p>
            <h1>{controller.dashboardTitle}</h1>
            <p class="hero-description">
              A focused control center for tracking, summaries, and memory operations.
            </p>
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
            value={describeMemoryStatus(memoryStatus())}
            tone={memoryStatus()?.enabled ? "accent" : "neutral"}
          />
          <DashboardStatusChip
            label="Gemini"
            value={settings().geminiApiKeyConfigured ? "Configured" : "Not set"}
            tone={settings().geminiApiKeyConfigured ? "success" : "warning"}
          />
          {controller.errorState() ? (
            <DashboardStatusChip label="Sync" value="Needs attention" tone="danger" />
          ) : null}
        </div>
      </header>

      <ErrorBanner errorState={controller.errorState()} />
      <ToastRegion toasts={controller.toasts()} />

      <main class="dashboard-workspace">
        <div class="workspace-header">
          <DashboardTabs activeTab={controller.activeTab()} onChange={controller.setActiveTab} />
          <p class="workspace-hint">
            {controller.isHydrated() ? "Live snapshot ready" : "Loading dashboard snapshot..."}
          </p>
        </div>

        <TodayPanel
          active={controller.activeTab() === "today"}
          todayStats={controller.todayStats()}
          topApps={controller.topApps()}
          summaryFeedback={controller.summaryFeedback()}
          summaryFeedbackStatus={controller.summaryFeedbackStatus()}
          onSummaryFeedbackChange={controller.setSummaryFeedback}
          onGenerateSummaryNow={() => void controller.generateSummaryNow()}
          onSaveSummaryFeedback={() => void controller.saveSummaryFeedback()}
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
          memoryStatus={memoryStatus()}
          memoryRecords={controller.memoryRecords()}
          onMemoryAction={(action, record) => void controller.handleMemoryAction(action, record)}
        />
      </main>
    </div>
  );
}
