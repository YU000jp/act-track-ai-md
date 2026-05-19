import type { MemoryRecord, MemoryStatus } from "../../shared/types";
import { DashboardSurface } from "./DashboardSurface";
import { MemorySection } from "./MemorySection";

type MemoryPanelProps = {
  active: boolean;
  memoryStatus: MemoryStatus | null;
  memoryRecords: MemoryRecord[];
  onMemoryAction: (action: "pin" | "forget", record: MemoryRecord) => void;
};

export function MemoryPanel(props: MemoryPanelProps) {
  return (
    <section
      id="panel-memory"
      class={`panel panel-memory ${props.active ? "active" : ""}`}
      aria-hidden={!props.active}
      role="tabpanel"
      aria-labelledby="tab-memory"
    >
      <div class="panel-grid panel-grid-wide memory-grid">
        <DashboardSurface
          eyebrow="Memory"
          title="Pinned notes and recent feedback"
          description="Keep memory operations separate from settings so the control surface stays light."
          class="surface-hero memory-panel"
        >
          <MemorySection memoryStatus={props.memoryStatus} memoryRecords={props.memoryRecords} onMemoryAction={props.onMemoryAction} />
        </DashboardSurface>
      </div>
    </section>
  );
}
