import { createSignal, onCleanup } from "solid-js";
import { DEFAULT_SETTINGS, type AppSettings, type AppSettingsUpdate } from "../../shared/types";
import type { DashboardClient } from "./tauri-bridge";
import { getRestartRequiredKeys } from "./helpers";
import type { DashboardToast } from "./types";

const CLASSIFICATION_RULES_JSON_SAVE_DELAY_MS = 600;
const GEMINI_API_KEY_SAVE_DELAY_MS = 800;

type UseSettingsControllerProps = {
  rpc: DashboardClient;
  reportError: (context: string, error: unknown) => void;
  pushToast: (kind: DashboardToast["kind"], title: string, message: string) => void;
};

export type SettingsController = {
  settings: () => AppSettings;
  geminiApiKey: () => string;
  settingsFeedback: () => string;
  setGeminiApiKey: (value: string) => void;
  setSettingsFeedback: (value: string) => void;
  onSettingChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  hydrateSettings: (settings: AppSettings) => void;
  saveSettings: (event: SubmitEvent) => Promise<boolean>;
};

export function useSettingsController(props: UseSettingsControllerProps): SettingsController {
  const [settings, setSettings] = createSignal<AppSettings>(DEFAULT_SETTINGS);
  const [baselineSettings, setBaselineSettings] = createSignal<AppSettings>(DEFAULT_SETTINGS);
  const [geminiApiKey, setGeminiApiKeyState] = createSignal("");
  const [settingsFeedback, setSettingsFeedback] = createSignal("");
  const pendingPersistTimers = new Map<string, number>();
  let disposed = false;

  onCleanup(() => {
    clearPendingPersistence();
    disposed = true;
  });

  function onSettingChange<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    setSettings((current) => ({
      ...current,
      [key]: value,
    }));

    if (key === "classificationRulesJson") {
      schedulePersist("classificationRulesJson", value as string, CLASSIFICATION_RULES_JSON_SAVE_DELAY_MS);
      return;
    }

    void props.rpc
      .setSetting({ key, value: serializeSettingValue(key, value) })
      .catch((error) => {
        if (!disposed) {
          props.reportError(`Failed to save ${String(key)}`, error);
        }
      });
  }

  function hydrateSettings(nextSettings: AppSettings): void {
    clearPendingPersistence();
    setSettings({ ...nextSettings });
    setBaselineSettings({ ...nextSettings });
    setGeminiApiKeyState("");
    setSettingsFeedback("");
  }

  async function saveSettings(event: SubmitEvent): Promise<boolean> {
    event.preventDefault();

    try {
      const currentSettings = settings();
      const geminiKey = geminiApiKey().trim();
      clearPendingPersistence();
      const settingsToSave: AppSettingsUpdate = {
        dashboardBootstrapTimeoutMs: currentSettings.dashboardBootstrapTimeoutMs,
        pollIntervalMs: currentSettings.pollIntervalMs,
        idleTimeoutMs: currentSettings.idleTimeoutMs,
        notificationCooldownMs: currentSettings.notificationCooldownMs,
        gracePeriodMs: currentSettings.gracePeriodMs,
        markdownExportPath: currentSettings.markdownExportPath,
        notificationsEnabled: currentSettings.notificationsEnabled,
        autoStart: currentSettings.autoStart,
        classificationRulesJson: currentSettings.classificationRulesJson,
        summaryLanguage: currentSettings.summaryLanguage,
        summaryTone: currentSettings.summaryTone,
        markdownPrivacyMode: currentSettings.markdownPrivacyMode,
        startInBackground: currentSettings.startInBackground,
        browserHistoryEnabled: currentSettings.browserHistoryEnabled,
        browserHistoryPollIntervalMs: currentSettings.browserHistoryPollIntervalMs,
        browserHistoryRedactQuery: currentSettings.browserHistoryRedactQuery,
      };

      await props.rpc.setSettings({ settings: settingsToSave, geminiApiKey: geminiKey || undefined });

      const persistedSettings: AppSettings = {
        ...currentSettings,
        geminiApiKeyConfigured: geminiKey ? true : currentSettings.geminiApiKeyConfigured,
      };
      const restartKeys = getRestartRequiredKeys(baselineSettings(), persistedSettings);

      setSettings(persistedSettings);
      setBaselineSettings(persistedSettings);
      setGeminiApiKey("");
      setSettingsFeedback(
        restartKeys.length > 0
          ? "Saved. Restart required for start-in-background changes."
          : "Saved. Changes are ready to use.",
      );
      props.pushToast(
        "success",
        "Settings saved",
        restartKeys.length > 0 ? "Restart required for start-in-background changes." : "Changes are ready to use.",
      );
      return true;
    } catch (error) {
      props.reportError("Failed to save settings", error);
      return false;
    }
  }

  return {
    settings,
    geminiApiKey,
    settingsFeedback,
    setGeminiApiKey,
    setSettingsFeedback,
    onSettingChange,
    hydrateSettings,
    saveSettings,
  };

  function clearPendingPersistence(): void {
    for (const timerId of pendingPersistTimers.values()) {
      window.clearTimeout(timerId);
    }
    pendingPersistTimers.clear();
  }

  function schedulePersist(key: string, value: string, delayMs: number): void {
    const existingTimer = pendingPersistTimers.get(key);
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
    }

    const timerId = window.setTimeout(() => {
      pendingPersistTimers.delete(key);

      void props.rpc
        .setSetting({ key, value })
        .catch((error) => {
          if (!disposed) {
            props.reportError(`Failed to save ${key}`, error);
          }
        });
    }, delayMs);

    pendingPersistTimers.set(key, timerId);
  }

  function setGeminiApiKey(value: string): void {
    setGeminiApiKeyState(value);

    const trimmed = value.trim();
    if (trimmed.length === 0) {
      const pendingTimer = pendingPersistTimers.get("geminiApiKey");
      if (pendingTimer !== undefined) {
        window.clearTimeout(pendingTimer);
        pendingPersistTimers.delete("geminiApiKey");
      }
      return;
    }

    schedulePersist("geminiApiKey", trimmed, GEMINI_API_KEY_SAVE_DELAY_MS);
  }
}

function serializeSettingValue<K extends keyof AppSettings>(key: K, value: AppSettings[K]): string {
  switch (typeof value) {
    case "boolean":
    case "number":
      return String(value);
    default:
      // String-valued settings can be written as-is; classificationRulesJson is intentionally
      // excluded from immediate persistence because partial JSON edits should not rewrite rules.
      return value as string;
  }
}
