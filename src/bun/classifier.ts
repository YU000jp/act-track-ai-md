import type { ActivityCategory, ClassificationResult } from "../shared/types";
import type { Datastores } from "./db";

type GeminiFn = (opts: {
  apiKey: string;
  processName: string;
  windowTitle: string;
}) => Promise<{ category: ActivityCategory; label: string; confidence: number }>;

type ClassifierDeps = {
  datastores: Datastores;
  geminiClassify: GeminiFn;
  apiKey: string;
};

export function createClassifier(deps: ClassifierDeps) {
  return {
    async classify(processName: string, windowTitle: string): Promise<ClassificationResult> {
      const truncatedTitle = windowTitle.slice(0, 200);

      const cached = deps.datastores.getCachedClassification(processName, truncatedTitle);
      if (cached) {
        return {
          category: cached.category,
          label: cached.label,
          confidence: cached.confidence,
          source: "cache",
        };
      }

      try {
        const result = await deps.geminiClassify({
          apiKey: deps.apiKey,
          processName,
          windowTitle,
        });

        deps.datastores.upsertCachedClassification(
          processName,
          truncatedTitle,
          result.category,
          result.label,
          result.confidence,
        );

        return {
          category: result.category,
          label: result.label,
          confidence: result.confidence,
          source: "gemini",
        };
      } catch {
        return {
          category: "unknown",
          label: "Uncategorized",
          confidence: 0,
          source: "fallback",
        };
      }
    },
  };
}
