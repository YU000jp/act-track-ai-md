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
  source: "cache" | "gemini" | "rule" | "fallback";
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

export type MemoryStatus = {
  enabled: boolean;
  backend: "agentkits" | "sqlite";
  total: number;
  pinned: number;
};

export type MemoryRecord = {
  id: number;
  type: "pattern" | "context" | "feedback" | "observation";
  content: string;
  metadata: Record<string, string>;
  pinned: boolean;
  createdAt: number;
};

export type TrackingState = "productive" | "distracted" | "idle" | "paused";

export type TrackingStatus = {
  running: boolean;
  state: TrackingState;
};

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
    getSettings: () => Promise<AppSettings>;
    getTrackingStatus: () => Promise<TrackingStatus>;
    setSetting: (input: { key: string; value: string }) => Promise<void>;
    setSettings: (input: { settings: AppSettingsUpdate; geminiApiKey?: string }) => Promise<void>;
    getSetting: (key: string) => Promise<string | null>;
    generateSummaryNow: () => Promise<void>;
    saveSummaryFeedback: (input: { date: string; editedSummary: string; originalSummary?: string | null }) => Promise<void>;
    getMemoryStatus: () => Promise<MemoryStatus>;
    listMemories: (limit?: number) => Promise<MemoryRecord[]>;
    forgetMemory: (id: number) => Promise<void>;
    pinMemory: (input: { id: number; pinned: boolean }) => Promise<void>;
    toggleTracking: () => Promise<boolean>;
  };
  messages: {
    trackingStatus: (payload: { running: boolean; state: TrackingState }) => void;
  };
};

export type AppSettings = {
  geminiApiKeyConfigured: boolean;
  pollIntervalMs: number;
  idleTimeoutMs: number;
  notificationCooldownMs: number;
  gracePeriodMs: number;
  markdownExportPath: string;
  notificationsEnabled: boolean;
  autoStart: boolean;
  classificationRulesJson: string;
  summaryLanguage: string;
  summaryTone: string;
  markdownPrivacyMode: boolean;
  startInBackground: boolean;
};

export type AppSettingsUpdate = Omit<AppSettings, "geminiApiKeyConfigured">;

export const DEFAULT_SETTINGS: AppSettings = {
  geminiApiKeyConfigured: false,
  pollIntervalMs: 3000,
  idleTimeoutMs: 300_000,
  notificationCooldownMs: 300_000,
  gracePeriodMs: 30_000,
  markdownExportPath: "",
  notificationsEnabled: true,
  autoStart: false,
  classificationRulesJson: "",
  summaryLanguage: "Japanese",
  summaryTone: "encouraging",
  markdownPrivacyMode: false,
  startInBackground: true,
};
