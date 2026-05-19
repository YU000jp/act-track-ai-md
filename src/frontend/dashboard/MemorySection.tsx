import { For, Show } from "solid-js";
import type { MemoryRecord, MemoryStatus } from "../../shared/types";

type MemorySectionProps = {
  memoryStatus: MemoryStatus | null;
  memoryRecords: MemoryRecord[];
  onMemoryAction: (action: "pin" | "forget", record: MemoryRecord) => void;
};

function formatMemoryDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

export function MemorySection(props: MemorySectionProps) {
  return (
    <div class="memory-section">
      <div
        id="memory-status-indicator"
        class="settings-feedback memory-status"
        data-memory-enabled={props.memoryStatus?.enabled ? "true" : "false"}
      >
        <Show when={props.memoryStatus} fallback="Memory: loading...">
          {(status) =>
            status().enabled
              ? `Memory: ${status().total} entries (${status().pinned} pinned) - backend: ${status().backend}`
              : "Memory: disabled"
          }
        </Show>
      </div>

      <div id="memory-list-container">
        <Show when={props.memoryRecords.length > 0} fallback={<div class="empty-state">No memory entries yet.</div>}>
          <ul class="memory-list">
            <For each={props.memoryRecords}>
              {(record) => (
                <li class="memory-item" data-memory-id={record.id} data-memory-pinned={record.pinned ? "true" : "false"}>
                  <div class="memory-meta">
                    <span class="memory-type">{record.type}</span>
                    <span class="memory-date">{formatMemoryDate(record.createdAt)}</span>
                  </div>
                  <div class="memory-content">{record.content}</div>
                  <div class="memory-actions">
                    <button type="button" class="btn-ghost" onClick={() => props.onMemoryAction("pin", record)}>
                      {record.pinned ? "Unpin" : "Pin"}
                    </button>
                    <button type="button" class="btn-ghost" onClick={() => props.onMemoryAction("forget", record)}>
                      Forget
                    </button>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </div>
  );
}
