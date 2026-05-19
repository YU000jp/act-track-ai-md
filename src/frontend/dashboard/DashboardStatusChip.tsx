type DashboardStatusChipTone = "neutral" | "success" | "warning" | "danger" | "accent";

type DashboardStatusChipProps = {
  label: string;
  value: string;
  tone?: DashboardStatusChipTone;
};

export function DashboardStatusChip(props: DashboardStatusChipProps) {
  return (
    <span class={`status-chip ${props.tone ? `status-chip-${props.tone}` : ""}`.trim()}>
      <span class="status-chip-label">{props.label}</span>
      <span class="status-chip-value">{props.value}</span>
    </span>
  );
}
