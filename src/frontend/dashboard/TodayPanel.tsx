import { For, Show } from "solid-js";
import { DashboardMetricCard } from "./DashboardMetricCard";
import { DashboardSurface } from "./DashboardSurface";
import { formatActivityTime, formatDuration, formatPercent } from "./helpers";
import type { ActivitySample } from "../../shared/types";
import type { TodayStats, TopApp } from "./types";
import { SummaryFeedbackSection } from "./SummaryFeedbackSection";

type TodayPanelProps = {
  active: boolean;
  todayStats: TodayStats;
  topApps: TopApp[];
  recentWindows: ActivitySample[];
  summaryFeedback: string;
  summaryFeedbackStatus: string;
  onSummaryFeedbackChange: (value: string) => void;
  onGenerateSummaryNow: () => void;
  onSaveSummaryFeedback: () => void;
  onCreateRuleFromWindow: (sample: ActivitySample) => void;
};

function getFocusRatio(todayStats: TodayStats): string {
  if (todayStats.trackedMs <= 0) {
    return "0%";
  }

  return `${formatPercent(todayStats.productiveMs, todayStats.trackedMs)}%`;
}

function getAppShare(durationMs: number, totalMs: number): string {
  if (totalMs <= 0) {
    return "0%";
  }

  return `${formatPercent(durationMs, totalMs)}%`;
}

export function TodayPanel(props: TodayPanelProps) {
  const totalTopAppsMs = () => props.topApps.reduce((total, app) => total + app.durationMs, 0);
  const recentWindows = () => [...props.recentWindows].slice(-6).reverse();

  return (
    <section id="panel-today" class={`panel panel-today ${props.active ? "active" : ""}`} aria-hidden={!props.active} role="tabpanel" aria-labelledby="tab-today">
      <div class="panel-grid panel-grid-2">
        <DashboardSurface
          eyebrow="Snapshot"
          title="Today's focus"
          description="A compact view of tracked time across the current day."
          class="surface-hero"
        >
          <div class="metric-grid">
            <DashboardMetricCard
              label="Tracked"
              value={formatDuration(props.todayStats.trackedMs)}
              note="Total recorded time today"
              tone="accent"
            />
            <DashboardMetricCard
              label="Productive"
              value={formatDuration(props.todayStats.productiveMs)}
              note={`Focus ratio ${getFocusRatio(props.todayStats)}`}
              tone="productive"
            />
            <DashboardMetricCard
              label="Distraction"
              value={formatDuration(props.todayStats.distractionMs)}
              note={`${formatPercent(props.todayStats.distractionMs, props.todayStats.trackedMs)}% of tracked time`}
              tone="distraction"
            />
            <DashboardMetricCard
              label="Neutral"
              value={formatDuration(props.todayStats.neutralMs)}
              note={`${formatPercent(props.todayStats.neutralMs, props.todayStats.trackedMs)}% of tracked time`}
              tone="neutral"
            />
          </div>

          <div class="summary-band">
            <div class="summary-band-item">
              <span class="summary-band-label">Focus ratio</span>
              <strong>{getFocusRatio(props.todayStats)}</strong>
              <span>Productive minutes relative to the total snapshot.</span>
            </div>
            <div class="summary-band-item">
              <span class="summary-band-label">Tracked state</span>
              <strong>{props.todayStats.trackedMs > 0 ? "Activity recorded" : "Waiting for data"}</strong>
              <span>{props.todayStats.trackedMs > 0 ? "Snapshot is ready to review." : "No activity has been captured yet."}</span>
            </div>
          </div>
        </DashboardSurface>

        <DashboardSurface
          eyebrow="Activity"
          title="Top apps"
          description="The apps consuming the most tracked time right now."
          class="surface-hero"
        >
          <Show when={props.topApps.length > 0} fallback={<div class="empty-state">No activity tracked yet.</div>}>
            <ul class="app-list app-list-compact">
              <For each={props.topApps}>
                {(app) => (
                  <li class="app-item app-item-compact">
                    <div class="app-meta">
                      <span class={`app-dot ${app.category}`}></span>
                      <div class="app-copy">
                        <strong class="app-name">{app.processName}</strong>
                        <span class="app-category">{app.category}</span>
                      </div>
                    </div>
                    <div class="app-stats">
                      <span class="app-duration">{formatDuration(app.durationMs)}</span>
                      <span class="app-share">{getAppShare(app.durationMs, totalTopAppsMs())}</span>
                    </div>
                    <div class="app-track">
                      <span
                        class={`app-track-fill ${app.category}`}
                        style={{ width: getAppShare(app.durationMs, totalTopAppsMs()) }}
                      ></span>
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
          eyebrow="Detail"
          title="Recent windows"
          description="The latest foreground samples, including the captured window title."
          class="surface-hero"
        >
          <Show when={props.recentWindows.length > 0} fallback={<div class="empty-state">No window samples tracked yet.</div>}>
            <ul class="app-list app-list-compact">
              <For each={recentWindows()}>
                {(sample) => (
                  <li class="app-item app-item-compact">
                    <div class="app-meta">
                      <span class={`app-dot ${sample.category}`}></span>
                      <div class="app-copy">
                        <strong class="app-name">{sample.windowTitle}</strong>
                        <span class="app-category">{sample.processName}</span>
                      </div>
                    </div>
                    <div class="app-stats">
                      <span class="app-duration">{formatActivityTime(sample.timestamp)}</span>
                      <span class="app-share">{sample.category}</span>
                    </div>
                    <div class="app-actions">
                      <button type="button" class="btn-ghost" onClick={() => props.onCreateRuleFromWindow(sample)}>
                        Create rule
                      </button>
                    </div>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </DashboardSurface>

        <SummaryFeedbackSection
          summaryFeedback={props.summaryFeedback}
          summaryFeedbackStatus={props.summaryFeedbackStatus}
          onSummaryFeedbackChange={props.onSummaryFeedbackChange}
          onGenerateSummaryNow={props.onGenerateSummaryNow}
          onSaveSummaryFeedback={props.onSaveSummaryFeedback}
        />
      </div>
    </section>
  );
}
