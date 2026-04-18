import type { ActivityCategory, ClassificationResult } from "../shared/types";
import { parseClassificationRules } from "../shared/settings";
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
  function findMatchingRule(processName: string, windowTitle: string) {
    const rules = parseClassificationRules(deps.datastores.getSetting("classificationRulesJson"));
    const normalizedProcess = processName.toLowerCase();
    const normalizedTitle = windowTitle.toLowerCase();

    return rules.find((rule) => {
      const processMatches = rule.processNamePattern
        ? normalizedProcess.includes(rule.processNamePattern.toLowerCase())
        : true;
      const titleMatches = rule.windowTitlePattern
        ? normalizedTitle.includes(rule.windowTitlePattern.toLowerCase())
        : true;

      return processMatches && titleMatches;
    });
  }

  return {
    async classify(processName: string, windowTitle: string): Promise<ClassificationResult> {
      const truncatedTitle = windowTitle.slice(0, 200);
      const matchingRule = findMatchingRule(processName, windowTitle);
      if (matchingRule) {
        return {
          category: matchingRule.category,
          label: matchingRule.label,
          confidence: 1,
          source: "rule",
        };
      }

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
        const apiKey = deps.datastores.getSetting("geminiApiKey") || deps.apiKey;
        const result = await deps.geminiClassify({
          apiKey,
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
