import { createSignal, onCleanup, onMount } from "solid-js";
import type { TrackingStatus } from "../../shared/types";

type UseTrackingControllerProps = {
  subscribeTrackingStatus?: (listener: (status: TrackingStatus) => void) => Promise<() => void>;
};

export type TrackingController = {
  trackingStatus: () => TrackingStatus;
  hydrateTracking: (status: TrackingStatus) => void;
};

const EMPTY_TRACKING_STATUS: TrackingStatus = {
  running: false,
  state: "paused",
};

export function useTrackingController(props: UseTrackingControllerProps): TrackingController {
  const [trackingStatus, setTrackingStatus] = createSignal<TrackingStatus>(EMPTY_TRACKING_STATUS);
  let disposeTrackingListener: (() => void) | undefined;

  function hydrateTracking(status: TrackingStatus): void {
    setTrackingStatus(status);
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
    hydrateTracking,
  };
}
