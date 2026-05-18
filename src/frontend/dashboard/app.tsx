import type { TrackingStatus } from "../../shared/types";
import type { DashboardClient } from "./tauri-bridge";
import { DashboardTabs } from "./DashboardTabs";
import { ErrorBanner } from "./ErrorBanner";
import { SettingsPanel } from "./SettingsPanel";
import { StatisticsPanel } from "./StatisticsPanel";
import { TodayPanel } from "./TodayPanel";
import { ToastRegion } from "./ToastRegion";
import { useDashboardController } from "./useDashboardController";

type AppProps = {
  rpc: DashboardClient;
  subscribeTrackingStatus?: (listener: (status: TrackingStatus) => void) => Promise<() => void>;
};

export function App(props: AppProps) {
  const controller = useDashboardController({
    rpc: props.rpc,
    subscribeTrackingStatus: props.subscribeTrackingStatus,
  });

  return (
    <div id="app" class="dashboard">
      <header class="header">
        <img src="./icon.png" alt="ActTrack icon" />
        <h1 class="title">{controller.dashboardTitle}</h1>
      </header>

      <ErrorBanner errorState={controller.errorState()} />
      <ToastRegion toasts={controller.toasts()} />
      <DashboardTabs activeTab={controller.activeTab()} onChange={controller.setActiveTab} />

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

      <StatisticsPanel active={controller.activeTab() === "statistics"} />

      <SettingsPanel
        active={controller.activeTab() === "settings"}
        settings={controller.settings()}
        trackingStatus={controller.trackingStatus()}
        geminiApiKey={controller.geminiApiKey()}
        settingsFeedback={controller.settingsFeedback()}
        onSettingsSubmit={controller.saveSettings}
        onSettingChange={controller.onSettingChange}
        onGeminiApiKeyChange={controller.setGeminiApiKey}
        memoryStatus={controller.memoryStatus()}
        memoryRecords={controller.memoryRecords()}
        onMemoryAction={(action, record) => void controller.handleMemoryAction(action, record)}
      />
    </div>
  );
}
