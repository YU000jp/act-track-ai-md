import type { TabKey } from "./types";

type DashboardTabsProps = {
  activeTab: TabKey;
  onChange: (tab: TabKey) => void;
};

export function DashboardTabs(props: DashboardTabsProps) {
  return (
    <nav id="tab-bar" class="tab-rail" role="tablist" aria-label="Dashboard sections">
      <button
        id="tab-today"
        class={`tab-btn ${props.activeTab === "today" ? "active" : ""}`}
        type="button"
        role="tab"
        aria-selected={props.activeTab === "today"}
        aria-controls="panel-today"
        onClick={() => props.onChange("today")}
      >
        <span class="tab-label">Today</span>
        <span class="tab-hint">snapshot</span>
      </button>
      <button
        id="tab-statistics"
        class={`tab-btn ${props.activeTab === "statistics" ? "active" : ""}`}
        type="button"
        role="tab"
        aria-selected={props.activeTab === "statistics"}
        aria-controls="panel-statistics"
        onClick={() => props.onChange("statistics")}
      >
        <span class="tab-label">Statistics</span>
        <span class="tab-hint">composition</span>
      </button>
      <button
        id="tab-classification"
        class={`tab-btn ${props.activeTab === "classification" ? "active" : ""}`}
        type="button"
        role="tab"
        aria-selected={props.activeTab === "classification"}
        aria-controls="panel-classification"
        onClick={() => props.onChange("classification")}
      >
        <span class="tab-label">Classification</span>
        <span class="tab-hint">rules</span>
      </button>
      <button
        id="tab-memory"
        class={`tab-btn ${props.activeTab === "memory" ? "active" : ""}`}
        type="button"
        role="tab"
        aria-selected={props.activeTab === "memory"}
        aria-controls="panel-memory"
        onClick={() => props.onChange("memory")}
      >
        <span class="tab-label">Memory</span>
        <span class="tab-hint">notes</span>
      </button>
      <button
        id="tab-settings"
        class={`tab-btn ${props.activeTab === "settings" ? "active" : ""}`}
        type="button"
        role="tab"
        aria-selected={props.activeTab === "settings"}
        aria-controls="panel-settings"
        onClick={() => props.onChange("settings")}
      >
        <span class="tab-label">Settings</span>
        <span class="tab-hint">control plane</span>
      </button>
    </nav>
  );
}
