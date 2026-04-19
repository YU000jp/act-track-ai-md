import { describe, expect, it } from "bun:test";
import { createDatastores } from "../../src/bun/db";
import { createRPCHandlers } from "../../src/bun/rpc";
import { createMemoryStore } from "../../src/lib/memory";

describe("rpc handlers memory integration", () => {
  it("returns memory status and supports pin/forget", async () => {
    const stores = createDatastores(":memory:", ":memory:");
    const memory = createMemoryStore({
      dbPath: ":memory:",
      moduleLoader: async () => {
        throw new Error("agentkits unavailable");
      },
    });
    await memory.initialize();
    await memory.save({ type: "context", content: "test memory entry" });

    const handlers = createRPCHandlers(stores, undefined, memory);
    const statusBefore = await handlers.getMemoryStatus();
    expect(statusBefore.total).toBe(1);

    const list = await handlers.listMemories(5);
    expect(list.length).toBe(1);

    await handlers.pinMemory({ id: list[0].id, pinned: true });
    const statusPinned = await handlers.getMemoryStatus();
    expect(statusPinned.pinned).toBe(1);

    await handlers.forgetMemory(list[0].id);
    const statusAfter = await handlers.getMemoryStatus();
    expect(statusAfter.total).toBe(0);
  });

  it("stores summary feedback through summarizer hook", async () => {
    const stores = createDatastores(":memory:", ":memory:");
    const feedbackCalls: Array<{ date: string; editedSummary: string }> = [];
    const handlers = createRPCHandlers(stores, {
      generateDailySummary: async () => {},
      saveSummaryFeedback: async (input) => {
        feedbackCalls.push({ date: input.date, editedSummary: input.editedSummary });
      },
    });

    await handlers.saveSummaryFeedback({
      date: "2026-04-19",
      editedSummary: "Updated summary",
    });

    expect(feedbackCalls).toHaveLength(1);
    expect(feedbackCalls[0].editedSummary).toBe("Updated summary");
  });
});
