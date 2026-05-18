import type { TabKey } from "./types";

type DashboardTabsProps = {
  activeTab: TabKey;
  onChange: (tab: TabKey) => void;
};

export function DashboardTabs(props: DashboardTabsProps) {
  return (
    <nav id="tab-bar" aria-label="Dashboard tabs">
      <button class={`tab-btn ${props.activeTab === "today" ? "active" : ""}`} type="button" onClick={() => props.onChange("today")}>
        Today
      </button>
      <button class={`tab-btn ${props.activeTab === "statistics" ? "active" : ""}`} type="button" onClick={() => props.onChange("statistics")}>
        Statistics
      </button>
      <button class={`tab-btn ${props.activeTab === "settings" ? "active" : ""}`} type="button" onClick={() => props.onChange("settings")}>
        Settings
      </button>
    </nav>
  );
}
