import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { Datastores } from "./db";
import { formatAiSummaryForMarkdown } from "./summarizer";

type MarkdownExporterDeps = {
  datastores: Datastores;
  outputDir?: string | null;
  homeDirectory?: string;
};

type DayStats = {
  totalTrackedMs: number;
  productiveMs: number;
  distractionMs: number;
  neutralMs: number;
};

function getDayBounds(date: string): { start: number; end: number } {
  const start = new Date(`${date}T00:00:00`).getTime();
  return { start, end: start + 86_400_000 };
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const hh = `${d.getHours()}`.padStart(2, "0");
  const mm = `${d.getMinutes()}`.padStart(2, "0");
  return `${hh}:${mm}`;
}

function escapeCell(value: string): string {
  return value.replaceAll(/\r?\n/g, " ").replaceAll("|", "\\|");
}

function toTag(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const dashed = trimmed.replaceAll(/[^a-z0-9]+/g, "-");
  const normalized = dashed.replaceAll(/(^-|-$)/g, "");
  return normalized ? `#${normalized}` : "";
}

export function resolveMarkdownExportDirectory(configuredPath?: string | null, homeDirectory = homedir()): string {
  const basePath = configuredPath?.trim() ? configuredPath.trim() : join(homeDirectory, "act-track-logs");
  return resolve(isAbsolute(basePath) ? basePath : join(homeDirectory, basePath));
}

function buildSummary(date: string, datastores: Datastores): DayStats & { aiSummary: string | null; topApps: Array<{ processName: string; durationMs: number; category: string }> } {
  const summary = datastores.getDailySummary(date);
  if (summary) {
    return {
      totalTrackedMs: summary.totalTrackedMs,
      productiveMs: summary.productiveMs,
      distractionMs: summary.distractionMs,
      neutralMs: summary.neutralMs,
      aiSummary: summary.aiSummary,
      topApps: summary.topApps,
    };
  }

  const stats = datastores.getStatsForDay(date);
  return {
    ...stats,
    aiSummary: null,
    topApps: datastores.getTopAppsForDay(date, 10),
  };
}

export function createMarkdownExporter(deps: MarkdownExporterDeps) {
  async function exportDay(date: string): Promise<{ outputPath: string; markdown: string }> {
    const outputDirectory = resolveMarkdownExportDirectory(deps.outputDir, deps.homeDirectory);
    await mkdir(outputDirectory, { recursive: true });

    const { start, end } = getDayBounds(date);
    const activity = deps.datastores.getActivityRange(start, end);
    const summary = buildSummary(date, deps.datastores);

    const categories = [...new Set(summary.topApps.map((app) => app.category))];
    const labels = [...new Set(activity.map((sample) => sample.label).filter(Boolean))];
    const tags = [...categories.map((c) => toTag(c)), ...labels.map((l) => toTag(l))].filter(Boolean);

    const headerLines = [
      `# Activity Log: ${date}`,
      "",
      categories.length > 0 ? `Categories: ${categories.join(", ")}` : "Categories: none",
      tags.length > 0 ? `Tags: ${tags.join(" ")}` : "Tags: none",
      "",
      "## Stats",
      `- Total tracked: ${formatDuration(summary.totalTrackedMs)}`,
      `- Productive: ${formatDuration(summary.productiveMs)}`,
      `- Distraction: ${formatDuration(summary.distractionMs)}`,
      `- Neutral: ${formatDuration(summary.neutralMs)}`,
      "",
      formatAiSummaryForMarkdown(summary.aiSummary),
      "## Activity Log",
      "",
      "| Time | App | Window | Category | Label | Duration |",
      "| --- | --- | --- | --- | --- | --- |",
      ...activity.map((sample) => {
        return `| ${formatTimestamp(sample.timestamp)} | ${escapeCell(sample.processName)} | ${escapeCell(sample.windowTitle)} | ${sample.category} | ${escapeCell(sample.label)} | ${formatDuration(sample.durationMs)} |`;
      }),
    ];

    const markdown = headerLines.join("\n").replaceAll(/\n{3,}/g, "\n\n").trimEnd() + "\n";
    const outputPath = join(outputDirectory, `${date}.md`);
    await writeFile(outputPath, markdown, "utf8");

    return { outputPath, markdown };
  }

  return { exportDay };
}
