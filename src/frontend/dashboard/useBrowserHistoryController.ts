import { createSignal } from "solid-js";
import type { BrowserVisit } from "../../shared/types";
import type { DashboardClient } from "./tauri-bridge";
import type { DashboardToast } from "./types";

type UseBrowserHistoryControllerProps = {
  rpc: DashboardClient;
  reportError: (context: string, error: unknown) => void;
  pushToast: (kind: DashboardToast["kind"], title: string, message: string) => void;
};

export type BrowserHistoryController = {
  browserVisits: () => BrowserVisit[];
  hydrateBrowserVisits: (visits: BrowserVisit[] | null | undefined) => void;
  refreshBrowserVisits: () => Promise<void>;
};

export function useBrowserHistoryController(
  props: UseBrowserHistoryControllerProps,
): BrowserHistoryController {
  const [browserVisits, setBrowserVisits] = createSignal<BrowserVisit[]>([]);

  function hydrateBrowserVisits(visits: BrowserVisit[] | null | undefined): void {
    setBrowserVisits(visits ?? []);
  }

  async function refreshBrowserVisits(): Promise<void> {
    try {
      const visits = await props.rpc.getBrowserVisits(12);
      setBrowserVisits(visits);
    } catch (error) {
      // Browser history is supplemental; keep the dashboard usable if the local history DB is busy.
      props.reportError("Failed to load browser history", error);
      props.pushToast("error", "Browser history", "Could not refresh browser history.");
    }
  }

  return {
    browserVisits,
    hydrateBrowserVisits,
    refreshBrowserVisits,
  };
}
