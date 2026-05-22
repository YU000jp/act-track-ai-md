import { batch, createSignal, onMount } from "solid-js";
import type { ActivityLogEntry, ActivityLogQuery } from "../../shared/types";
import type { DashboardClient } from "./tauri-bridge";
import { createSubscriptionRegistrar, getCurrentUtcDateString } from "./helpers";
import type {
  ActivityLogFilters,
  ActivityLogSourceFilter,
  ActivityLogEntryView,
} from "./types";
import type { DashboardToast } from "./types";

type UseActivityLogControllerProps = {
  rpc: Pick<DashboardClient, "getActivityLog">;
  reportError: (context: string, error: unknown) => void;
  pushToast: (kind: DashboardToast["kind"], title: string, message: string) => void;
  subscribeActivityLogUpdates?: (listener: () => void) => Promise<() => void>;
  subscribeBrowserHistoryUpdates?: (listener: () => void) => Promise<() => void>;
};

export type ActivityLogController = {
  activityLogEntries: () => ActivityLogEntryView[];
  filters: () => ActivityLogFilters;
  isLoading: () => boolean;
  refreshActivityLog: () => Promise<void>;
  setDate: (date: string) => void;
  setSource: (source: ActivityLogSourceFilter) => void;
  setApp: (app: string) => void;
  setCategory: (category: ActivityLogFilters["category"]) => void;
  setBrowser: (browser: string) => void;
  resetFilters: () => void;
};

function createDefaultFilters(): ActivityLogFilters {
  return {
    date: getCurrentUtcDateString(),
    source: "",
    app: "",
    category: "",
    browser: "",
  };
}

function buildActivityLogQuery(filters: ActivityLogFilters): ActivityLogQuery {
  return {
    date: filters.date,
    source: filters.source || undefined,
    app: filters.app.trim() || undefined,
    category: filters.category || undefined,
    browser: filters.browser.trim() || undefined,
    limit: 200,
  };
}

export function useActivityLogController(
  props: UseActivityLogControllerProps,
): ActivityLogController {
  const [activityLogEntries, setActivityLogEntries] = createSignal<ActivityLogEntryView[]>([]);
  const [filters, setFilters] = createSignal<ActivityLogFilters>(createDefaultFilters());
  const [isLoading, setIsLoading] = createSignal(false);
  let refreshRequestId = 0;
  const registerSubscriptionDispose = createSubscriptionRegistrar();

  async function refreshActivityLog(): Promise<void> {
    const requestId = ++refreshRequestId;
    const nextFilters = filters();
    setIsLoading(true);

    try {
      const entries = await props.rpc.getActivityLog(buildActivityLogQuery(nextFilters));
      if (requestId !== refreshRequestId) {
        return;
      }

      setActivityLogEntries(entries);
    } catch (error) {
      if (requestId === refreshRequestId) {
        props.reportError("Failed to load activity log", error);
        props.pushToast("error", "Activity log", "Could not refresh the activity log.");
      }
    } finally {
      if (requestId === refreshRequestId) {
        setIsLoading(false);
      }
    }
  }

  function updateFilters(next: Partial<ActivityLogFilters>): void {
    batch(() => {
      setFilters((current) => ({ ...current, ...next }));
    });
    void refreshActivityLog();
  }

  function resetFilters(): void {
    batch(() => {
      setFilters(createDefaultFilters());
    });
    void refreshActivityLog();
  }

  onMount(() => {
    void refreshActivityLog();

    if (props.subscribeActivityLogUpdates) {
      void props.subscribeActivityLogUpdates(() => {
        void refreshActivityLog();
      })
        .then(registerSubscriptionDispose)
        .catch((error) => {
          console.warn("[dashboard] failed to subscribe to activity log updates", error);
        });
    }

    if (props.subscribeBrowserHistoryUpdates) {
      void props.subscribeBrowserHistoryUpdates(() => {
        void refreshActivityLog();
      })
        .then(registerSubscriptionDispose)
        .catch((error) => {
          console.warn("[dashboard] failed to subscribe to browser history updates", error);
        });
    }
  });

  return {
    activityLogEntries,
    filters,
    isLoading,
    refreshActivityLog,
    setDate: (date) => updateFilters({ date }),
    setSource: (source) => updateFilters({ source }),
    setApp: (app) => updateFilters({ app }),
    setCategory: (category) => updateFilters({ category }),
    setBrowser: (browser) => updateFilters({ browser }),
    resetFilters,
  };
}
