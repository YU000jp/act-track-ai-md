type StatisticsPanelProps = {
  active: boolean;
  weeklyHint?: string;
  monthlyHint?: string;
};

export function StatisticsPanel(props: StatisticsPanelProps) {
  return (
    <section id="panel-statistics" class={`panel ${props.active ? "active" : ""}`} aria-hidden={!props.active}>
      <div class="charts-grid">
        <div id="weekly-chart" class="card">
          <h3>Weekly Focus</h3>
          <div class="empty-state">{props.weeklyHint ?? "No weekly data yet"}</div>
        </div>
        <div id="monthly-trend" class="card">
          <h3>Monthly Trend</h3>
          <div class="empty-state">{props.monthlyHint ?? "No monthly trend yet"}</div>
        </div>
      </div>
    </section>
  );
}
