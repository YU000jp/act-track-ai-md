import type { ActivityCategory, AppSettings, DashboardRPC } from "../../shared/types";
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

type SettingsData = {
  geminiApiKey: string;
  pollIntervalMs: number;
  idleTimeoutMs: number;
  notificationCooldownMs: number;
  gracePeriodMs: number;
  notificationsEnabled: boolean;
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

export function renderSettings(container: HTMLElement, settings: SettingsData): void {
  container.innerHTML = `
    <form id="settings-form">
      <div class="form-group">
        <label for="geminiApiKey">Gemini API Key</label>
        <input type="password" id="geminiApiKey" name="geminiApiKey" value="${settings.geminiApiKey}" />
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
    renderSettings(settingsContainer, {
      geminiApiKey: "",
      pollIntervalMs: 3000,
      idleTimeoutMs: 300000,
      notificationCooldownMs: 300000,
      gracePeriodMs: 30000,
      notificationsEnabled: true,
    });
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

  const [todaySummary, topApps] = await Promise.all([rpc.getTodaySummary(), rpc.getTopApps()]);
  const todayStatsContainer = app.querySelector<HTMLElement>("#today-stats");
  const topAppsContainer = app.querySelector<HTMLElement>("#top-apps");

  if (todayStatsContainer) {
    renderTodayStats(todayStatsContainer, todaySummary);
  }

  if (topAppsContainer) {
    renderTopApps(topAppsContainer, topApps);
  }
}

function bindSettingsSave(app: HTMLElement): void {
  const form = app.querySelector<HTMLFormElement>("#settings-form");
  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const rpc = window.dashboardRPC;
    if (!rpc) {
      return;
    }

    const data = new FormData(form);
    const updates: Array<[keyof AppSettings, string]> = [
      ["geminiApiKey", String(data.get("geminiApiKey") ?? "")],
      ["pollIntervalMs", String(data.get("pollIntervalMs") ?? "3000")],
      ["idleTimeoutMs", String(data.get("idleTimeoutMs") ?? "300000")],
      ["notificationCooldownMs", String(data.get("notificationCooldownMs") ?? "300000")],
      ["gracePeriodMs", String(data.get("gracePeriodMs") ?? "30000")],
      ["notificationsEnabled", data.get("notificationsEnabled") ? "true" : "false"],
    ];

    await Promise.all(updates.map(([key, value]) => rpc.setSetting({ key, value })));
  });
}

if (typeof document !== "undefined" && document.getElementById("app")) {
  const app = document.getElementById("app") as HTMLElement;
  initTabs(app);
  renderDashboardSkeleton(app);
  void hydrateFromRPC(app);
  bindSettingsSave(app);
}
