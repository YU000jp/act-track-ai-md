import { createSignal, onMount } from "solid-js";
import type { ActivitySample } from "../../shared/types";
import type { DashboardClient } from "./tauri-bridge";
import { createSubscriptionRegistrar, getCurrentUtcDateString } from "./helpers";

type UseTimelineControllerProps = {
  rpc: DashboardClient;
  subscribeActivityLogUpdates?: (listener: () => void) => Promise<() => void>;
};

export type TimelineController = {
  recentWindows: () => ActivitySample[];
  hydrateTimeline: (samples: ActivitySample[] | null | undefined) => void;
  refreshTodayTimeline: () => Promise<void>;
};

export function useTimelineController(props: UseTimelineControllerProps): TimelineController {
  const [recentWindows, setRecentWindows] = createSignal<ActivitySample[]>([]);
  const registerSubscriptionDispose = createSubscriptionRegistrar();

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

  onMount(() => {
    if (!props.subscribeActivityLogUpdates) {
      return;
    }

    void props.subscribeActivityLogUpdates(() => {
      void refreshTodayTimeline();
    }).then(registerSubscriptionDispose).catch((error) => {
      console.warn("[dashboard] failed to subscribe to activity log updates", error);
    });
  });

  return {
    recentWindows,
    hydrateTimeline,
    refreshTodayTimeline,
  };
}
