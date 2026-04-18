import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatastores } from "../../src/bun/db";
import { createMarkdownExporter, resolveMarkdownExportDirectory } from "../../src/bun/md-exporter";

describe("markdown exporter", () => {
  let datastores: ReturnType<typeof createDatastores>;
  let tempDir: string;

  beforeEach(async () => {
    datastores = createDatastores(":memory:", ":memory:");
    tempDir = await mkdtemp(join(tmpdir(), "act-track-md-test-"));
  });

  afterEach(async () => {
    datastores.activity.close(false);
    datastores.cache.close(false);
    await rm(tempDir, { recursive: true, force: true });
  });

  it("exports a day markdown file including summary and tags", async () => {
    const date = "2026-04-18";
    const baseTs = new Date(`${date}T09:00:00`).getTime();

    datastores.insertActivitySample({
      timestamp: baseTs,
      processName: "code.exe",
      windowTitle: "src/bun/md-exporter.ts",
      category: "productive",
      label: "Coding",
    });
    datastores.setActivityDuration(1, 3_600_000);

    datastores.insertActivitySample({
      timestamp: baseTs + 3_600_000,
      processName: "chrome.exe",
      windowTitle: "Video Site",
      category: "distraction",
      label: "Video",
    });
    datastores.setActivityDuration(2, 1_200_000);

    datastores.saveDailySummary({
      date,
      totalTrackedMs: 4_800_000,
      productiveMs: 3_600_000,
      distractionMs: 1_200_000,
      neutralMs: 0,
      topApps: [
        { processName: "code.exe", durationMs: 3_600_000, category: "productive" },
        { processName: "chrome.exe", durationMs: 1_200_000, category: "distraction" },
      ],
      aiSummary: "今日は開発に集中できました。",
    });

    const exporter = createMarkdownExporter({
      datastores,
      outputDir: tempDir,
    });

    const result = await exporter.exportDay(date);
    const saved = await Bun.file(result.outputPath).text();

    expect(saved).toContain("# Activity Log: 2026-04-18");
    expect(saved).toContain("## AI Summary");
    expect(saved).toContain("今日は開発に集中できました。");
    expect(saved).toContain("Categories: productive, distraction");
    expect(saved).toContain("#productive");
    expect(saved).toContain("| 09:00 | code.exe |");
  });

  it("resolves default export directory under home when path is empty", async () => {
    const customHome = join(tempDir, "home");
    await mkdir(customHome, { recursive: true });

    const resolved = resolveMarkdownExportDirectory("", customHome);
    expect(resolved).toBe(join(customHome, "act-track-logs"));

    const exporter = createMarkdownExporter({
      datastores,
      outputDir: "",
      homeDirectory: customHome,
    });

    const { outputPath } = await exporter.exportDay("2026-04-18");
    const fileStat = await stat(outputPath);
    expect(fileStat.isFile()).toBe(true);
  });

  it("hides window titles in markdown privacy mode", async () => {
    const date = "2026-04-18";
    const baseTs = new Date(`${date}T09:00:00`).getTime();
    datastores.setSetting("markdownPrivacyMode", "true");

    datastores.insertActivitySample({
      timestamp: baseTs,
      processName: "mail.exe",
      windowTitle: "Quarterly Report - Confidential",
      category: "neutral",
      label: "Email",
    });
    datastores.setActivityDuration(1, 600_000);

    const exporter = createMarkdownExporter({
      datastores,
      outputDir: tempDir,
    });

    const result = await exporter.exportDay(date);
    const saved = await Bun.file(result.outputPath).text();

    expect(saved).toContain("[hidden]");
    expect(saved).not.toContain("Quarterly Report - Confidential");
  });
});
