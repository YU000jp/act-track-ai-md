import {
  DEFAULT_SETTINGS,
  type ActivityCategory,
  type AppSettings,
  type DashboardRPC,
  type MemoryRecord,
  type MemoryStatus,
} from "../../shared/types";
import { RESTART_REQUIRED_SETTINGS } from "../../shared/settings";
import { APP_META } from "../../shared/app-meta";
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

function formatMemoryDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

function renderMemoryStatus(container: HTMLElement, status: MemoryStatus): void {
  if (!status.enabled) {
    container.textContent = "Memory: disabled";
    return;
  }
  container.textContent = `Memory: ${status.total} entries (${status.pinned} pinned) - backend: ${status.backend}`;
}

function renderMemoryList(container: HTMLElement, memories: MemoryRecord[]): void {
  if (memories.length === 0) {
    container.innerHTML = '<div class="empty-state">No memory entries yet</div>';
    return;
  }

  container.innerHTML = `
    <ul class="memory-list">
      ${memories
        .map(
          (memory) => `
        <li class="memory-item" data-memory-id="${memory.id}" data-memory-pinned="${memory.pinned ? "true" : "false"}">
          <div class="memory-meta">
            <span class="memory-type">${memory.type}</span>
            <span class="memory-date">${formatMemoryDate(memory.createdAt)}</span>
          </div>
          <div class="memory-content">${escapeHtml(memory.content)}</div>
          <div class="memory-actions">
            <button type="button" data-memory-action="pin">${memory.pinned ? "Unpin" : "Pin"}</button>
            <button type="button" data-memory-action="forget">Forget</button>
          </div>
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
      <h3>Memory</h3>
      <div id="memory-status-indicator" class="settings-feedback">Memory: loading...</div>
      <div id="memory-list-container"></div>
    </form>
  `;
}

function renderDashboardSkeleton(app: HTMLElement): void {
  const todayStatsContainer = app.querySelector<HTMLElement>("#today-stats");
  const topAppsContainer = app.querySelector<HTMLElement>("#top-apps");
  const settingsContainer = app.querySelector<HTMLElement>("#settings-content");
  const summaryFeedbackContainer = app.querySelector<HTMLElement>("#summary-feedback");
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

  if (summaryFeedbackContainer) {
    summaryFeedbackContainer.innerHTML = `
      <h3>Summary Feedback</h3>
      <textarea id="summary-feedback-input" rows="4" placeholder="Edit today's AI summary and save to memory"></textarea>
      <button type="button" id="summary-feedback-save">Save Feedback</button>
      <div id="summary-feedback-status" class="settings-feedback"></div>
    `;
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
  const summaryFeedbackInput = app.querySelector<HTMLTextAreaElement>("#summary-feedback-input");
  const today = new Date().toISOString().slice(0, 10);

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

  const memoryStatusContainer = app.querySelector<HTMLElement>("#memory-status-indicator");
  if (memoryStatusContainer) {
    const status = await rpc.getMemoryStatus();
    renderMemoryStatus(memoryStatusContainer, status);
  }
  const memoryListContainer = app.querySelector<HTMLElement>("#memory-list-container");
  if (memoryListContainer) {
    const memories = await rpc.listMemories(10);
    renderMemoryList(memoryListContainer, memories);
  }
  if (summaryFeedbackInput) {
    const summary = await rpc.getDailySummary(today);
    summaryFeedbackInput.value = summary?.aiSummary ?? "";
  }
  bindMemoryActions(app);
  bindSummaryFeedback(app);
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
      ([key, value]) => [key, String(value)] as const,
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

function bindMemoryActions(app: HTMLElement): void {
  const container = app.querySelector<HTMLElement>("#memory-list-container");
  if (!container) {
    return;
  }
  container.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }
    const action = target.getAttribute("data-memory-action");
    if (!action) {
      return;
    }
    const item = target.closest<HTMLElement>("[data-memory-id]");
    if (!item) {
      return;
    }
    const id = Number(item.dataset.memoryId ?? "");
    if (!Number.isFinite(id)) {
      return;
    }
    const rpc = window.dashboardRPC;
    if (!rpc) {
      return;
    }
    if (action === "forget") {
      await rpc.forgetMemory(id);
    } else if (action === "pin") {
      const isPinned = item.dataset.memoryPinned === "true";
      await rpc.pinMemory({ id, pinned: !isPinned });
    }
    const [status, memories] = await Promise.all([rpc.getMemoryStatus(), rpc.listMemories(10)]);
    const statusContainer = app.querySelector<HTMLElement>("#memory-status-indicator");
    const listContainer = app.querySelector<HTMLElement>("#memory-list-container");
    if (statusContainer) {
      renderMemoryStatus(statusContainer, status);
    }
    if (listContainer) {
      renderMemoryList(listContainer, memories);
    }
  });
}

function bindSummaryFeedback(app: HTMLElement): void {
  const button = app.querySelector<HTMLButtonElement>("#summary-feedback-save");
  const input = app.querySelector<HTMLTextAreaElement>("#summary-feedback-input");
  const status = app.querySelector<HTMLElement>("#summary-feedback-status");
  if (!button || !input) {
    return;
  }

  button.addEventListener("click", async () => {
    const rpc = window.dashboardRPC;
    if (!rpc) {
      return;
    }
    const date = new Date().toISOString().slice(0, 10);
    const editedSummary = input.value.trim();
    await rpc.saveSummaryFeedback({ date, editedSummary });
    if (status) {
      status.textContent = "Saved as learning feedback.";
    }
    const [memoryStatus, memories] = await Promise.all([rpc.getMemoryStatus(), rpc.listMemories(10)]);
    const statusContainer = app.querySelector<HTMLElement>("#memory-status-indicator");
    const listContainer = app.querySelector<HTMLElement>("#memory-list-container");
    if (statusContainer) {
      renderMemoryStatus(statusContainer, memoryStatus);
    }
    if (listContainer) {
      renderMemoryList(listContainer, memories);
    }
  });
}

function applyBranding(app: HTMLElement): void {
  const dashboardTitle = `${APP_META.displayName} Dashboard`;
  document.title = dashboardTitle;
  const titleElement = app.querySelector<HTMLElement>(".title");
  if (titleElement) {
    titleElement.textContent = dashboardTitle;
  }
}

if (typeof document !== "undefined" && document.getElementById("app")) {
  const app = document.getElementById("app") as HTMLElement;
  applyBranding(app);
  initTabs(app);
  renderDashboardSkeleton(app);
  void hydrateFromRPC(app);
  bindSettingsSave(app);
}
