import { createSignal } from "solid-js";
import { DEFAULT_SETTINGS, type AppSettings, type AppSettingsUpdate } from "../../shared/types";
import type { DashboardClient } from "./tauri-bridge";
import { getRestartRequiredKeys } from "./helpers";
import type { DashboardToast } from "./types";

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
  const [geminiApiKey, setGeminiApiKey] = createSignal("");
  const [settingsFeedback, setSettingsFeedback] = createSignal("");

  function onSettingChange<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    setSettings((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function hydrateSettings(nextSettings: AppSettings): void {
    setSettings({ ...nextSettings });
    setBaselineSettings({ ...nextSettings });
    setGeminiApiKey("");
    setSettingsFeedback("");
  }

  async function saveSettings(event: SubmitEvent): Promise<boolean> {
    event.preventDefault();

    try {
      const currentSettings = settings();
      const geminiKey = geminiApiKey().trim();
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
}
