import { For, Show } from "solid-js";
import { ACTIVITY_CATEGORIES, type ActivityLogEntry } from "../../shared/types";
import { DashboardSurface } from "./DashboardSurface";
import { formatActivityDateTime, formatBrowserVisitUrl, formatDuration } from "./helpers";
import type { ActivityLogController } from "./useActivityLogController";

type ActivityLogPanelProps = {
  active: boolean;
  controller: ActivityLogController;
  browserHistoryRedactQuery: boolean;
};

function getEntryTone(entry: ActivityLogEntry): string {
  return entry.source === "browser" ? "neutral" : entry.category;
}

function getEntrySubtitle(entry: ActivityLogEntry): string {
  if (entry.source === "browser") {
    return [entry.browser, entry.profile].filter(Boolean).join(" / ") || "Browser visit";
  }

  return entry.appName;
}

function getEntryShare(entry: ActivityLogEntry, redactQuery: boolean): string {
  if (entry.source === "browser") {
    return formatBrowserVisitUrl(entry.url ?? "", redactQuery);
  }

  return entry.durationMs != null ? formatDuration(entry.durationMs) : entry.origin;
}

export function ActivityLogPanel(props: ActivityLogPanelProps) {
  const filters = () => props.controller.filters();
  const entries = () => props.controller.activityLogEntries();

  return (
    <section
      id="panel-activity"
      class={`panel panel-activity ${props.active ? "active" : ""}`}
      aria-hidden={!props.active}
      role="tabpanel"
      aria-labelledby="tab-activity"
    >
      <div class="panel-grid panel-grid-wide">
        <DashboardSurface
          eyebrow="Log"
          title="Unified activity log"
          description="Foreground samples and browser visits share one ordered timeline."
          class="surface-hero"
          actions={
            <button type="button" class="btn-ghost" onClick={() => props.controller.resetFilters()}>
              Reset filters
            </button>
          }
        >
          <div class="settings-grid settings-grid-compact activity-log-filters">
            <label class="activity-log-filter">
              <span>Date</span>
              <input
                type="date"
                value={filters().date}
                onInput={(event) => props.controller.setDate(event.currentTarget.value)}
              />
            </label>

            <label class="activity-log-filter">
              <span>Source</span>
              <select value={filters().source} onInput={(event) => props.controller.setSource(event.currentTarget.value as "" | "foreground" | "browser")}>
                <option value="">All sources</option>
                <option value="foreground">Foreground</option>
                <option value="browser">Browser</option>
              </select>
            </label>

            <label class="activity-log-filter">
              <span>Category</span>
              <select
                value={filters().category}
                onInput={(event) =>
                  props.controller.setCategory(event.currentTarget.value as "" | (typeof ACTIVITY_CATEGORIES)[number])
                }
              >
                <option value="">All categories</option>
                <For each={ACTIVITY_CATEGORIES}>
                  {(category) => <option value={category}>{category}</option>}
                </For>
              </select>
            </label>

            <label class="activity-log-filter">
              <span>Browser</span>
              <select value={filters().browser} onInput={(event) => props.controller.setBrowser(event.currentTarget.value)}>
                <option value="">All browsers</option>
                <option value="chrome">Chrome</option>
                <option value="edge">Edge</option>
                <option value="firefox">Firefox</option>
              </select>
            </label>

            <label class="activity-log-filter activity-log-filter-wide" style={{ "grid-column": "1 / -1" }}>
              <span>App / title search</span>
              <input
                type="search"
                value={filters().app}
                placeholder="Search app name, window title, or URL"
                onInput={(event) => props.controller.setApp(event.currentTarget.value)}
              />
            </label>
          </div>
        </DashboardSurface>

        <DashboardSurface
          eyebrow="Entries"
          title="Activity events"
          description="Use the filters above to focus on a specific source or app."
          class="surface-hero"
        >
          <div class="activity-log-meta">
            <span class="activity-log-meta-count">
              {props.controller.isLoading() ? "Refreshing log..." : `${entries().length} events matched`}
            </span>
            <span class="activity-log-meta-date">{filters().date}</span>
          </div>

          <Show when={entries().length > 0} fallback={<div class="empty-state">No activity events for the selected date.</div>}>
            <ul class="app-list app-list-compact">
              <For each={entries()}>
                {(entry) => (
                  <li class="app-item app-item-compact">
                    <div class="app-meta">
                      <span class={`app-dot ${getEntryTone(entry)}`}></span>
                      <div class="app-copy">
                        <strong class="app-name">{entry.title}</strong>
                        <span class="app-category">{getEntrySubtitle(entry)}</span>
                      </div>
                    </div>
                    <div class="app-stats">
                      <span class="app-duration">{formatActivityDateTime(entry.timestamp)}</span>
                      <span class="app-share">{getEntryShare(entry, props.browserHistoryRedactQuery)}</span>
                    </div>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </DashboardSurface>
      </div>
    </section>
  );
}
