type DashboardMetricTone = "neutral" | "productive" | "distraction" | "accent";

type DashboardMetricCardProps = {
  label: string;
  value: string;
  note?: string;
  tone?: DashboardMetricTone;
};

export function DashboardMetricCard(props: DashboardMetricCardProps) {
  return (
    <article class={`metric-card ${props.tone ? `metric-card-${props.tone}` : ""}`.trim()}>
      <div class="metric-label">{props.label}</div>
      <div class="metric-value">{props.value}</div>
      {props.note ? <div class="metric-note">{props.note}</div> : null}
    </article>
  );
}
