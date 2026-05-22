import { ACTIVITY_CATEGORIES, DEFAULT_SETTINGS, type ActivityCategory, type AppSettings, type ClassificationRuleDraft, type ClassificationRuleScope } from "./types"

export type ClassificationRule = ClassificationRuleDraft;

// Only settings that change the next launch behavior belong here.
export const RESTART_REQUIRED_SETTINGS: Array<keyof AppSettings> = [
  "startInBackground",
];

function parseBooleanSetting(value: string | null, fallback: boolean): boolean {
  if (value === null) {
    return fallback;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return fallback;
}

function parseNumberSetting(value: string | null, fallback: number, minValue = 0): number {
  if (value === null) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minValue) {
    return fallback;
  }

  return parsed;
}

export function loadAppSettings(
  getSetting: (key: keyof AppSettings) => string | null,
  geminiApiKeyConfigured: boolean,
): AppSettings {
  return {
    geminiApiKeyConfigured,
    dashboardBootstrapTimeoutMs: parseNumberSetting(
      getSetting("dashboardBootstrapTimeoutMs"),
      DEFAULT_SETTINGS.dashboardBootstrapTimeoutMs,
      1000,
    ),
    pollIntervalMs: parseNumberSetting(getSetting("pollIntervalMs"), DEFAULT_SETTINGS.pollIntervalMs, 1),
    idleTimeoutMs: parseNumberSetting(getSetting("idleTimeoutMs"), DEFAULT_SETTINGS.idleTimeoutMs, 1),
    notificationCooldownMs: parseNumberSetting(
      getSetting("notificationCooldownMs"),
      DEFAULT_SETTINGS.notificationCooldownMs,
      0,
    ),
    gracePeriodMs: parseNumberSetting(getSetting("gracePeriodMs"), DEFAULT_SETTINGS.gracePeriodMs, 0),
    markdownExportPath: getSetting("markdownExportPath") ?? DEFAULT_SETTINGS.markdownExportPath,
    notificationsEnabled: parseBooleanSetting(
      getSetting("notificationsEnabled"),
      DEFAULT_SETTINGS.notificationsEnabled,
    ),
    autoStart: parseBooleanSetting(getSetting("autoStart"), DEFAULT_SETTINGS.autoStart),
    classificationRulesJson: getSetting("classificationRulesJson") ?? DEFAULT_SETTINGS.classificationRulesJson,
    summaryLanguage: getSetting("summaryLanguage") ?? DEFAULT_SETTINGS.summaryLanguage,
    summaryTone: getSetting("summaryTone") ?? DEFAULT_SETTINGS.summaryTone,
    markdownPrivacyMode: parseBooleanSetting(
      getSetting("markdownPrivacyMode"),
      DEFAULT_SETTINGS.markdownPrivacyMode,
    ),
    startInBackground: parseBooleanSetting(
      getSetting("startInBackground"),
      DEFAULT_SETTINGS.startInBackground,
    ),
    browserHistoryEnabled: parseBooleanSetting(
      getSetting("browserHistoryEnabled"),
      DEFAULT_SETTINGS.browserHistoryEnabled,
    ),
    browserHistoryPollIntervalMs: parseNumberSetting(
      getSetting("browserHistoryPollIntervalMs"),
      DEFAULT_SETTINGS.browserHistoryPollIntervalMs,
      1000,
    ),
    browserHistoryRedactQuery: parseBooleanSetting(
      getSetting("browserHistoryRedactQuery"),
      DEFAULT_SETTINGS.browserHistoryRedactQuery,
    ),
  };
}

export function parseClassificationRules(raw: string | null | undefined): ClassificationRule[] {
  if (!raw?.trim()) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.flatMap((rule) => {
    if (typeof rule !== "object" || rule === null) {
      return [];
    }

    const candidate = rule as Record<string, unknown>;
    const processNamePattern =
      typeof candidate.processNamePattern === "string" ? candidate.processNamePattern.trim() : "";
    const windowTitlePattern =
      typeof candidate.windowTitlePattern === "string" ? candidate.windowTitlePattern.trim() : "";
    const category = candidate.category;
    const label = typeof candidate.label === "string" ? candidate.label.trim() : "";
    const enabled = typeof candidate.enabled === "boolean" ? candidate.enabled : true;
    const scope = parseClassificationRuleScope(candidate.scope, processNamePattern, windowTitlePattern);

    if (!processNamePattern && !windowTitlePattern) {
      return [];
    }

    if (typeof category !== "string" || !(ACTIVITY_CATEGORIES as readonly string[]).includes(category)) {
      return [];
    }

    if (!label) {
      return [];
    }

    return [
      {
        processNamePattern,
        windowTitlePattern,
        category: category as ActivityCategory,
        label,
        enabled,
        scope,
      },
    ];
  });
}

export function serializeClassificationRules(rules: ClassificationRule[]): string {
  return JSON.stringify(
    rules.map((rule) => ({
      processNamePattern: rule.processNamePattern,
      windowTitlePattern: rule.windowTitlePattern,
      category: rule.category,
      label: rule.label,
      enabled: rule.enabled,
      scope: rule.scope,
    })),
  );
}

function parseClassificationRuleScope(
  scope: unknown,
  processNamePattern: string,
  windowTitlePattern: string,
): ClassificationRuleScope {
  if (scope === "process" || scope === "title" || scope === "both") {
    return scope;
  }

  if (processNamePattern && windowTitlePattern) {
    return "both";
  }

  if (windowTitlePattern) {
    return "title";
  }

  return "process";
}
