import { describe, it, expect, beforeEach } from "bun:test";
import { createDatastores } from "../../src/bun/db";
import { createClassifier } from "../../src/bun/classifier";
import type { ActivityCategory } from "../../src/shared/types";

describe("createClassifier", () => {
  let datastores: ReturnType<typeof createDatastores>;
  let geminiCallCount: number;
  let geminiResult: { category: ActivityCategory; label: string; confidence: number };
  let geminiShouldThrow: boolean;

  function mockGemini(opts: {
    apiKey: string;
    processName: string;
    windowTitle: string;
  }): Promise<{ category: ActivityCategory; label: string; confidence: number }> {
    geminiCallCount++;
    if (geminiShouldThrow) {
      throw new Error("Gemini API error");
    }
    return Promise.resolve(geminiResult);
  }

  beforeEach(() => {
    datastores = createDatastores(":memory:", ":memory:");
    geminiCallCount = 0;
    geminiShouldThrow = false;
    geminiResult = { category: "productive", label: "Coding", confidence: 0.9 };
  });

  it("returns cached result on cache hit without calling Gemini", async () => {
    datastores.upsertCachedClassification(
      "code",
      "editor - file.ts",
      "productive",
      "Coding",
      0.95,
    );

    const classifier = createClassifier({
      datastores,
      geminiClassify: mockGemini,
      apiKey: "test-key",
    });

    const result = await classifier.classify("code", "editor - file.ts");

    expect(result.category).toBe("productive");
    expect(result.label).toBe("Coding");
    expect(result.confidence).toBe(0.95);
    expect(result.source).toBe("cache");
    expect(geminiCallCount).toBe(0);
  });

  it("calls Gemini on cache miss and stores result", async () => {
    geminiResult = { category: "productive", label: "Coding", confidence: 0.9 };

    const classifier = createClassifier({
      datastores,
      geminiClassify: mockGemini,
      apiKey: "test-key",
    });

    const result = await classifier.classify("code", "editor - file.ts");

    expect(result.category).toBe("productive");
    expect(result.label).toBe("Coding");
    expect(result.confidence).toBe(0.9);
    expect(result.source).toBe("gemini");
    expect(geminiCallCount).toBe(1);


    const cached = datastores.getCachedClassification("code", "editor - file.ts");
    expect(cached).not.toBeNull();
    expect(cached?.category).toBe("productive");
    expect(cached?.label).toBe("Coding");
  });

  it("returns unknown fallback when Gemini fails", async () => {
    geminiShouldThrow = true;

    const classifier = createClassifier({
      datastores,
      geminiClassify: mockGemini,
      apiKey: "test-key",
    });

    const result = await classifier.classify("code", "editor - file.ts");

    expect(result.category).toBe("unknown");
    expect(result.label).toBe("Uncategorized");
    expect(result.confidence).toBe(0);
    expect(result.source).toBe("fallback");
  });

  it("truncates window title to 200 chars for cache key", async () => {
    const truncatedTitle = "a".repeat(200);
    const longTitle = "a".repeat(300);


    datastores.upsertCachedClassification(
      "code",
      truncatedTitle,
      "productive",
      "Coding",
      0.8,
    );

    const classifier = createClassifier({
      datastores,
      geminiClassify: mockGemini,
      apiKey: "test-key",
    });


    const result = await classifier.classify("code", longTitle);

    expect(result.source).toBe("cache");
    expect(result.category).toBe("productive");
    expect(geminiCallCount).toBe(0);
  });
});
