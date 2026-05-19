import { createSignal } from "solid-js";
import type { ActivitySample } from "../../shared/types";
import type { DashboardClient } from "./tauri-bridge";
import { getCurrentUtcDateString } from "./helpers";

type UseTimelineControllerProps = {
  rpc: DashboardClient;
};

export type TimelineController = {
  recentWindows: () => ActivitySample[];
  hydrateTimeline: (samples: ActivitySample[] | null | undefined) => void;
  refreshTodayTimeline: () => Promise<void>;
};

export function useTimelineController(props: UseTimelineControllerProps): TimelineController {
  const [recentWindows, setRecentWindows] = createSignal<ActivitySample[]>([]);

  function hydrateTimeline(samples: ActivitySample[] | null | undefined): void {
    setRecentWindows(samples ?? []);
  }

  async function refreshTodayTimeline(): Promise<void> {
    try {
      const samples = await props.rpc.getTimeline(getCurrentUtcDateString());
      setRecentWindows(samples);
    } catch (error) {
      // Timeline is supplemental; keep the dashboard usable if this snapshot cannot load.
      console.warn("[dashboard] failed to load recent window timeline", error);
    }
  }

  return {
    recentWindows,
    hydrateTimeline,
    refreshTodayTimeline,
  };
}
