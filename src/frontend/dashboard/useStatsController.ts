import { createSignal } from "solid-js";
import type { TodayStats, TopApp } from "./types";

const EMPTY_TODAY_STATS: TodayStats = {
  trackedMs: 0,
  productiveMs: 0,
  distractionMs: 0,
  neutralMs: 0,
};

export type StatsController = {
  todayStats: () => TodayStats;
  topApps: () => TopApp[];
  hydrateStats: (todayStats: TodayStats | null | undefined, topApps: TopApp[] | null | undefined) => void;
};

export function useStatsController(): StatsController {
  const [todayStats, setTodayStats] = createSignal<TodayStats>(EMPTY_TODAY_STATS);
  const [topApps, setTopApps] = createSignal<TopApp[]>([]);

  function hydrateStats(nextTodayStats: TodayStats | null | undefined, nextTopApps: TopApp[] | null | undefined): void {
    setTodayStats(nextTodayStats ?? EMPTY_TODAY_STATS);
    setTopApps(nextTopApps ?? []);
  }

  return {
    todayStats,
    topApps,
    hydrateStats,
  };
}
