import { createSignal } from "solid-js";
import type { RangeStatistics, StatisticsWindow, TodayStats, TopApp } from "./types";
import type { DashboardClient } from "./tauri-bridge";

const EMPTY_TODAY_STATS: TodayStats = {
  trackedMs: 0,
  productiveMs: 0,
  distractionMs: 0,
  neutralMs: 0,
};

type UseStatsControllerProps = {
  rpc: DashboardClient;
  reportError: (context: string, error: unknown) => void;
};

export type StatsController = {
  todayStats: () => TodayStats;
  topApps: () => TopApp[];
  rangeStats: () => RangeStatistics | null;
  rangeWindow: () => StatisticsWindow;
  rangeLoading: () => boolean;
  hydrateStats: (
    todayStats: TodayStats | null | undefined,
    topApps: TopApp[] | null | undefined,
    rangeStats: RangeStatistics | null | undefined,
    rangeWindow?: StatisticsWindow,
  ) => void;
  setRangeWindow: (rangeWindow: StatisticsWindow) => Promise<void>;
};

export function useStatsController(props: UseStatsControllerProps): StatsController {
  const [todayStats, setTodayStats] = createSignal<TodayStats>(EMPTY_TODAY_STATS);
  const [topApps, setTopApps] = createSignal<TopApp[]>([]);
  const [rangeStats, setRangeStats] = createSignal<RangeStatistics | null>(null);
  const [rangeWindow, setRangeWindowState] = createSignal<StatisticsWindow>(7);
  const [rangeLoading, setRangeLoading] = createSignal(false);
  let rangeRequestId = 0;

  function hydrateStats(
    nextTodayStats: TodayStats | null | undefined,
    nextTopApps: TopApp[] | null | undefined,
    nextRangeStats: RangeStatistics | null | undefined,
    nextRangeWindow: StatisticsWindow = 7,
  ): void {
    setTodayStats(nextTodayStats ?? EMPTY_TODAY_STATS);
    setTopApps(nextTopApps ?? []);
    setRangeStats(nextRangeStats ?? null);
    setRangeWindowState(nextRangeWindow);
    setRangeLoading(false);
  }

  async function refreshRangeStats(nextRangeWindow: StatisticsWindow): Promise<void> {
    const requestId = ++rangeRequestId;
    setRangeWindowState(nextRangeWindow);
    setRangeLoading(true);

    try {
      const snapshot = await props.rpc.getStatisticsSnapshot(nextRangeWindow);
      if (requestId !== rangeRequestId) {
        return;
      }

      setRangeStats(snapshot);
    } catch (error) {
      if (requestId === rangeRequestId) {
        props.reportError(`Failed to load ${nextRangeWindow}-day statistics`, error);
      }
    } finally {
      if (requestId === rangeRequestId) {
        setRangeLoading(false);
      }
    }
  }

  return {
    todayStats,
    topApps,
    rangeStats,
    rangeWindow,
    rangeLoading,
    hydrateStats,
    setRangeWindow: refreshRangeStats,
  };
}
