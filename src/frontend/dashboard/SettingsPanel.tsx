import type { AppSettings, MemoryRecord, MemoryStatus, TrackingStatus } from "../../shared/types";
import { MemorySection } from "./MemorySection";
import { parseIntegerInput } from "./helpers";

type SettingsPanelProps = {
  active: boolean;
  settings: AppSettings;
  trackingStatus: TrackingStatus;
  geminiApiKey: string;
  settingsFeedback: string;
  onSettingsSubmit: (event: SubmitEvent) => void;
  onSettingChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  onGeminiApiKeyChange: (value: string) => void;
  memoryStatus: MemoryStatus | null;
  memoryRecords: MemoryRecord[];
  onMemoryAction: (action: "pin" | "forget", record: MemoryRecord) => void;
};

export function SettingsPanel(props: SettingsPanelProps) {
  return (
    <section id="panel-settings" class={`panel ${props.active ? "active" : ""}`} aria-hidden={!props.active}>
      <div id="settings-content" class="card">
        <form id="settings-form" onSubmit={(event) => props.onSettingsSubmit(event)}>
          <h3>AI</h3>
          <div class="form-group">
            <label for="geminiApiKey">Gemini API Key</label>
            <input
              type="password"
              id="geminiApiKey"
              name="geminiApiKey"
              value={props.geminiApiKey}
              autocomplete="new-password"
              placeholder="Enter to set or replace the key"
              onInput={(event) => props.onGeminiApiKeyChange(event.currentTarget.value)}
            />
            <div class="settings-hint">
              Status: {props.settings.geminiApiKeyConfigured ? "configured" : "not configured"}. Leave blank to keep the current key.
            </div>
          </div>
          <div class="form-group">
            <label for="summaryLanguage">Summary Language</label>
            <input
              type="text"
              id="summaryLanguage"
              name="summaryLanguage"
              value={props.settings.summaryLanguage}
              placeholder="Japanese"
              onInput={(event) => props.onSettingChange("summaryLanguage", event.currentTarget.value)}
            />
          </div>
          <div class="form-group">
            <label for="summaryTone">Summary Tone</label>
            <input
              type="text"
              id="summaryTone"
              name="summaryTone"
              value={props.settings.summaryTone}
              placeholder="encouraging"
              onInput={(event) => props.onSettingChange("summaryTone", event.currentTarget.value)}
            />
          </div>
          <div class="form-group">
            <label for="classificationRulesJson">Classification Rules (JSON)</label>
            <textarea
              id="classificationRulesJson"
              name="classificationRulesJson"
              rows={8}
              placeholder='[{"processNamePattern":"code","windowTitlePattern":"github","category":"productive","label":"Coding"}]'
              value={props.settings.classificationRulesJson}
              onInput={(event) => props.onSettingChange("classificationRulesJson", event.currentTarget.value)}
            />
          </div>
          <h3>Tracking</h3>
          <div id="tracking-status-indicator" class="settings-feedback" data-tracking-state={props.trackingStatus.state}>
            {props.trackingStatus.running ? "Tracking: active" : "Tracking: paused"}
          </div>
          <div class="form-group checkbox">
            <label>
              <input
                type="checkbox"
                id="autoStart"
                name="autoStart"
                checked={props.settings.autoStart}
                onInput={(event) => props.onSettingChange("autoStart", event.currentTarget.checked)}
              />
              Enable Auto Start
            </label>
          </div>
          <div class="form-group checkbox">
            <label>
              <input
                type="checkbox"
                id="startInBackground"
                name="startInBackground"
                checked={props.settings.startInBackground}
                onInput={(event) => props.onSettingChange("startInBackground", event.currentTarget.checked)}
              />
              Hide window when launched automatically
            </label>
            <div class="settings-hint">Applies only when Auto Start is enabled.</div>
          </div>
          <div class="form-group">
            <label for="pollIntervalMs">Poll Interval (ms)</label>
            <input
              type="number"
              id="pollIntervalMs"
              name="pollIntervalMs"
              min={1000}
              value={props.settings.pollIntervalMs}
              onInput={(event) => props.onSettingChange("pollIntervalMs", parseIntegerInput(event.currentTarget.value, props.settings.pollIntervalMs, 1000))}
            />
          </div>
          <div class="form-group">
            <label for="idleTimeoutMs">Idle Timeout (ms)</label>
            <input
              type="number"
              id="idleTimeoutMs"
              name="idleTimeoutMs"
              min={10000}
              value={props.settings.idleTimeoutMs}
              onInput={(event) => props.onSettingChange("idleTimeoutMs", parseIntegerInput(event.currentTarget.value, props.settings.idleTimeoutMs, 10000))}
            />
          </div>
          <div class="form-group">
            <label for="notificationCooldownMs">Notification Cooldown (ms)</label>
            <input
              type="number"
              id="notificationCooldownMs"
              name="notificationCooldownMs"
              min={0}
              value={props.settings.notificationCooldownMs}
              onInput={(event) => props.onSettingChange("notificationCooldownMs", parseIntegerInput(event.currentTarget.value, props.settings.notificationCooldownMs, 0))}
            />
          </div>
          <div class="form-group">
            <label for="gracePeriodMs">Grace Period (ms)</label>
            <input
              type="number"
              id="gracePeriodMs"
              name="gracePeriodMs"
              min={0}
              value={props.settings.gracePeriodMs}
              onInput={(event) => props.onSettingChange("gracePeriodMs", parseIntegerInput(event.currentTarget.value, props.settings.gracePeriodMs, 0))}
            />
          </div>
          <h3>Markdown</h3>
          <div class="form-group">
            <label for="markdownExportPath">Markdown Export Directory</label>
            <input
              type="text"
              id="markdownExportPath"
              name="markdownExportPath"
              value={props.settings.markdownExportPath}
              placeholder="~/act-track-logs"
              onInput={(event) => props.onSettingChange("markdownExportPath", event.currentTarget.value)}
            />
          </div>
          <div class="form-group checkbox">
            <label>
              <input
                type="checkbox"
                id="markdownPrivacyMode"
                name="markdownPrivacyMode"
                checked={props.settings.markdownPrivacyMode}
                onInput={(event) => props.onSettingChange("markdownPrivacyMode", event.currentTarget.checked)}
              />
              Hide sensitive window titles in Markdown exports
            </label>
          </div>
          <h3>Notifications</h3>
          <div class="form-group checkbox">
            <label>
              <input
                type="checkbox"
                id="notificationsEnabled"
                name="notificationsEnabled"
                checked={props.settings.notificationsEnabled}
                onInput={(event) => props.onSettingChange("notificationsEnabled", event.currentTarget.checked)}
              />
              Enable Notifications
            </label>
          </div>
          <button type="submit" class="btn-save">
            Save Settings
          </button>
          <div id="settings-feedback" class="settings-feedback" role="status" aria-live="polite">
            {props.settingsFeedback}
          </div>
          <p class="settings-hint">Restart required for polling, idle timing, and auto-start visibility changes.</p>
          <MemorySection
            memoryStatus={props.memoryStatus}
            memoryRecords={props.memoryRecords}
            onMemoryAction={props.onMemoryAction}
          />
        </form>
      </div>
    </section>
  );
}
