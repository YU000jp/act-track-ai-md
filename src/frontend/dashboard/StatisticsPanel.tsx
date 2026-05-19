import { For, Show } from "solid-js";
import { STATISTICS_RANGES } from "../../shared/types";
import { DashboardMetricCard } from "./DashboardMetricCard";
import { DashboardSurface } from "./DashboardSurface";
import { formatDuration, formatPercent } from "./helpers";
import type { RangeStatistics, StatisticsWindow } from "./types";

type StatisticsPanelProps = {
  active: boolean;
  statisticsSnapshot: RangeStatistics | null;
  selectedRange: StatisticsWindow;
  isLoading: boolean;
  onRangeChange: (range: StatisticsWindow) => Promise<void>;
};

function getTopAppTotal(topApps: RangeStatistics["topApps"]): number {
  return topApps.reduce((total, app) => total + app.durationMs, 0);
}

function formatRangeDay(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(value);
}

function getPeakDay(snapshot: RangeStatistics): RangeStatistics["dailyBreakdown"][number] | null {
  return snapshot.dailyBreakdown.reduce<RangeStatistics["dailyBreakdown"][number] | null>((best, day) => {
    if (!best || day.trackedMs > best.trackedMs) {
      return day;
    }
    return best;
  }, null);
}

export function StatisticsPanel(props: StatisticsPanelProps) {
  return (
    <section
      id="panel-statistics"
      class={`panel panel-statistics ${props.active ? "active" : ""}`}
      aria-hidden={!props.active}
      role="tabpanel"
      aria-labelledby="tab-statistics"
    >
      <Show
        when={props.statisticsSnapshot}
        fallback={
          <DashboardSurface
            eyebrow="Statistics"
            title="Range snapshot"
            description="Waiting for the aggregated dashboard snapshot to load."
            class="surface-hero"
          >
            <div class="empty-state">No statistics are available yet.</div>
          </DashboardSurface>
        }
      >
        {(snapshot) => {
          const summary = snapshot();
          const denseMode = summary.rangeDays >= 30;
          const totalTracked = () => summary.trackedMs;
          const focusShare = () => formatPercent(summary.productiveMs, totalTracked());
          const averagePerDay = () => (summary.rangeDays > 0 ? Math.round(totalTracked() / summary.rangeDays) : 0);
          const topAppTotal = () => getTopAppTotal(summary.topApps);
          const peak = getPeakDay(summary);

          return (
            <>
              <div class="panel-grid panel-grid-2">
                <DashboardSurface
                  eyebrow="Range"
                  title="Attention mix"
                  description={`Coverage from ${summary.startDate} through ${summary.endDate}. This view is backed by backend aggregation, not a frontend reconstruction.`}
                  class="surface-hero"
                >
                  <div class="range-selector" role="group" aria-label="Statistics range">
                    <div class="range-selector-label">
                      <span>Window</span>
                      <strong>{props.isLoading ? "Refreshing..." : `${summary.rangeDays} days`}</strong>
                    </div>
                    <div class="range-selector-rail">
                      <For each={STATISTICS_RANGES}>
                        {(range) => (
                          <button
                            type="button"
                            class={`range-selector-btn ${props.selectedRange === range ? "active" : ""}`}
                            aria-pressed={props.selectedRange === range}
                            disabled={props.isLoading && props.selectedRange !== range}
                            onClick={() => {
                              if (props.selectedRange !== range) {
                                void props.onRangeChange(range);
                              }
                            }}
                          >
                            {range}d
                          </button>
                        )}
                      </For>
                    </div>
                  </div>

                  <div class="metric-grid metric-grid-four">
                    <DashboardMetricCard
                      label="Tracked total"
                      value={formatDuration(summary.trackedMs)}
                      note={`${summary.activeDays} active days`}
                      tone="accent"
                    />
                    <DashboardMetricCard
                      label="Productive share"
                      value={`${formatPercent(summary.productiveMs, totalTracked())}%`}
                      note={formatDuration(summary.productiveMs)}
                      tone="productive"
                    />
                    <DashboardMetricCard
                      label="Average per day"
                      value={formatDuration(averagePerDay())}
                      note="Across the selected range"
                      tone="neutral"
                    />
                    <DashboardMetricCard
                      label="Focus rate"
                      value={`${focusShare()}%`}
                      note="Productive / tracked"
                      tone="productive"
                    />
                  </div>

                  <div class="balance-chart" aria-hidden="true">
                    <span
                      class="balance-segment balance-segment-productive"
                      style={{ width: `${formatPercent(summary.productiveMs, totalTracked())}%` }}
                    ></span>
                    <span
                      class="balance-segment balance-segment-distraction"
                      style={{ width: `${formatPercent(summary.distractionMs, totalTracked())}%` }}
                    ></span>
                    <span
                      class="balance-segment balance-segment-neutral"
                      style={{ width: `${formatPercent(summary.neutralMs, totalTracked())}%` }}
                    ></span>
                  </div>

                  <div class="summary-band">
                    <div class="summary-band-item">
                      <span class="summary-band-label">Peak day</span>
                      <strong>{peak ? formatRangeDay(peak.date) : "No activity yet"}</strong>
                      <span>{peak ? formatDuration(peak.trackedMs) : "Waiting for data"}</span>
                    </div>
                    <div class="summary-band-item">
                      <span class="summary-band-label">Dominant app</span>
                      <strong>{summary.topApps[0]?.processName ?? "No dominant app yet"}</strong>
                      <span>{summary.topApps[0] ? formatDuration(summary.topApps[0].durationMs) : "Waiting for data"}</span>
                    </div>
                  </div>
                </DashboardSurface>

                <DashboardSurface
                  eyebrow="Concentration"
                  title="Top app mix"
                  description="Apps ranked by total tracked time over the selected backend window."
                  class="surface-hero"
                >
                  <Show
                    when={summary.topApps.length > 0}
                    fallback={<div class="empty-state">No app activity available yet.</div>}
                  >
                    <ul class="concentration-list">
                      <For each={summary.topApps}>
                        {(app, index) => (
                          <li class="concentration-item">
                            <div class="concentration-copy">
                              <span class="concentration-rank">0{index() + 1}</span>
                              <div>
                                <strong>{app.processName}</strong>
                                <div class="concentration-category">{app.category}</div>
                              </div>
                            </div>
                            <div class="concentration-stats">
                              <span>{formatDuration(app.durationMs)}</span>
                              <span>{formatPercent(app.durationMs, topAppTotal())}%</span>
                            </div>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </DashboardSurface>
              </div>

              <div class="panel-grid panel-grid-wide">
                <DashboardSurface
                  eyebrow="Trend"
                  title="Daily cadence"
                  description="Every bar is rendered from the backend range summary, so the shell can expand without another UI rewrite."
                  class="surface-hero"
                >
                  <Show
                    when={summary.dailyBreakdown.length > 0}
                    fallback={<div class="empty-state">No daily trend data available yet.</div>}
                  >
                    <div class="trend-list">
                      <For each={summary.dailyBreakdown}>
                        {(day) => (
                          <div class={`trend-row ${denseMode ? "trend-row-compact" : ""}`}>
                            <div class="trend-copy">
                              <strong>{formatRangeDay(day.date)}</strong>
                              <Show when={!denseMode}>
                                <span>{day.date}</span>
                              </Show>
                            </div>
                            <div class="trend-bar" aria-hidden="true">
                              <span class="trend-bar-segment trend-bar-productive" style={{ width: `${formatPercent(day.productiveMs, day.trackedMs)}%` }} />
                              <span class="trend-bar-segment trend-bar-distraction" style={{ width: `${formatPercent(day.distractionMs, day.trackedMs)}%` }} />
                              <span class="trend-bar-segment trend-bar-neutral" style={{ width: `${formatPercent(day.neutralMs, day.trackedMs)}%` }} />
                            </div>
                            <div class="trend-stats">
                              <strong>{formatDuration(day.trackedMs)}</strong>
                              <Show when={!denseMode}>
                                <span>{formatPercent(day.productiveMs, day.trackedMs)}% productive</span>
                              </Show>
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </DashboardSurface>
              </div>
            </>
          );
        }}
      </Show>
    </section>
  );
}
