import { loadAppSettings } from "../shared/settings";
import type { DashboardRPC } from "../shared/types";
import type { Datastores } from "./db";
import type { MemoryStore } from "../lib/memory";

function dayBoundsFromDate(date: string): { start: number; end: number } {
  const dayStart = new Date(`${date}T00:00:00`).getTime();
  return {
    start: dayStart,
    end: dayStart + 86_400_000,
  };
}

export function createRPCHandlers(
  datastores: Datastores,
  summarizer?: {
    generateDailySummary: (date: string) => Promise<void>;
    saveSummaryFeedback?: (input: { date: string; editedSummary: string; originalSummary?: string | null }) => Promise<void>;
  },
  memoryStore?: MemoryStore,
): DashboardRPC["requests"] {
  return {
    async getTodaySummary() {
      const today = new Date().toISOString().slice(0, 10);
      const stats = datastores.getStatsForDay(today);

      return {
        trackedMs: stats.totalTrackedMs,
        productiveMs: stats.productiveMs,
        distractionMs: stats.distractionMs,
        neutralMs: stats.neutralMs,
      };
    },

    async getTopApps() {
      const today = new Date().toISOString().slice(0, 10);
      return datastores.getTopAppsForDay(today, 10);
    },

    async getTimeline(date: string) {
      const { start, end } = dayBoundsFromDate(date);
      return datastores.getActivityRange(start, end);
    },

    async getDailySummary(date: string) {
      return datastores.getDailySummary(date);
    },

    async getSettings() {
      return loadAppSettings((key) => datastores.getSetting(key));
    },

    async setSetting(input) {
      datastores.setSetting(input.key, input.value);
    },

    async getSetting(key: string) {
      return datastores.getSetting(key);
    },

    async generateSummaryNow() {
      if (summarizer) {
        const today = new Date().toISOString().slice(0, 10);
        await summarizer.generateDailySummary(today);
      }
    },

    async saveSummaryFeedback(input) {
      if (summarizer?.saveSummaryFeedback) {
        await summarizer.saveSummaryFeedback(input);
      }
    },

    async getMemoryStatus() {
      if (!memoryStore) {
        return { enabled: false, backend: "sqlite", total: 0, pinned: 0 };
      }
      return memoryStore.getStatus();
    },

    async listMemories(limit = 20) {
      if (!memoryStore) {
        return [];
      }
      return memoryStore.recall(limit);
    },

    async forgetMemory(id) {
      if (!memoryStore) {
        return;
      }
      await memoryStore.forget(id);
    },

    async pinMemory(input) {
      if (!memoryStore) {
        return;
      }
      await memoryStore.pin(input.id, input.pinned);
    },

    async toggleTracking() {
      return false;
    },
  };
}
