import { createSignal, onCleanup, onMount } from "solid-js";
import type { TrackingStatus } from "../../shared/types";
import type { DashboardClient } from "./tauri-bridge";

type UseTrackingControllerProps = {
  rpc: Pick<DashboardClient, "toggleTracking">;
  subscribeTrackingStatus?: (listener: (status: TrackingStatus) => void) => Promise<() => void>;
};

export type TrackingController = {
  trackingStatus: () => TrackingStatus;
  isTogglingTracking: () => boolean;
  hydrateTracking: (status: TrackingStatus) => void;
  toggleTracking: () => Promise<void>;
};

const EMPTY_TRACKING_STATUS: TrackingStatus = {
  running: false,
  state: "paused",
};

export function useTrackingController(props: UseTrackingControllerProps): TrackingController {
  const [trackingStatus, setTrackingStatus] = createSignal<TrackingStatus>(EMPTY_TRACKING_STATUS);
  const [isTogglingTracking, setIsTogglingTracking] = createSignal(false);
  let disposeTrackingListener: (() => void) | undefined;

  function hydrateTracking(status: TrackingStatus): void {
    setTrackingStatus(status);
  }

  async function toggleTracking(): Promise<void> {
    if (isTogglingTracking()) {
      return;
    }

    setIsTogglingTracking(true);
    try {
      const running = await props.rpc.toggleTracking();
      setTrackingStatus((current) => ({
        ...current,
        running,
        state: running ? "productive" : "paused",
      }));
    } finally {
      setIsTogglingTracking(false);
    }
  }

  onMount(() => {
    if (props.subscribeTrackingStatus) {
      void props.subscribeTrackingStatus((status: TrackingStatus) => {
        setTrackingStatus(status);
      }).then((dispose) => {
        disposeTrackingListener = dispose;
      });
    }

    onCleanup(() => {
      disposeTrackingListener?.();
    });
  });

  return {
    trackingStatus,
    isTogglingTracking,
    hydrateTracking,
    toggleTracking,
  };
}
