// src/views/dashboard/charts.ts
function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}
function renderWeeklyChart(container, data) {
  if (data.length === 0) {
    container.innerHTML = '<div class="empty-state">No weekly data yet</div>';
    return;
  }
  const max = Math.max(...data.map((point) => point.productiveMs), 1);
  container.innerHTML = `
    <h3>Weekly Focus</h3>
    <div class="bar-chart">
      ${data.map((point) => {
    const height = Math.max(10, Math.round(point.productiveMs / max * 100));
    return `
            <div class="bar-col" title="${point.date}: ${formatDuration(point.productiveMs)}">
              <div class="bar-fill" style="height:${height}%"></div>
              <div class="bar-label">${point.date.slice(-5)}</div>
            </div>
          `;
  }).join("")}
    </div>
  `;
}
function renderMonthlyTrend(container, data) {
  if (data.length === 0) {
    container.innerHTML = '<div class="empty-state">No monthly trend yet</div>';
    return;
  }
  container.innerHTML = `
    <h3>Monthly Trend</h3>
    <ul class="trend-list">
      ${data.map((point) => `
        <li class="trend-item">
          <span>${point.date}</span>
          <span>${Math.max(0, Math.min(100, Math.round(point.productivePct)))}%</span>
        </li>
      `).join("")}
    </ul>
  `;
}

// src/views/dashboard/main.ts
function formatDuration2(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m ${seconds}s`;
}
function initTabs(container) {
  const buttons = container.querySelectorAll(".tab-btn");
  const panels = container.querySelectorAll(".panel");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      if (!tab) {
        return;
      }
      buttons.forEach((button) => button.classList.remove("active"));
      panels.forEach((panel2) => panel2.classList.remove("active"));
      btn.classList.add("active");
      const panel = container.querySelector(`#panel-${tab}`);
      if (panel) {
        panel.classList.add("active");
      }
    });
  });
}
function renderTodayStats(container, stats) {
  const productivePct = stats.trackedMs > 0 ? Math.round(stats.productiveMs / stats.trackedMs * 100) : 0;
  const distractionPct = stats.trackedMs > 0 ? Math.round(stats.distractionMs / stats.trackedMs * 100) : 0;
  const neutralPct = stats.trackedMs > 0 ? Math.round(stats.neutralMs / stats.trackedMs * 100) : 0;
  container.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Total Tracked</div>
        <div class="stat-value">${formatDuration2(stats.trackedMs)}</div>
      </div>
      <div class="stat-card productive">
        <div class="stat-label">Productive</div>
        <div class="stat-value">${formatDuration2(stats.productiveMs)}</div>
        <div class="stat-pct">${productivePct}%</div>
      </div>
      <div class="stat-card distraction">
        <div class="stat-label">Distraction</div>
        <div class="stat-value">${formatDuration2(stats.distractionMs)}</div>
        <div class="stat-pct">${distractionPct}%</div>
      </div>
      <div class="stat-card neutral">
        <div class="stat-label">Neutral</div>
        <div class="stat-value">${formatDuration2(stats.neutralMs)}</div>
        <div class="stat-pct">${neutralPct}%</div>
      </div>
    </div>
  `;
}
function renderTopApps(container, apps) {
  if (apps.length === 0) {
    container.innerHTML = '<div class="empty-state">No activity tracked yet</div>';
    return;
  }
  container.innerHTML = `
    <h3>Top Apps</h3>
    <ul class="app-list">
      ${apps.map((app) => `
        <li class="app-item">
          <span class="app-dot ${app.category}"></span>
          <span class="app-name">${app.processName}</span>
          <span class="app-duration">${formatDuration2(app.durationMs)}</span>
        </li>
      `).join("")}
    </ul>
  `;
}
function renderSettings(container, settings) {
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
function renderDashboardSkeleton(app) {
  const todayStatsContainer = app.querySelector("#today-stats");
  const topAppsContainer = app.querySelector("#top-apps");
  const settingsContainer = app.querySelector("#settings-content");
  const weeklyChartContainer = app.querySelector("#weekly-chart");
  const monthlyTrendContainer = app.querySelector("#monthly-trend");
  if (todayStatsContainer) {
    renderTodayStats(todayStatsContainer, {
      trackedMs: 0,
      productiveMs: 0,
      distractionMs: 0,
      neutralMs: 0
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
      notificationsEnabled: true
    });
  }
  if (weeklyChartContainer) {
    renderWeeklyChart(weeklyChartContainer, []);
  }
  if (monthlyTrendContainer) {
    renderMonthlyTrend(monthlyTrendContainer, []);
  }
}
async function hydrateFromRPC(app) {
  const rpc = window.dashboardRPC;
  if (!rpc) {
    return;
  }
  const [todaySummary, topApps] = await Promise.all([rpc.getTodaySummary(), rpc.getTopApps()]);
  const todayStatsContainer = app.querySelector("#today-stats");
  const topAppsContainer = app.querySelector("#top-apps");
  if (todayStatsContainer) {
    renderTodayStats(todayStatsContainer, todaySummary);
  }
  if (topAppsContainer) {
    renderTopApps(topAppsContainer, topApps);
  }
}
function bindSettingsSave(app) {
  const form = app.querySelector("#settings-form");
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
    const updates = [
      ["geminiApiKey", String(data.get("geminiApiKey") ?? "")],
      ["pollIntervalMs", String(data.get("pollIntervalMs") ?? "3000")],
      ["idleTimeoutMs", String(data.get("idleTimeoutMs") ?? "300000")],
      ["notificationCooldownMs", String(data.get("notificationCooldownMs") ?? "300000")],
      ["gracePeriodMs", String(data.get("gracePeriodMs") ?? "30000")],
      ["notificationsEnabled", data.get("notificationsEnabled") ? "true" : "false"]
    ];
    await Promise.all(updates.map(([key, value]) => rpc.setSetting({ key, value })));
  });
}
if (typeof document !== "undefined" && document.getElementById("app")) {
  const app = document.getElementById("app");
  initTabs(app);
  renderDashboardSkeleton(app);
  hydrateFromRPC(app);
  bindSettingsSave(app);
}
export {
  renderTopApps,
  renderTodayStats,
  renderSettings,
  initTabs,
  formatDuration2 as formatDuration
};
