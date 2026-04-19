import type { DailySummary, ActivityCategory } from "../shared/types";
import type { Datastores } from "./db";
import type { MemoryStore } from "../lib/memory";

type FetchFn = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
type SummarizerDeps = {
  datastores: Datastores;
  apiKey: string;
  fetchImpl?: FetchFn;
  memoryStore?: MemoryStore;
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
        const memoryContext = await collectMemoryContext(date, topApps, summaryLanguage, summaryTone);
        const prompt = buildSummaryPrompt(date, stats, topApps, summaryLanguage, summaryTone, memoryContext);
        aiSummary = await callGeminiForSummary(prompt, apiKey, fetcher, summaryLanguage, summaryTone, memoryContext);
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

    if (deps.memoryStore) {
      const topAppNames = summary.topApps.map((app) => app.processName).join(", ");
      await deps.memoryStore.save({
        type: "context",
        content: `Daily summary context for ${date}: apps=${topAppNames || "none"}, trackedMs=${summary.totalTrackedMs}`,
        metadata: { date, summaryLanguage, summaryTone },
      });
      if (summary.aiSummary) {
        await deps.memoryStore.save({
          type: "pattern",
          content: summary.aiSummary,
          metadata: { date, source: "gemini-summary" },
        });
      }
    }
  }

  async function saveSummaryFeedback(input: { date: string; editedSummary: string; originalSummary?: string | null }): Promise<void> {
    const edited = input.editedSummary.trim();
    if (!edited) {
      return;
    }
    const existing = deps.datastores.getDailySummary(input.date);
    if (!existing) {
      return;
    }
    deps.datastores.saveDailySummary({
      ...existing,
      aiSummary: edited,
    });
    if (deps.memoryStore) {
      const originalSummary = input.originalSummary ?? existing.aiSummary;
      await deps.memoryStore.save({
        type: "feedback",
        content: edited,
        metadata: originalSummary ? { date: input.date, originalSummary } : { date: input.date },
      });
      await deps.memoryStore.save({
        type: "pattern",
        content: edited,
        metadata: {
          date: input.date,
          source: "user-feedback",
        },
      });
    }
  }

  async function collectMemoryContext(
    date: string,
    topApps: Array<{ processName: string; durationMs: number; category: ActivityCategory }>,
    summaryLanguage: string,
    summaryTone: string,
  ): Promise<{ patterns: string[]; contexts: string[] }> {
    if (!deps.memoryStore) {
      return { patterns: [], contexts: [] };
    }

    const query = `${date} ${summaryLanguage} ${summaryTone} ${topApps.map((app) => app.processName).join(" ")}`;
    const results = await deps.memoryStore.search(query, 6);
    const patterns: string[] = [];
    const contexts: string[] = [];
    for (const memory of results) {
      if (memory.type === "pattern" || memory.type === "feedback") {
        patterns.push(memory.content);
      } else {
        contexts.push(memory.content);
      }
    }

    return {
      patterns: patterns.slice(0, 3),
      contexts: contexts.slice(0, 3),
    };
  }

  return { generateDailySummary, saveSummaryFeedback };
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
  memoryContext: { patterns: string[]; contexts: string[] },
): string {
  const formatMs = (ms: number) => {
    const hours = Math.floor(ms / 3_600_000);
    const minutes = Math.floor((ms % 3_600_000) / 60_000);
    return `${hours}h ${minutes}m`;
  };

  const appList = topApps
    .map((app) => `- ${app.processName}: ${formatMs(app.durationMs)} (${app.category})`)
    .join("\n");
  const styleHints = memoryContext.patterns.length > 0 ? memoryContext.patterns.map((pattern) => `- ${pattern}`).join("\n") : "- none";
  const contextHints = memoryContext.contexts.length > 0 ? memoryContext.contexts.map((context) => `- ${context}`).join("\n") : "- none";

  return `Summarize my productivity for ${date}.

Total tracked: ${formatMs(stats.totalTrackedMs)}
Productive: ${formatMs(stats.productiveMs)}
Distraction: ${formatMs(stats.distractionMs)}
Neutral: ${formatMs(stats.neutralMs)}

Top apps:
${appList || "No apps tracked"}

Preferred markdown style patterns from my history:
${styleHints}

Relevant past context from my history:
${contextHints}

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
  memoryContext: { patterns: string[]; contexts: string[] },
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
            text:
              `You are a productivity coach. Provide brief daily summaries in ${summaryLanguage} with a ${summaryTone} tone.\n` +
              `When available, follow these preferred markdown style patterns:\n${memoryContext.patterns.join("\n") || "- none"}\n` +
              `Relevant past context:\n${memoryContext.contexts.join("\n") || "- none"}`,
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
