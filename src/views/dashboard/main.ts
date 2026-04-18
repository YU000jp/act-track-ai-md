import { DEFAULT_SETTINGS, type ActivityCategory, type AppSettings, type DashboardRPC } from "../../shared/types";
import { RESTART_REQUIRED_SETTINGS } from "../../shared/settings";
import { renderMonthlyTrend, renderWeeklyChart } from "./charts";

type TodayStats = {
  trackedMs: number;
  productiveMs: number;
  distractionMs: number;
  neutralMs: number;
};

type TopApp = {
  processName: string;
  durationMs: number;
  category: ActivityCategory | string;
};

type DashboardRPCLike = DashboardRPC["requests"];

declare global {
  interface Window {
    dashboardRPC?: DashboardRPCLike;
  }
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m ${seconds}s`;
}

export function initTabs(container: HTMLElement): void {
  const buttons = container.querySelectorAll<HTMLElement>(".tab-btn");
  const panels = container.querySelectorAll<HTMLElement>(".panel");

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      if (!tab) {
        return;
      }

      buttons.forEach((button) => button.classList.remove("active"));
      panels.forEach((panel) => panel.classList.remove("active"));

      btn.classList.add("active");

      const panel = container.querySelector<HTMLElement>(`#panel-${tab}`);
      if (panel) {
        panel.classList.add("active");
      }
    });
  });
}

