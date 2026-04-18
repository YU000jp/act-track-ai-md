import { beforeEach, describe, expect, it } from "bun:test";
import "./minidom";
import {
  formatDuration,
  initTabs,
  renderSettings,
  renderTodayStats,
  renderTopApps,
} from "../../src/views/dashboard/main";

describe("dashboard DOM", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("initTabs creates three tab buttons and switches panels", () => {
    document.body.innerHTML = `
      <div id="app">
        <nav id="tab-bar">
          <button class="tab-btn active" data-tab="today">Today</button>
          <button class="tab-btn" data-tab="statistics">Statistics</button>
          <button class="tab-btn" data-tab="settings">Settings</button>
        </nav>
        <section id="panel-today" class="panel active"></section>
        <section id="panel-statistics" class="panel"></section>
        <section id="panel-settings" class="panel"></section>
      </div>
    `;

    initTabs(document.getElementById("app")!);

    const tabs = document.querySelectorAll(".tab-btn");
    expect(tabs.length).toBe(3);

    (tabs[1] as HTMLElement).click();
    expect(document.getElementById("panel-statistics")!.classList.contains("active")).toBe(true);
    expect(document.getElementById("panel-today")!.classList.contains("active")).toBe(false);

    (tabs[2] as HTMLElement).click();
    expect(document.getElementById("panel-settings")!.classList.contains("active")).toBe(true);
    expect(document.getElementById("panel-statistics")!.classList.contains("active")).toBe(false);
  });

  it("renderTodayStats displays tracked totals", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    renderTodayStats(container, {
      trackedMs: 3_600_000,
      productiveMs: 2_400_000,
      distractionMs: 600_000,
      neutralMs: 600_000,
    });

    expect(container.textContent).toContain("1h 0m");
    expect(container.innerHTML).toContain("productive");
  });

  it("renderTopApps renders app entries", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    renderTopApps(container, [
      { processName: "code.exe", durationMs: 1_800_000, category: "productive" },
      { processName: "chrome.exe", durationMs: 600_000, category: "distraction" },
    ]);

    expect(container.textContent).toContain("code.exe");
    expect(container.textContent).toContain("chrome.exe");
  });

  it("renderSettings creates form with input fields", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    renderSettings(container, {
      geminiApiKey: "test-key",
      pollIntervalMs: 3000,
      idleTimeoutMs: 300000,
      notificationCooldownMs: 300000,
      gracePeriodMs: 30000,
      markdownExportPath: "/tmp/act-track-logs",
      notificationsEnabled: true,
      autoStart: true,
      classificationRulesJson: '[{"processNamePattern":"code","category":"productive","label":"Coding"}]',
      summaryLanguage: "Japanese",
      summaryTone: "reflective",
      markdownPrivacyMode: true,
      startInBackground: true,
    });

    const inputs = container.querySelectorAll("input");
    expect(inputs.length).toBeGreaterThanOrEqual(4);
    expect(container.innerHTML).toContain('id="markdownExportPath"');
    expect(container.innerHTML).toContain('value="/tmp/act-track-logs"');
    expect(container.innerHTML).toContain('id="classificationRulesJson"');
    expect(container.innerHTML).toContain('id="startInBackground"');
    expect(container.innerHTML).toContain("Restart required");
  });

  it("formatDuration formats milliseconds correctly", () => {
    expect(formatDuration(3_600_000)).toBe("1h 0m");
    expect(formatDuration(5_400_000)).toBe("1h 30m");
    expect(formatDuration(45_000)).toBe("0m 45s");
    expect(formatDuration(0)).toBe("0m 0s");
  });
});
