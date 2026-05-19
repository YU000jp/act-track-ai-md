import type { AppSettings, MemoryRecord, MemoryStatus, TrackingStatus } from "../../shared/types";
import { DashboardSurface } from "./DashboardSurface";
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

function renderTrackingState(status: TrackingStatus): string {
  if (!status.running) {
    return "Paused";
  }

  switch (status.state) {
    case "productive":
      return "Active and productive";
    case "distracted":
      return "Active but distracted";
    case "idle":
      return "Active but idle";
    default:
      return "Active";
  }
}

export function SettingsPanel(props: SettingsPanelProps) {
  return (
    <section id="panel-settings" class={`panel panel-settings ${props.active ? "active" : ""}`} aria-hidden={!props.active} role="tabpanel" aria-labelledby="tab-settings">
      <form id="settings-form" class="settings-form" onSubmit={(event) => props.onSettingsSubmit(event)}>
        <div class="settings-grid">
          <DashboardSurface
            eyebrow="AI"
            title="Summary controls"
            description="Tune how the dashboard generates and rewrites summaries."
            class="settings-surface"
          >
            <div class="field-grid">
              <div class="form-group">
                <label for="geminiApiKey">Gemini API key</label>
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
                <label for="summaryLanguage">Summary language</label>
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
                <label for="summaryTone">Summary tone</label>
                <input
                  type="text"
                  id="summaryTone"
                  name="summaryTone"
                  value={props.settings.summaryTone}
                  placeholder="encouraging"
                  onInput={(event) => props.onSettingChange("summaryTone", event.currentTarget.value)}
                />
              </div>
              <div class="form-group field-span">
                <label for="classificationRulesJson">Classification rules JSON</label>
                <textarea
                  id="classificationRulesJson"
                  name="classificationRulesJson"
                  rows={9}
                  placeholder='[{"processNamePattern":"code","windowTitlePattern":"github","category":"productive","label":"Coding"}]'
                  value={props.settings.classificationRulesJson}
                  onInput={(event) => props.onSettingChange("classificationRulesJson", event.currentTarget.value)}
                />
              </div>
            </div>
          </DashboardSurface>

          <DashboardSurface
            eyebrow="Tracking"
            title="Runtime controls"
            description="Configure how often the tracker wakes up and how it behaves at launch."
            class="settings-surface"
            actions={<span class="settings-state-pill">{renderTrackingState(props.trackingStatus)}</span>}
          >
            <div class="field-grid field-grid-two">
              <div class="form-group checkbox field-span">
                <label>
                  <input
                    type="checkbox"
                    id="autoStart"
                    name="autoStart"
                    checked={props.settings.autoStart}
                    onInput={(event) => props.onSettingChange("autoStart", event.currentTarget.checked)}
                  />
                  Enable auto start
                </label>
              </div>
              <div class="form-group checkbox field-span">
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
                <div class="settings-hint">Applies only when auto start is enabled.</div>
              </div>
              <div class="form-group">
                <label for="pollIntervalMs">Poll interval (ms)</label>
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
                <label for="idleTimeoutMs">Idle timeout (ms)</label>
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
                <label for="notificationCooldownMs">Notification cooldown (ms)</label>
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
                <label for="gracePeriodMs">Grace period (ms)</label>
                <input
                  type="number"
                  id="gracePeriodMs"
                  name="gracePeriodMs"
                  min={0}
                  value={props.settings.gracePeriodMs}
                  onInput={(event) => props.onSettingChange("gracePeriodMs", parseIntegerInput(event.currentTarget.value, props.settings.gracePeriodMs, 0))}
                />
              </div>
            </div>
          </DashboardSurface>

          <DashboardSurface
            eyebrow="Delivery"
            title="Export & notifications"
            description="Shape where markdown lands and how the app should notify you."
            class="settings-surface"
          >
            <div class="field-grid">
              <div class="form-group field-span">
                <label for="markdownExportPath">Markdown export directory</label>
                <input
                  type="text"
                  id="markdownExportPath"
                  name="markdownExportPath"
                  value={props.settings.markdownExportPath}
                  placeholder="~/act-track-logs"
                  onInput={(event) => props.onSettingChange("markdownExportPath", event.currentTarget.value)}
                />
              </div>
              <div class="form-group checkbox field-span">
                <label>
                  <input
                    type="checkbox"
                    id="markdownPrivacyMode"
                    name="markdownPrivacyMode"
                    checked={props.settings.markdownPrivacyMode}
                    onInput={(event) => props.onSettingChange("markdownPrivacyMode", event.currentTarget.checked)}
                  />
                  Hide sensitive window titles in markdown exports
                </label>
              </div>
              <div class="form-group checkbox field-span">
                <label>
                  <input
                    type="checkbox"
                    id="notificationsEnabled"
                    name="notificationsEnabled"
                    checked={props.settings.notificationsEnabled}
                    onInput={(event) => props.onSettingChange("notificationsEnabled", event.currentTarget.checked)}
                  />
                  Enable notifications
                </label>
              </div>
            </div>
          </DashboardSurface>

          <DashboardSurface
            eyebrow="Memory"
            title="Memory console"
            description="Keep pinned notes and recent feedback visible while adjusting settings."
            class="settings-surface"
          >
            <MemorySection memoryStatus={props.memoryStatus} memoryRecords={props.memoryRecords} onMemoryAction={props.onMemoryAction} />
          </DashboardSurface>
        </div>

        <div class="settings-footer">
          <button type="submit" class="btn-primary btn-save">
            Save settings
          </button>
          <div id="settings-feedback" class="settings-feedback settings-footer-feedback" role="status" aria-live="polite">
            {props.settingsFeedback}
          </div>
          <p class="settings-hint settings-footer-hint">Restart required for polling, idle timing, and auto-start visibility changes.</p>
        </div>
      </form>
    </section>
  );
}
