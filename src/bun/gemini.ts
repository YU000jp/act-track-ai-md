import { ActivityCategory } from "../shared/types";

const VALID_CATEGORIES = ["productive", "distraction", "neutral"] as const;
type ValidCategory = (typeof VALID_CATEGORIES)[number];

export function buildClassificationPrompt(
  processName: string,
  windowTitle: string
): { system: string; user: string } {
  const system =
    "You are a productivity classifier. Given a process name and window title, classify the activity. " +
    "Respond with JSON only: { \"category\": \"productive\" | \"distraction\" | \"neutral\", \"label\": string, \"confidence\": number }";

  const user = `Process: ${processName}\nWindow Title: ${windowTitle}`;

  return { system, user };
}

export function parseClassificationResponse(raw: string): {
  category: ActivityCategory;
  label: string;
  confidence: number;
} {
  let cleaned = raw.trim();


  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Invalid JSON response: ${raw}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Response is not an object");
  }

  const obj = parsed as Record<string, unknown>;

  const category = obj.category;
  if (
    typeof category !== "string" ||
    !(VALID_CATEGORIES as readonly string[]).includes(category)
  ) {
    throw new Error(`Invalid category: ${String(category)}`);
  }

  const label = obj.label;
  if (typeof label !== "string" || label.trim() === "") {
    throw new Error("Missing or empty label");
  }

  const confidence =
    typeof obj.confidence === "number" ? obj.confidence : 1.0;

  return {
    category: category as ValidCategory,
    label,
    confidence,
  };
}

export async function classifyWithGemini(opts: {
  apiKey: string;
  processName: string;
  windowTitle: string;
  fetchImpl?: typeof fetch;
}): Promise<{ category: ActivityCategory; label: string; confidence: number }> {
  const { apiKey, processName, windowTitle, fetchImpl } = opts;
  const fetcher = fetchImpl ?? fetch;

  const { system, user } = buildClassificationPrompt(processName, windowTitle);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [{ text: user }] }],
    systemInstruction: { parts: [{ text: system }] },
  };

  const response = await fetcher(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content: { parts: Array<{ text: string }> } }>;
  };

  if (!data.candidates || data.candidates.length === 0) {
    throw new Error("No candidates in Gemini response");
  }

  const text = data.candidates[0].content.parts[0].text;
  return parseClassificationResponse(text);
}
