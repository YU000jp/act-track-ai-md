import { describe, expect, it } from "bun:test";
import {
  parseClassificationResponse,
  buildClassificationPrompt,
  classifyWithGemini,
} from "../../src/bun/gemini";

describe("buildClassificationPrompt", () => {
  it("includes process name and window title", () => {
    const { system, user } = buildClassificationPrompt("chrome.exe", "YouTube - Google Chrome");
    expect(system).toContain("productivity classifier");
    expect(user).toContain("chrome.exe");
    expect(user).toContain("YouTube - Google Chrome");
  });
});

describe("parseClassificationResponse", () => {
  it("parses valid productive response", () => {
    const result = parseClassificationResponse('{"category":"productive","label":"Coding","confidence":0.92}');
    expect(result.category).toBe("productive");
    expect(result.label).toBe("Coding");
    expect(result.confidence).toBe(0.92);
  });

  it("parses valid distraction response", () => {
    const result = parseClassificationResponse('{"category":"distraction","label":"Social Media","confidence":0.88}');
    expect(result.category).toBe("distraction");
  });

  it("parses valid neutral response", () => {
    const result = parseClassificationResponse('{"category":"neutral","label":"File Manager","confidence":0.95}');
    expect(result.category).toBe("neutral");
  });

  it("rejects invalid category", () => {
    expect(() => parseClassificationResponse('{"category":"fun","label":"X","confidence":0.5}')).toThrow();
  });

  it("rejects missing label", () => {
    expect(() => parseClassificationResponse('{"category":"productive","confidence":0.5}')).toThrow();
  });

  it("rejects non-JSON", () => {
    expect(() => parseClassificationResponse("not json")).toThrow();
  });

  it("handles JSON wrapped in markdown code block", () => {
    const result = parseClassificationResponse('```json\n{"category":"productive","label":"Coding","confidence":0.9}\n```');
    expect(result.category).toBe("productive");
  });

  it("defaults confidence to 1.0 if missing", () => {
    const result = parseClassificationResponse('{"category":"productive","label":"Work"}');
    expect(result.confidence).toBe(1.0);
  });
});

describe("classifyWithGemini", () => {
  it("returns classification on successful API call", async () => {
    const fakeFetch = async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"category":"productive","label":"Coding","confidence":0.9}' }] } }],
    }));

    const result = await classifyWithGemini({
      apiKey: "test-key",
      processName: "code.exe",
      windowTitle: "index.ts",
      fetchImpl: fakeFetch as any,
    });
    expect(result.category).toBe("productive");
    expect(result.label).toBe("Coding");
  });

  it("throws on API error status", async () => {
    const fakeFetch = async () => new Response("Unauthorized", { status: 401 });

    expect(classifyWithGemini({
      apiKey: "bad-key",
      processName: "x.exe",
      windowTitle: "Y",
      fetchImpl: fakeFetch as any,
    })).rejects.toThrow();
  });

  it("throws on malformed API response", async () => {
    const fakeFetch = async () => new Response(JSON.stringify({ candidates: [] }));

    expect(classifyWithGemini({
      apiKey: "test-key",
      processName: "x.exe",
      windowTitle: "Y",
      fetchImpl: fakeFetch as any,
    })).rejects.toThrow();
  });
});
