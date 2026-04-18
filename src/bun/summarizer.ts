import type { DailySummary, ActivityCategory } from "../shared/types";
import type { Datastores } from "./db";

type FetchFn = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
type SummarizerDeps = {
  datastores: Datastores;
  apiKey: string;
  fetchImpl?: FetchFn;
};

export function createSummarizer(deps: SummarizerDeps) {
  const fetcher = deps.fetchImpl ?? fetch;

  async function generateDailySummary(date: string): Promise<void> {
    const stats = deps.datastores.getStatsForDay(date);
    const topApps = deps.datastores.getTopAppsForDay(date, 10);
    const apiKey = deps.datastores.getSetting("geminiApiKey") || deps.apiKey;
    const summaryLanguage = deps.datastores.getSetting("summaryLanguage") || "Japanese";
    const summaryTone = deps.datastores.getSetting("summaryTone") || "encouraging";

    let aiSummary: string | null = null;

    if (apiKey && stats.totalTrackedMs > 0) {
      try {
        const prompt = buildSummaryPrompt(date, stats, topApps, summaryLanguage, summaryTone);
        aiSummary = await callGeminiForSummary(prompt, apiKey, fetcher, summaryLanguage, summaryTone);
      } catch {
        aiSummary = null;
      }
    }

    const summary: DailySummary = {
      date,
      totalTrackedMs: stats.totalTrackedMs,
      productiveMs: stats.productiveMs,
      distractionMs: stats.distractionMs,
      neutralMs: stats.neutralMs,
      topApps: topApps.map((app) => ({
        processName: app.processName,
        durationMs: app.durationMs,
        category: app.category,
      })),
      aiSummary,
    };

    deps.datastores.saveDailySummary(summary);
  }

  return { generateDailySummary };
}

export function formatAiSummaryForMarkdown(aiSummary: string | null): string {
  if (!aiSummary) {
    return "";
  }
  return `## AI Summary\n\n${aiSummary}\n`;
}

function buildSummaryPrompt(
  date: string,
  stats: {
    totalTrackedMs: number;
    productiveMs: number;
    distractionMs: number;
    neutralMs: number;
  },
  topApps: Array<{ processName: string; durationMs: number; category: ActivityCategory }>,
  summaryLanguage: string,
  summaryTone: string,
): string {
  const formatMs = (ms: number) => {
    const hours = Math.floor(ms / 3_600_000);
    const minutes = Math.floor((ms % 3_600_000) / 60_000);
    return `${hours}h ${minutes}m`;
  };

  const appList = topApps
    .map((app) => `- ${app.processName}: ${formatMs(app.durationMs)} (${app.category})`)
    .join("\n");

  return `Summarize my productivity for ${date}.

Total tracked: ${formatMs(stats.totalTrackedMs)}
Productive: ${formatMs(stats.productiveMs)}
Distraction: ${formatMs(stats.distractionMs)}
Neutral: ${formatMs(stats.neutralMs)}

Top apps:
${appList || "No apps tracked"}

Write a brief 2-3 sentence summary in ${summaryLanguage}.
Tone: ${summaryTone}.
Focus on what went well and one area to improve.`;
}

async function callGeminiForSummary(
  prompt: string,
  apiKey: string,
  fetcher: FetchFn,
  summaryLanguage: string,
  summaryTone: string,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

  const response = await fetcher(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        systemInstruction: {
          parts: [
            {
              text: `You are a productivity coach. Provide brief daily summaries in ${summaryLanguage} with a ${summaryTone} tone.`,
            },
          ],
        },
      }),
  });

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content: { parts: Array<{ text: string }> } }>;
  };

  if (!data.candidates || data.candidates.length === 0) {
    throw new Error("No candidates in Gemini response");
  }

  return data.candidates[0].content.parts[0].text;
}
