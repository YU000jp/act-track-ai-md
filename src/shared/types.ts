export const ACTIVITY_CATEGORIES = ["productive", "distraction", "neutral", "unknown"] as const;
export const STATISTICS_RANGES = [7, 14, 30] as const;

export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];
export type StatisticsRange = (typeof STATISTICS_RANGES)[number];
export type ClassificationRuleScope = "process" | "title" | "both";
export type ClassificationRuleMovePlacement = "before" | "after";

export type WindowSnapshot = {
  processName: string;
  windowTitle: string;
};

export type ClassificationRuleDraft = {
  processNamePattern: string;
  windowTitlePattern: string;
  category: ActivityCategory;
  label: string;
  enabled: boolean;
  scope: ClassificationRuleScope;
};

export type ClassificationRuleRecord = ClassificationRuleDraft & {
  id: number;
  priority: number;
  source: string;
  hitCount: number;
  lastUsedAt: number | null;
  createdAt: number;
  updatedAt: number;
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

export type StatisticsDaySummary = {
  date: string;
  trackedMs: number;
  productiveMs: number;
  distractionMs: number;
  neutralMs: number;
};

export type StatisticsSnapshot = {
  rangeDays: number;
  startDate: string;
  endDate: string;
  trackedMs: number;
  productiveMs: number;
  distractionMs: number;
  neutralMs: number;
  activeDays: number;
  dailyBreakdown: StatisticsDaySummary[];
  topApps: Array<{ processName: string; durationMs: number; category: ActivityCategory }>;
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

export type SummaryGenerationReport = {
  summary: DailySummary;
  aiSummaryError?: import("./app-error").AppErrorPayload;
};

export type DashboardBootstrapSnapshot = {
  todaySummary: {
    trackedMs: number;
    productiveMs: number;
    distractionMs: number;
    neutralMs: number;
  };
  topApps: Array<{ processName: string; durationMs: number; category: ActivityCategory }>;
  statisticsSnapshot: StatisticsSnapshot;
  classificationRules: ClassificationRuleRecord[];
  settings: AppSettings;
  trackingStatus: TrackingStatus;
  dailySummary: DailySummary | null;
  memoryStatus: MemoryStatus;
  memoryRecords: MemoryRecord[];
};

export type MemorySnapshot = {
  memoryStatus: MemoryStatus;
  memoryRecords: MemoryRecord[];
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
    getStatisticsSnapshot: (rangeDays?: StatisticsRange) => Promise<StatisticsSnapshot>;
    getTimeline: (date: string) => Promise<ActivitySample[]>;
    getDailySummary: (date: string) => Promise<DailySummary | null>;
    getSettings: () => Promise<AppSettings>;
    getTrackingStatus: () => Promise<TrackingStatus>;
    getDashboardBootstrap: () => Promise<DashboardBootstrapSnapshot>;
    getClassificationRules: () => Promise<ClassificationRuleRecord[]>;
    saveClassificationRule: (input: { id?: number; rule: ClassificationRuleDraft }) => Promise<ClassificationRuleRecord>;
    deleteClassificationRule: (input: { id: number }) => Promise<void>;
    setClassificationRuleEnabled: (input: { id: number; enabled: boolean }) => Promise<ClassificationRuleRecord>;
    moveClassificationRule: (input: { id: number; direction: "up" | "down" }) => Promise<ClassificationRuleRecord>;
    reorderClassificationRule: (input: { id: number; targetId: number; placement: ClassificationRuleMovePlacement }) => Promise<ClassificationRuleRecord>;
    setSetting: (input: { key: string; value: string }) => Promise<void>;
    setSettings: (input: { settings: AppSettingsUpdate; geminiApiKey?: string }) => Promise<void>;
    getSetting: (key: string) => Promise<string | null>;
    generateSummaryNow: () => Promise<SummaryGenerationReport>;
    saveSummaryFeedback: (input: { date: string; editedSummary: string; originalSummary?: string | null }) => Promise<void>;
    getMemoryStatus: () => Promise<MemoryStatus>;
    listMemories: (limit?: number) => Promise<MemoryRecord[]>;
    getMemorySnapshot: (limit?: number) => Promise<MemorySnapshot>;
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
  dashboardBootstrapTimeoutMs: number;
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
  dashboardBootstrapTimeoutMs: 5000,
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
