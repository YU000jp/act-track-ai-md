import { describe, it, expect, beforeEach } from "bun:test";
import { createDatastores } from "../../src/bun/db";
import { createSummarizer } from "../../src/bun/summarizer";
import type { MemoryStore } from "../../src/lib/memory";

describe("createSummarizer", () => {
  let datastores: ReturnType<typeof createDatastores>;
  let geminiCalls: Array<{ prompt: string }>;
  let geminiResponse: string;
  let memorySaves: Array<{ type: string; content: string }>;

  beforeEach(() => {
    datastores = createDatastores(":memory:", ":memory:");
    geminiCalls = [];
    geminiResponse = "You had a productive day focusing on coding.";
    memorySaves = [];
  });

  function createMemoryStoreStub(searchResults: Array<{ type: "pattern" | "context" | "feedback" | "observation"; content: string }> = []): MemoryStore {
    return {
      initialize: async () => {},
      save: async (input) => {
        memorySaves.push({ type: input.type, content: input.content });
      },
      search: async () =>
        searchResults.map((result, index) => ({
          id: index + 1,
          type: result.type,
          content: result.content,
          metadata: {},
          pinned: false,
          createdAt: Date.now(),
          score: 0.9,
        })),
      recall: async () => [],
      forget: async () => {},
      pin: async () => {},
      getStatus: async () => ({ enabled: true, backend: "sqlite", total: 0, pinned: 0 }),
    };
  }

  function mockFetchImpl(responseText: string) {
    return async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      geminiCalls.push({ prompt: body.contents[0].parts[0].text });

      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: responseText }] } }],
        }),
      );
    };
  }

  it("aggregates day data and calls Gemini for summary", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const baseTs = new Date(`${today}T10:00:00`).getTime();
    datastores.setSetting("summaryLanguage", "Japanese");
    datastores.setSetting("summaryTone", "reflective");

    datastores.insertActivitySample({
      timestamp: baseTs,
      processName: "code.exe",
      windowTitle: "index.ts",
      category: "productive",
      label: "Coding",
    });
    datastores.setActivityDuration(1, 3_600_000);

    datastores.insertActivitySample({
      timestamp: baseTs + 3_600_000,
      processName: "chrome.exe",
      windowTitle: "YouTube",
      category: "distraction",
      label: "Video",
    });
    datastores.setActivityDuration(2, 600_000);

    const summarizer = createSummarizer({
      datastores,
      apiKey: "test-key",
      fetchImpl: mockFetchImpl(geminiResponse),
      memoryStore: createMemoryStoreStub([
        { type: "pattern", content: "Use concise bullet points." },
        { type: "context", content: "User worked on TypeScript refactoring recently." },
      ]),
    });

    await summarizer.generateDailySummary(today);

    expect(geminiCalls.length).toBe(1);
    expect(geminiCalls[0].prompt).toContain("code.exe");
    expect(geminiCalls[0].prompt).toContain("chrome.exe");
    expect(geminiCalls[0].prompt).toContain("Japanese");
    expect(geminiCalls[0].prompt).toContain("reflective");
    expect(geminiCalls[0].prompt).toContain("Use concise bullet points.");
    expect(geminiCalls[0].prompt).toContain("TypeScript refactoring");

    const summary = datastores.getDailySummary(today);
    expect(summary).not.toBeNull();
    expect(summary!.aiSummary).toBe(geminiResponse);
    expect(summary!.productiveMs).toBe(3_600_000);
    expect(summary!.distractionMs).toBe(600_000);
    expect(memorySaves.length).toBeGreaterThanOrEqual(2);
  });

  it("stores summary with stats even if no activities", async () => {
    const today = new Date().toISOString().slice(0, 10);

    const summarizer = createSummarizer({
      datastores,
      apiKey: "test-key",
      fetchImpl: mockFetchImpl("No activity recorded today."),
    });

    await summarizer.generateDailySummary(today);

    const summary = datastores.getDailySummary(today);
    expect(summary).not.toBeNull();
    expect(summary!.totalTrackedMs).toBe(0);
  });

  it("handles Gemini failure gracefully - stores summary without AI text", async () => {
    const today = new Date().toISOString().slice(0, 10);

    datastores.insertActivitySample({
      timestamp: new Date(`${today}T10:00:00`).getTime(),
      processName: "code.exe",
      windowTitle: "app.ts",
      category: "productive",
      label: "Coding",
    });
    datastores.setActivityDuration(1, 1_800_000);

    const summarizer = createSummarizer({
      datastores,
      apiKey: "test-key",
      fetchImpl: async () => new Response("Server Error", { status: 500 }),
    });

    await summarizer.generateDailySummary(today);

    const summary = datastores.getDailySummary(today);
    expect(summary).not.toBeNull();
    expect(summary!.productiveMs).toBe(1_800_000);
    expect(summary!.aiSummary).toBeNull();
  });

  it("skips Gemini call when no API key", async () => {
    const today = new Date().toISOString().slice(0, 10);

    const summarizer = createSummarizer({
      datastores,
      apiKey: "",
      fetchImpl: mockFetchImpl("should not be called"),
    });

    await summarizer.generateDailySummary(today);

    expect(geminiCalls.length).toBe(0);
    const summary = datastores.getDailySummary(today);
    expect(summary).not.toBeNull();
    expect(summary!.aiSummary).toBeNull();
  });

  it("prefers the latest API key stored in settings", async () => {
    const today = new Date().toISOString().slice(0, 10);
    datastores.setSetting("geminiApiKey", "fresh-key");

    datastores.insertActivitySample({
      timestamp: new Date(`${today}T10:00:00`).getTime(),
      processName: "code.exe",
      windowTitle: "app.ts",
      category: "productive",
      label: "Coding",
    });
    datastores.setActivityDuration(1, 1_800_000);

    let calledUrl = "";
    const summarizer = createSummarizer({
      datastores,
      apiKey: "stale-key",
      fetchImpl: async (url) => {
        calledUrl = String(url);
        return new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ text: "fresh summary" }] } }],
        }));
      },
    });

    await summarizer.generateDailySummary(today);

    expect(calledUrl).toContain("fresh-key");
  });

  it("stores user edited summary as feedback memory", async () => {
    const today = new Date().toISOString().slice(0, 10);
    datastores.saveDailySummary({
      date: today,
      totalTrackedMs: 60_000,
      productiveMs: 60_000,
      distractionMs: 0,
      neutralMs: 0,
      topApps: [{ processName: "code.exe", durationMs: 60_000, category: "productive" }],
      aiSummary: "Initial summary",
    });

    const summarizer = createSummarizer({
      datastores,
      apiKey: "test-key",
      memoryStore: createMemoryStoreStub(),
      fetchImpl: mockFetchImpl("unused"),
    });

    await summarizer.saveSummaryFeedback({
      date: today,
      editedSummary: "Edited final summary",
      originalSummary: "Initial summary",
    });

    const updated = datastores.getDailySummary(today);
    expect(updated?.aiSummary).toBe("Edited final summary");
    expect(memorySaves.some((entry) => entry.type === "feedback")).toBe(true);
  });
});
