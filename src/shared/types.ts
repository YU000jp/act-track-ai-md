export const ACTIVITY_CATEGORIES = ["productive", "distraction", "neutral", "unknown"] as const;

export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

export type WindowSnapshot = {
  processName: string;
  windowTitle: string;
};

export type ClassificationResult = {
  category: ActivityCategory;
  label: string;
  confidence: number;
  source: "cache" | "gemini" | "fallback";
};

export type ActivitySample = {
  id: number;
  timestamp: number;
  processName: string;
  windowTitle: string;
  durationMs: number;
  category: ActivityCategory;
  label: string;
};

export type DailySummary = {
  date: string;
  totalTrackedMs: number;
  productiveMs: number;
  distractionMs: number;
  neutralMs: number;
  topApps: Array<{ processName: string; durationMs: number; category: ActivityCategory }>;
  aiSummary: string | null;
};

export type TrackingState = "productive" | "distracted" | "idle" | "paused";

export type DashboardRPC = {
  requests: {
    getTodaySummary: () => Promise<{
      trackedMs: number;
      productiveMs: number;
      distractionMs: number;
      neutralMs: number;
    }>;
    getTopApps: () => Promise<Array<{ processName: string; durationMs: number; category: ActivityCategory }>>;
    getTimeline: (date: string) => Promise<ActivitySample[]>;
    getDailySummary: (date: string) => Promise<DailySummary | null>;
    setSetting: (input: { key: string; value: string }) => Promise<void>;
    getSetting: (key: string) => Promise<string | null>;
    generateSummaryNow: () => Promise<void>;
    toggleTracking: () => Promise<boolean>;
  };
  messages: {
    trackingStatus: (payload: { running: boolean; state: TrackingState }) => void;
  };
};

export type AppSettings = {
  geminiApiKey: string;
  pollIntervalMs: number;
  idleTimeoutMs: number;
  notificationCooldownMs: number;
  gracePeriodMs: number;
  notificationsEnabled: boolean;
  autoStart: boolean;
};

export const DEFAULT_SETTINGS: AppSettings = {
  geminiApiKey: "",
  pollIntervalMs: 3000,
  idleTimeoutMs: 300_000,
  notificationCooldownMs: 300_000,
  gracePeriodMs: 30_000,
  notificationsEnabled: true,
  autoStart: false,
};
