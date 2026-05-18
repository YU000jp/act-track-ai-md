import { createSignal } from "solid-js";
import type { MemoryRecord, MemoryStatus } from "../../shared/types";
import type { DashboardClient } from "./tauri-bridge";
import type { DashboardToast } from "./types";

type UseMemoryControllerProps = {
  rpc: DashboardClient;
  reportError: (context: string, error: unknown) => void;
  pushToast: (kind: DashboardToast["kind"], title: string, message: string) => void;
};

export type MemoryController = {
  memoryStatus: () => MemoryStatus | null;
  memoryRecords: () => MemoryRecord[];
  hydrateMemory: (status: MemoryStatus, records: MemoryRecord[]) => void;
  refreshMemorySnapshot: () => Promise<void>;
  handleMemoryAction: (action: "pin" | "forget", record: MemoryRecord) => Promise<void>;
};

export function useMemoryController(props: UseMemoryControllerProps): MemoryController {
  const [memoryStatus, setMemoryStatus] = createSignal<MemoryStatus | null>(null);
  const [memoryRecords, setMemoryRecords] = createSignal<MemoryRecord[]>([]);

  function hydrateMemory(status: MemoryStatus, records: MemoryRecord[]): void {
    setMemoryStatus(status);
    setMemoryRecords(records);
  }

  async function refreshMemorySnapshot(): Promise<void> {
    const [status, records] = await Promise.all([props.rpc.getMemoryStatus(), props.rpc.listMemories(10)]);
    setMemoryStatus(status);
    setMemoryRecords(records);
  }

  async function handleMemoryAction(action: "pin" | "forget", record: MemoryRecord): Promise<void> {
    try {
      if (action === "forget") {
        await props.rpc.forgetMemory(record.id);
      } else {
        await props.rpc.pinMemory({ id: record.id, pinned: !record.pinned });
      }

      await refreshMemorySnapshot();
      props.pushToast("success", "Memory updated", "The memory list was refreshed.");
    } catch (error) {
      props.reportError("Failed to update memory", error);
    }
  }

  return {
    memoryStatus,
    memoryRecords,
    hydrateMemory,
    refreshMemorySnapshot,
    handleMemoryAction,
  };
}
