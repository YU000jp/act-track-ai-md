import { For, Show } from "solid-js";
import { formatDuration, formatPercent } from "./helpers";
import type { TodayStats, TopApp } from "./types";
import { SummaryFeedbackSection } from "./SummaryFeedbackSection";

type TodayPanelProps = {
  active: boolean;
  todayStats: TodayStats;
  topApps: TopApp[];
  summaryFeedback: string;
  summaryFeedbackStatus: string;
  onSummaryFeedbackChange: (value: string) => void;
  onGenerateSummaryNow: () => void;
  onSaveSummaryFeedback: () => void;
};

export function TodayPanel(props: TodayPanelProps) {
  return (
    <section id="panel-today" class={`panel ${props.active ? "active" : ""}`} aria-hidden={!props.active}>
      <div id="today-stats" class="stats-layout">
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">Total Tracked</div>
            <div class="stat-value">{formatDuration(props.todayStats.trackedMs)}</div>
          </div>
          <div class="stat-card productive">
            <div class="stat-label">Productive</div>
            <div class="stat-value">{formatDuration(props.todayStats.productiveMs)}</div>
            <div class="stat-pct">{formatPercent(props.todayStats.productiveMs, props.todayStats.trackedMs)}%</div>
          </div>
          <div class="stat-card distraction">
            <div class="stat-label">Distraction</div>
            <div class="stat-value">{formatDuration(props.todayStats.distractionMs)}</div>
            <div class="stat-pct">{formatPercent(props.todayStats.distractionMs, props.todayStats.trackedMs)}%</div>
          </div>
          <div class="stat-card neutral">
            <div class="stat-label">Neutral</div>
            <div class="stat-value">{formatDuration(props.todayStats.neutralMs)}</div>
            <div class="stat-pct">{formatPercent(props.todayStats.neutralMs, props.todayStats.trackedMs)}%</div>
          </div>
        </div>
      </div>

      <div id="top-apps" class="card">
        <Show when={props.topApps.length > 0} fallback={<div class="empty-state">No activity tracked yet</div>}>
          <h3>Top Apps</h3>
          <ul class="app-list">
            <For each={props.topApps}>
              {(app) => (
                <li class="app-item">
                  <span class={`app-dot ${app.category}`}></span>
                  <span class="app-name">{app.processName}</span>
                  <span class="app-duration">{formatDuration(app.durationMs)}</span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>

      <SummaryFeedbackSection
        summaryFeedback={props.summaryFeedback}
        summaryFeedbackStatus={props.summaryFeedbackStatus}
        onSummaryFeedbackChange={props.onSummaryFeedbackChange}
        onGenerateSummaryNow={props.onGenerateSummaryNow}
        onSaveSummaryFeedback={props.onSaveSummaryFeedback}
      />
    </section>
  );
}
