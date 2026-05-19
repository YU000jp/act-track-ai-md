import type { AppSettings, TrackingStatus } from "../../shared/types";
import { DashboardSurface } from "./DashboardSurface";
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

function describeClassificationFlow(geminiApiKeyConfigured: boolean): string {
  if (geminiApiKeyConfigured) {
    return "rules -> cache -> Gemini -> unknown fallback";
  }

  return "rules -> cache -> unknown fallback";
}

export function SettingsPanel(props: SettingsPanelProps) {
  return (
    <section id="panel-settings" class={`panel panel-settings ${props.active ? "active" : ""}`} aria-hidden={!props.active} role="tabpanel" aria-labelledby="tab-settings">
      <form id="settings-form" class="settings-form" onSubmit={(event) => props.onSettingsSubmit(event)}>
        <div class="settings-grid settings-grid-compact">
          <DashboardSurface
            eyebrow="AI"
            title="Summary controls"
            description="Keep the core summary controls up front. Advanced rule editing stays tucked away."
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
                <div class="settings-hint">
                  Automatic classification order: {describeClassificationFlow(props.settings.geminiApiKeyConfigured)}.
                </div>
                <div class="settings-callout" role="status" aria-live="polite">
                  {props.settings.geminiApiKeyConfigured
                    ? "Gemini is ready as the automatic classifier when rules and cache do not match."
                    : "Save a Gemini API key to enable the Gemini step after rules and cache."}
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
              <details class="settings-details field-span">
                <summary>Advanced rule editor</summary>
                <div class="settings-details-body">
                  <label for="classificationRulesJson">Classification rules JSON</label>
                  <textarea
                    id="classificationRulesJson"
                    name="classificationRulesJson"
                    rows={8}
                    placeholder='[{"processNamePattern":"code","category":"productive","label":"Coding"}]'
                    value={props.settings.classificationRulesJson}
                    onInput={(event) => props.onSettingChange("classificationRulesJson", event.currentTarget.value)}
                  />
                  <div class="settings-hint">Use the management screen for day-to-day edits. JSON is kept for bulk changes and recovery.</div>
                </div>
              </details>
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
              <details class="settings-details field-span">
                <summary>Advanced timing</summary>
                <div class="settings-details-body">
                  <div class="form-group">
                    <label for="dashboardBootstrapTimeoutMs">Dashboard bootstrap timeout (ms)</label>
                    <input
                      type="number"
                      id="dashboardBootstrapTimeoutMs"
                      name="dashboardBootstrapTimeoutMs"
                      min={1000}
                      value={props.settings.dashboardBootstrapTimeoutMs}
                      onInput={(event) =>
                        props.onSettingChange(
                          "dashboardBootstrapTimeoutMs",
                          parseIntegerInput(
                            event.currentTarget.value,
                            props.settings.dashboardBootstrapTimeoutMs,
                            1000,
                          ),
                        )
                      }
                    />
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
              </details>
            </div>
          </DashboardSurface>

          <DashboardSurface
            eyebrow="Delivery"
            title="Export and notifications"
            description="Keep delivery defaults visible and leave the heavier knobs collapsed."
            class="settings-surface"
          >
            <div class="settings-split-block">
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
            </div>
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
