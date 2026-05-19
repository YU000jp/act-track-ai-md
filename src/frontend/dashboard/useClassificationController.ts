import { createMemo, createSignal } from "solid-js";
import { serializeClassificationRules } from "../../shared/settings";
import type {
  ActivityCategory,
  ActivitySample,
  ClassificationRuleDraft,
  ClassificationRuleRecord,
  ClassificationRuleScope,
} from "../../shared/types";
import type { DashboardClient } from "./tauri-bridge";
import type { DashboardToast } from "./types";

type RuleStatusFilter = "all" | "enabled" | "disabled";
type RuleCategoryFilter = "all" | ActivityCategory;
type RuleSourceFilter = "all" | string;
type RuleMoveDirection = "up" | "down";

type ClassificationRuleFormState = ClassificationRuleDraft & {
  id: number | null;
  priority: number;
  source: string;
  hitCount: number;
  lastUsedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

type UseClassificationControllerProps = {
  rpc: DashboardClient;
  reportError: (context: string, error: unknown) => void;
  pushToast: (kind: DashboardToast["kind"], title: string, message: string) => void;
  syncSettingsJson: (value: string) => void;
};

export type ClassificationController = {
  rules: () => ClassificationRuleRecord[];
  filteredRules: () => ClassificationRuleRecord[];
  sourceOptions: () => string[];
  titleScopeSuggestion: () => "both" | null;
  searchQuery: () => string;
  categoryFilter: () => RuleCategoryFilter;
  enabledFilter: () => RuleStatusFilter;
  scopeFilter: () => "all" | ClassificationRuleScope;
  sourceFilter: () => RuleSourceFilter;
  draft: () => ClassificationRuleFormState;
  feedback: () => string;
  hydrateRules: (rules: ClassificationRuleRecord[]) => void;
  reloadRules: () => Promise<void>;
  setSearchQuery: (value: string) => void;
  setCategoryFilter: (value: RuleCategoryFilter) => void;
  setEnabledFilter: (value: RuleStatusFilter) => void;
  setScopeFilter: (value: "all" | ClassificationRuleScope) => void;
  setSourceFilter: (value: RuleSourceFilter) => void;
  resetFilters: () => void;
  beginCreateRule: () => void;
  beginCreateRuleFromWindow: (sample: ActivitySample) => void;
  beginEditRule: (rule: ClassificationRuleRecord) => void;
  duplicateRule: (rule: ClassificationRuleRecord) => Promise<void>;
  moveRule: (rule: ClassificationRuleRecord, direction: RuleMoveDirection) => Promise<void>;
  reorderRule: (rule: ClassificationRuleRecord, targetRule: ClassificationRuleRecord, placement?: "before" | "after") => Promise<void>;
  duplicateSuggestions: () => ClassificationRuleRecord[];
  hasDuplicateDraft: () => boolean;
  clearDraft: () => void;
  updateDraft: <K extends keyof ClassificationRuleDraft>(key: K, value: ClassificationRuleDraft[K]) => void;
  saveDraft: (event: SubmitEvent) => Promise<void>;
  toggleRuleEnabled: (rule: ClassificationRuleRecord) => Promise<void>;
  deleteRule: (rule: ClassificationRuleRecord) => Promise<void>;
};

const EMPTY_DRAFT: ClassificationRuleFormState = {
  id: null,
  priority: 0,
  processNamePattern: "",
  windowTitlePattern: "",
  category: "productive",
  label: "",
  enabled: true,
  scope: "both",
  source: "manual",
  hitCount: 0,
  lastUsedAt: null,
  createdAt: 0,
  updatedAt: 0,
};

function normalizeCategory(category: ActivityCategory): ClassificationRuleDraft["category"] {
  return category === "productive" || category === "distraction" || category === "neutral"
    ? category
    : "productive";
}

function toDraft(rule: ClassificationRuleRecord): ClassificationRuleDraft {
  return {
    processNamePattern: rule.processNamePattern,
    windowTitlePattern: rule.windowTitlePattern,
    category: rule.category,
    label: rule.label,
    enabled: rule.enabled,
    scope: rule.scope,
  };
}

function toFormState(rule: ClassificationRuleRecord): ClassificationRuleFormState {
  return {
    id: rule.id,
    priority: rule.priority,
    processNamePattern: rule.processNamePattern,
    windowTitlePattern: rule.windowTitlePattern,
    category: rule.category,
    label: rule.label,
    enabled: rule.enabled,
    scope: rule.scope,
    source: rule.source,
    hitCount: rule.hitCount,
    lastUsedAt: rule.lastUsedAt,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

function serializeRulesJson(rules: ClassificationRuleRecord[]): string {
  return serializeClassificationRules(rules.map(toDraft));
}

function sortRules(rules: ClassificationRuleRecord[]): ClassificationRuleRecord[] {
  return [...rules].sort((left, right) => {
    if (left.priority !== right.priority) {
      return right.priority - left.priority;
    }

    if (left.enabled !== right.enabled) {
      return left.enabled ? -1 : 1;
    }

    const leftLastUsed = left.lastUsedAt ?? 0;
    const rightLastUsed = right.lastUsedAt ?? 0;
    if (leftLastUsed !== rightLastUsed) {
      return rightLastUsed - leftLastUsed;
    }

    if (left.hitCount !== right.hitCount) {
      return right.hitCount - left.hitCount;
    }

    if (left.updatedAt !== right.updatedAt) {
      return right.updatedAt - left.updatedAt;
    }

    return right.id - left.id;
  });
}

function replaceRule(rules: ClassificationRuleRecord[], nextRule: ClassificationRuleRecord): ClassificationRuleRecord[] {
  const nextRules = rules.filter((rule) => rule.id !== nextRule.id);
  nextRules.push(nextRule);
  return sortRules(nextRules);
}

function ruleMatchesSearch(rule: ClassificationRuleRecord, query: string): boolean {
  if (!query) {
    return true;
  }

  const haystack = [
    rule.label,
    rule.processNamePattern,
    rule.windowTitlePattern,
    rule.scope,
    rule.source,
    rule.category,
    String(rule.priority),
    String(rule.hitCount),
  ]
    .join(" ")
    .toLowerCase();

  return query
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

function duplicateLabel(label: string): string {
  const baseLabel = label.trim() || "Untitled rule";
  if (baseLabel.endsWith(" (copy)")) {
    return `${baseLabel} 2`;
  }

  return `${baseLabel} (copy)`;
}

function normalizePattern(value: string): string {
  return value.trim().toLowerCase();
}

function ruleDuplicateKey(
  processNamePattern: string,
  windowTitlePattern: string,
  scope: ClassificationRuleScope,
  category: ActivityCategory,
): string {
  return [
    normalizePattern(processNamePattern),
    normalizePattern(windowTitlePattern),
    scope,
    category,
  ].join("|");
}

export function useClassificationController(props: UseClassificationControllerProps): ClassificationController {
  const [rules, setRules] = createSignal<ClassificationRuleRecord[]>([]);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [categoryFilter, setCategoryFilter] = createSignal<RuleCategoryFilter>("all");
  const [enabledFilter, setEnabledFilter] = createSignal<RuleStatusFilter>("all");
  const [scopeFilter, setScopeFilter] = createSignal<"all" | ClassificationRuleScope>("all");
  const [sourceFilter, setSourceFilter] = createSignal<RuleSourceFilter>("all");
  const [draft, setDraft] = createSignal<ClassificationRuleFormState>({ ...EMPTY_DRAFT });
  const [feedback, setFeedback] = createSignal("");

  const sourceOptions = createMemo(() => {
    const sources = new Set<string>();
    for (const rule of rules()) {
      sources.add(rule.source);
    }

    return [...sources].sort((left, right) => left.localeCompare(right));
  });

  const filteredRules = createMemo(() => {
    const query = searchQuery().trim().toLowerCase();
    const category = categoryFilter();
    const enabled = enabledFilter();
    const scope = scopeFilter();
    const source = sourceFilter();

    return rules().filter((rule) => {
      if (category !== "all" && rule.category !== category) {
        return false;
      }

      if (enabled === "enabled" && !rule.enabled) {
        return false;
      }

      if (enabled === "disabled" && rule.enabled) {
        return false;
      }

      if (scope !== "all" && rule.scope !== scope) {
        return false;
      }

      if (source !== "all" && rule.source !== source) {
        return false;
      }

      return ruleMatchesSearch(rule, query);
    });
  });

  const duplicateSuggestions = createMemo(() => {
    const current = draft();
    const hasPattern = normalizePattern(current.processNamePattern).length > 0 || normalizePattern(current.windowTitlePattern).length > 0;
    if (!hasPattern) {
      return [];
    }

    const currentKey = ruleDuplicateKey(
      current.processNamePattern,
      current.windowTitlePattern,
      current.scope,
      current.category,
    );

    return rules()
      .filter((rule) => rule.id !== current.id)
      .filter((rule) => ruleDuplicateKey(rule.processNamePattern, rule.windowTitlePattern, rule.scope, rule.category) === currentKey)
      .slice(0, 5);
  });

  const hasDuplicateDraft = createMemo(() => duplicateSuggestions().length > 0);
  const titleScopeSuggestion = createMemo(() => {
    const current = draft();
    if (normalizePattern(current.windowTitlePattern).length === 0) {
      return null;
    }

    if (current.scope === "both") {
      return null;
    }

    return "both";
  });

  function hydrateRules(nextRules: ClassificationRuleRecord[]): void {
    const normalizedRules = sortRules(nextRules);
    setRules(normalizedRules);
    props.syncSettingsJson(serializeRulesJson(normalizedRules));
  }

  async function reloadRules(): Promise<void> {
    try {
      const nextRules = await props.rpc.getClassificationRules();
      hydrateRules(nextRules);
    } catch (error) {
      props.reportError("Failed to load classification rules", error);
    }
  }

  function setRuleList(nextRules: ClassificationRuleRecord[]): void {
    const normalizedRules = sortRules(nextRules);
    setRules(normalizedRules);
    props.syncSettingsJson(serializeRulesJson(normalizedRules));
  }

  function beginCreateRule(): void {
    setDraft({ ...EMPTY_DRAFT });
    setFeedback("Creating a new rule.");
  }

  function beginCreateRuleFromWindow(sample: ActivitySample): void {
    setDraft({
      id: null,
      priority: 0,
      processNamePattern: sample.processName,
      // Window titles are often noisy, so leave this blank by default and let
      // the user opt into title matching only when it is actually useful.
      windowTitlePattern: "",
      category: normalizeCategory(sample.category),
      label: sample.label || sample.processName,
      enabled: true,
      scope: sample.processName ? "process" : sample.windowTitle ? "title" : "process",
      source: "manual",
      hitCount: 0,
      lastUsedAt: null,
      createdAt: 0,
      updatedAt: 0,
    });
    setFeedback("Review the rule before saving.");
  }

  function beginEditRule(rule: ClassificationRuleRecord): void {
    setDraft(toFormState(rule));
    setFeedback("Editing an existing rule.");
  }

  async function duplicateRule(rule: ClassificationRuleRecord): Promise<void> {
    try {
      const savedRule = await props.rpc.saveClassificationRule({
        rule: {
          processNamePattern: rule.processNamePattern,
          windowTitlePattern: rule.windowTitlePattern,
          category: rule.category,
          label: duplicateLabel(rule.label),
          enabled: rule.enabled,
          scope: rule.scope,
        },
      });

      setRuleList(replaceRule(rules(), savedRule));
      setDraft(toFormState(savedRule));
      setFeedback(`Copied "${rule.label}".`);
      props.pushToast("success", "Rule copied", savedRule.label);
    } catch (error) {
      props.reportError("Failed to duplicate classification rule", error);
    }
  }

  async function moveRule(rule: ClassificationRuleRecord, direction: RuleMoveDirection): Promise<void> {
    try {
      const savedRule = await props.rpc.moveClassificationRule({ id: rule.id, direction });
      await reloadRules();
      if (draft().id === savedRule.id) {
        const refreshedRule = rules().find((entry) => entry.id === savedRule.id);
        if (refreshedRule) {
          setDraft(toFormState(refreshedRule));
        }
      }
    } catch (error) {
      props.reportError("Failed to reorder classification rule", error);
    }
  }

  async function reorderRule(
    rule: ClassificationRuleRecord,
    targetRule: ClassificationRuleRecord,
    placement: "before" | "after" = "before",
  ): Promise<void> {
    try {
      const savedRule = await props.rpc.reorderClassificationRule({
        id: rule.id,
        targetId: targetRule.id,
        placement,
      });
      await reloadRules();
      if (draft().id === savedRule.id) {
        const refreshedRule = rules().find((entry) => entry.id === savedRule.id);
        if (refreshedRule) {
          setDraft(toFormState(refreshedRule));
        }
      }
    } catch (error) {
      props.reportError("Failed to reorder classification rule", error);
    }
  }

  function clearDraft(): void {
    setDraft({ ...EMPTY_DRAFT });
    setFeedback("");
  }

  function updateDraft<K extends keyof ClassificationRuleDraft>(key: K, value: ClassificationRuleDraft[K]): void {
    setDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function saveDraft(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    try {
      const currentDraft = draft();
      const savedRule = await props.rpc.saveClassificationRule({
        id: currentDraft.id ?? undefined,
        rule: {
          processNamePattern: currentDraft.processNamePattern.trim(),
          windowTitlePattern: currentDraft.windowTitlePattern.trim(),
          category: currentDraft.category,
          label: currentDraft.label.trim(),
          enabled: currentDraft.enabled,
          scope: currentDraft.scope,
        },
      });

      setRuleList(replaceRule(rules(), savedRule));
      setDraft(toFormState(savedRule));
      setFeedback(`Saved "${savedRule.label}".`);
      props.pushToast("success", "Rule saved", savedRule.label);
    } catch (error) {
      props.reportError("Failed to save classification rule", error);
    }
  }

  async function toggleRuleEnabled(rule: ClassificationRuleRecord): Promise<void> {
    try {
      const savedRule = await props.rpc.setClassificationRuleEnabled({ id: rule.id, enabled: !rule.enabled });
      setRuleList(replaceRule(rules(), savedRule));

      if (draft().id === savedRule.id) {
        setDraft(toFormState(savedRule));
      }
    } catch (error) {
      props.reportError("Failed to toggle classification rule", error);
    }
  }

  async function deleteRule(rule: ClassificationRuleRecord): Promise<void> {
    try {
      await props.rpc.deleteClassificationRule({ id: rule.id });
      const nextRules = rules().filter((entry) => entry.id !== rule.id);
      setRuleList(nextRules);

      if (draft().id === rule.id) {
        clearDraft();
      }

      props.pushToast("info", "Rule deleted", rule.label);
    } catch (error) {
      props.reportError("Failed to delete classification rule", error);
    }
  }

  return {
    rules,
    filteredRules,
    searchQuery,
    categoryFilter,
    enabledFilter,
    scopeFilter,
    sourceFilter,
    sourceOptions,
    titleScopeSuggestion,
    draft,
    feedback,
    hydrateRules,
    reloadRules,
    setSearchQuery,
    setCategoryFilter,
    setEnabledFilter,
    setScopeFilter,
    setSourceFilter,
    resetFilters: () => {
      setSearchQuery("");
      setCategoryFilter("all");
      setEnabledFilter("all");
      setScopeFilter("all");
      setSourceFilter("all");
    },
    beginCreateRule,
    beginCreateRuleFromWindow,
    beginEditRule,
    duplicateRule,
    moveRule,
    reorderRule,
    duplicateSuggestions,
    hasDuplicateDraft,
    clearDraft,
    updateDraft,
    saveDraft,
    toggleRuleEnabled,
    deleteRule,
  };
}
