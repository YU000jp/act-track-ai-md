import { describe, expect, it } from "bun:test";
import { createMemoryStore } from "../../src/lib/memory";

describe("memory store", () => {
  it("saves and recalls entries from local sqlite backend", async () => {
    const memory = createMemoryStore({
      dbPath: ":memory:",
      moduleLoader: async () => {
        throw new Error("agentkits unavailable");
      },
    });
    await memory.initialize();

    await memory.save({
      type: "context",
      content: "Worked on markdown exporter refactor",
      metadata: { date: "2026-04-19" },
    });
    await memory.save({
      type: "pattern",
      content: "Prefer short bullet-list summary style",
    });

    const recalled = await memory.recall(10);
    expect(recalled.length).toBe(2);
    expect(recalled[0].content.length).toBeGreaterThan(0);

    const searchResults = await memory.search("markdown summary style", 5);
    expect(searchResults.length).toBeGreaterThan(0);
  });

  it("supports pin and forget operations", async () => {
    const memory = createMemoryStore({
      dbPath: ":memory:",
      moduleLoader: async () => {
        throw new Error("agentkits unavailable");
      },
    });
    await memory.initialize();

    await memory.save({ type: "context", content: "temporary memory" });
    const list = await memory.recall(10);
    expect(list.length).toBe(1);

    await memory.pin(list[0].id, true);
    const statusPinned = await memory.getStatus();
    expect(statusPinned.pinned).toBe(1);

    await memory.forget(list[0].id);
    const status = await memory.getStatus();
    expect(status.total).toBe(0);
  });
});
