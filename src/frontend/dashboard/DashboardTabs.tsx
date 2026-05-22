import type { TabKey } from "./types";

type DashboardTabsProps = {
  activeTab: TabKey;
  onChange: (tab: TabKey) => void;
};

type DashboardTabItem = {
  key: TabKey;
  id: string;
  panelId: string;
  label: string;
  hint: string;
};

type DashboardTabGroup = {
  label: string;
  tabs: DashboardTabItem[];
};

const TAB_GROUPS: DashboardTabGroup[] = [
  {
    label: "Overview",
    tabs: [
      { key: "today", id: "tab-today", panelId: "panel-today", label: "Today", hint: "snapshot" },
      { key: "activity", id: "tab-activity", panelId: "panel-activity", label: "Activity", hint: "log" },
      { key: "statistics", id: "tab-statistics", panelId: "panel-statistics", label: "Statistics", hint: "range" },
    ],
  },
  {
    label: "Management",
    tabs: [
      { key: "rules", id: "tab-rules", panelId: "panel-rules", label: "Rules", hint: "automation" },
      { key: "memory", id: "tab-memory", panelId: "panel-memory", label: "Memory", hint: "notes" },
      { key: "settings", id: "tab-settings", panelId: "panel-settings", label: "Settings", hint: "prefs" },
    ],
  },
];

export function DashboardTabs(props: DashboardTabsProps) {
  return (
    <nav id="tab-bar" class="tab-rail" role="tablist" aria-label="Dashboard sections">
      {TAB_GROUPS.map((group) => (
        <div class="tab-group" role="presentation">
          <p class="tab-group-label">{group.label}</p>
          <div class="tab-group-rail">
            {group.tabs.map((tab) => (
              <button
                id={tab.id}
                class={`tab-btn ${props.activeTab === tab.key ? "active" : ""}`}
                type="button"
                role="tab"
                aria-selected={props.activeTab === tab.key}
                aria-controls={tab.panelId}
                onClick={() => props.onChange(tab.key)}
              >
                <span class="tab-label">{tab.label}</span>
                <span class="tab-hint">{tab.hint}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}