export function renderTodayStats(container: HTMLElement, stats: TodayStats): void {
  const productivePct = stats.trackedMs > 0 ? Math.round((stats.productiveMs / stats.trackedMs) * 100) : 0;
  const distractionPct = stats.trackedMs > 0 ? Math.round((stats.distractionMs / stats.trackedMs) * 100) : 0;
  const neutralPct = stats.trackedMs > 0 ? Math.round((stats.neutralMs / stats.trackedMs) * 100) : 0;

  container.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Total Tracked</div>
        <div class="stat-value">${formatDuration(stats.trackedMs)}</div>
      </div>
      <div class="stat-card productive">
        <div class="stat-label">Productive</div>
        <div class="stat-value">${formatDuration(stats.productiveMs)}</div>
        <div class="stat-pct">${productivePct}%</div>
      </div>
      <div class="stat-card distraction">
        <div class="stat-label">Distraction</div>
        <div class="stat-value">${formatDuration(stats.distractionMs)}</div>
        <div class="stat-pct">${distractionPct}%</div>
      </div>
      <div class="stat-card neutral">
        <div class="stat-label">Neutral</div>
        <div class="stat-value">${formatDuration(stats.neutralMs)}</div>
        <div class="stat-pct">${neutralPct}%</div>
      </div>
    </div>
  `;
}

export function renderTopApps(container: HTMLElement, apps: TopApp[]): void {
  if (apps.length === 0) {
    container.innerHTML = '<div class="empty-state">No activity tracked yet</div>';
    return;
  }

  container.innerHTML = `
    <h3>Top Apps</h3>
    <ul class="app-list">
      ${apps
        .map(
          (app) => `
        <li class="app-item">
          <span class="app-dot ${app.category}"></span>
          <span class="app-name">${app.processName}</span>
          <span class="app-duration">${formatDuration(app.durationMs)}</span>
        </li>
      `,
        )
        .join("")}
    </ul>
  `;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderSettings(container: HTMLElement, settings: AppSettings): void {
  container.innerHTML = `
    <form id="settings-form">
      <h3>AI</h3>
      <div class="form-group">
        <label for="geminiApiKey">Gemini API Key</label>
        <input type="password" id="geminiApiKey" name="geminiApiKey" value="${escapeHtml(settings.geminiApiKey)}" />
      </div>
      <div class="form-group">
        <label for="summaryLanguage">Summary Language</label>
        <input type="text" id="summaryLanguage" name="summaryLanguage" value="${escapeHtml(settings.summaryLanguage)}" placeholder="Japanese" />
      </div>
      <div class="form-group">
        <label for="summaryTone">Summary Tone</label>
        <input type="text" id="summaryTone" name="summaryTone" value="${escapeHtml(settings.summaryTone)}" placeholder="encouraging" />
      </div>
      <div class="form-group">
        <label for="classificationRulesJson">Classification Rules (JSON)</label>
        <textarea id="classificationRulesJson" name="classificationRulesJson" rows="8" placeholder='[{"processNamePattern":"code","windowTitlePattern":"github","category":"productive","label":"Coding"}]'>${escapeHtml(settings.classificationRulesJson)}</textarea>
      </div>
      <h3>Tracking</h3>
      <div class="form-group checkbox">
        <label>
          <input type="checkbox" id="autoStart" name="autoStart" ${settings.autoStart ? "checked" : ""} />
          Enable Auto Start
        </label>
      </div>
      <div class="form-group checkbox">
        <label>
          <input
            type="checkbox"
            id="startInBackground"
            name="startInBackground"
            ${settings.startInBackground ? "checked" : ""}
          />
          Start in Background when launched automatically
        </label>
      </div>
      <div class="form-group">
        <label for="pollIntervalMs">Poll Interval (ms)</label>
        <input type="number" id="pollIntervalMs" name="pollIntervalMs" value="${settings.pollIntervalMs}" min="1000" />
      </div>
      <div class="form-group">
        <label for="idleTimeoutMs">Idle Timeout (ms)</label>
        <input type="number" id="idleTimeoutMs" name="idleTimeoutMs" value="${settings.idleTimeoutMs}" min="10000" />
      </div>
      <div class="form-group">
        <label for="notificationCooldownMs">Notification Cooldown (ms)</label>
        <input
          type="number"
          id="notificationCooldownMs"
          name="notificationCooldownMs"
          value="${settings.notificationCooldownMs}"
          min="0"
        />
      </div>
      <div class="form-group">
        <label for="gracePeriodMs">Grace Period (ms)</label>
        <input type="number" id="gracePeriodMs" name="gracePeriodMs" value="${settings.gracePeriodMs}" min="0" />
      </div>
      <h3>Markdown</h3>
      <div class="form-group">
        <label for="markdownExportPath">Markdown Export Directory</label>
        <input
          type="text"
          id="markdownExportPath"
          name="markdownExportPath"
          value="${escapeHtml(settings.markdownExportPath)}"
          placeholder="~/act-track-logs"
        />
      </div>
      <div class="form-group checkbox">
        <label>
          <input
            type="checkbox"
            id="markdownPrivacyMode"
            name="markdownPrivacyMode"
            ${settings.markdownPrivacyMode ? "checked" : ""}
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
            ${settings.notificationsEnabled ? "checked" : ""}
          />
          Enable Notifications
        </label>
      </div>
      <button type="submit" class="btn-save">Save Settings</button>
      <div id="settings-feedback" class="settings-feedback" role="status" aria-live="polite"></div>
      <p class="settings-hint">Restart required for polling, idle timing, and startup behavior changes.</p>
    </form>
  `;
}

function renderDashboardSkeleton(app: HTMLElement): void {
  const todayStatsContainer = app.querySelector<HTMLElement>("#today-stats");
  const topAppsContainer = app.querySelector<HTMLElement>("#top-apps");
  const settingsContainer = app.querySelector<HTMLElement>("#settings-content");
  const weeklyChartContainer = app.querySelector<HTMLElement>("#weekly-chart");
  const monthlyTrendContainer = app.querySelector<HTMLElement>("#monthly-trend");

  if (todayStatsContainer) {
    renderTodayStats(todayStatsContainer, {
      trackedMs: 0,
      productiveMs: 0,
      distractionMs: 0,
      neutralMs: 0,
    });
  }

  if (topAppsContainer) {
    renderTopApps(topAppsContainer, []);
  }

  if (settingsContainer) {
    renderSettings(settingsContainer, DEFAULT_SETTINGS);
  }

  if (weeklyChartContainer) {
    renderWeeklyChart(weeklyChartContainer, []);
  }

  if (monthlyTrendContainer) {
    renderMonthlyTrend(monthlyTrendContainer, []);
  }
}

async function hydrateFromRPC(app: HTMLElement): Promise<void> {
  const rpc = window.dashboardRPC;
  if (!rpc) {
    return;
  }

  const [todaySummary, topApps, settings] = await Promise.all([
    rpc.getTodaySummary(),
    rpc.getTopApps(),
    rpc.getSettings(),
  ]);
  const todayStatsContainer = app.querySelector<HTMLElement>("#today-stats");
  const topAppsContainer = app.querySelector<HTMLElement>("#top-apps");
  const settingsContainer = app.querySelector<HTMLElement>("#settings-content");

  if (todayStatsContainer) {
    renderTodayStats(todayStatsContainer, todaySummary);
  }

  if (topAppsContainer) {
    renderTopApps(topAppsContainer, topApps);
  }

  if (settingsContainer) {
    renderSettings(settingsContainer, settings);
    bindSettingsSave(app, settings);
  }
}

function bindSettingsSave(app: HTMLElement, initialSettings: AppSettings = DEFAULT_SETTINGS): void {
  const form = app.querySelector<HTMLFormElement>("#settings-form");
  if (!form) {
    return;
  }

  let currentSettings = initialSettings;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const rpc = window.dashboardRPC;
    if (!rpc) {
      return;
    }

    const feedback = app.querySelector<HTMLElement>("#settings-feedback");
    const data = new FormData(form);
    const nextSettings: AppSettings = {
      geminiApiKey: String(data.get("geminiApiKey") ?? ""),
      pollIntervalMs: Number(data.get("pollIntervalMs") ?? DEFAULT_SETTINGS.pollIntervalMs),
      idleTimeoutMs: Number(data.get("idleTimeoutMs") ?? DEFAULT_SETTINGS.idleTimeoutMs),
      notificationCooldownMs: Number(
        data.get("notificationCooldownMs") ?? DEFAULT_SETTINGS.notificationCooldownMs,
      ),
      gracePeriodMs: Number(data.get("gracePeriodMs") ?? DEFAULT_SETTINGS.gracePeriodMs),
      markdownExportPath: String(data.get("markdownExportPath") ?? ""),
      notificationsEnabled: data.get("notificationsEnabled") !== null,
      autoStart: data.get("autoStart") !== null,
      classificationRulesJson: String(data.get("classificationRulesJson") ?? ""),
      summaryLanguage: String(data.get("summaryLanguage") ?? DEFAULT_SETTINGS.summaryLanguage),
      summaryTone: String(data.get("summaryTone") ?? DEFAULT_SETTINGS.summaryTone),
      markdownPrivacyMode: data.get("markdownPrivacyMode") !== null,
      startInBackground: data.get("startInBackground") !== null,
    };

    const updates = (Object.entries(nextSettings) as Array<[keyof AppSettings, AppSettings[keyof AppSettings]]>).map(
      ([key, value]) => [key, typeof value === "boolean" ? String(value) : String(value)] as const,
    );

    await Promise.all(updates.map(([key, value]) => rpc.setSetting({ key, value })));

    const restartKeys = RESTART_REQUIRED_SETTINGS.filter((key) => nextSettings[key] !== currentSettings[key]);
    if (feedback) {
      feedback.textContent =
        restartKeys.length > 0
          ? `Saved. Restart required to apply: ${restartKeys.join(", ")}`
          : "Saved. Changes are ready to use.";
    }
    currentSettings = nextSettings;
  });
}

if (typeof document !== "undefined" && document.getElementById("app")) {
  const app = document.getElementById("app") as HTMLElement;
  initTabs(app);
  renderDashboardSkeleton(app);
  void hydrateFromRPC(app);
  bindSettingsSave(app);
}
