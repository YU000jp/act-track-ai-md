import { createSignal, For, Show } from "solid-js";
import { DashboardSurface } from "./DashboardSurface";
import type { ClassificationController } from "./useClassificationController";

type ClassificationPanelProps = {
  active: boolean;
  controller: ClassificationController;
};

function formatRuleDate(timestamp: number | null): string {
  if (!timestamp) {
    return "Never";
  }

  return new Date(timestamp).toLocaleString();
}

function describePattern(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "any";
}

function describeScope(scope: "process" | "title" | "both"): string {
  switch (scope) {
    case "process":
      return "process";
    case "title":
      return "title";
    case "both":
      return "process + title";
  }
}

function formatConditionSummary(rule: {
  processNamePattern: string;
  windowTitlePattern: string;
  scope: "process" | "title" | "both";
}): string {
  return [
    `Process: ${describePattern(rule.processNamePattern)}`,
    `Title: ${describePattern(rule.windowTitlePattern)}`,
    `Scope: ${describeScope(rule.scope)}`,
  ].join(" · ");
}

function hasActiveFilters(controller: ClassificationController): boolean {
  return (
    controller.searchQuery().trim().length > 0 ||
    controller.categoryFilter() !== "all" ||
    controller.enabledFilter() !== "all" ||
    controller.scopeFilter() !== "all" ||
    controller.sourceFilter() !== "all"
  );
}

export function ClassificationPanel(props: ClassificationPanelProps) {
  const draft = props.controller.draft;
  const rules = props.controller.rules;
  const filteredRules = props.controller.filteredRules;
  const sourceOptions = props.controller.sourceOptions;
  const titleScopeSuggestion = props.controller.titleScopeSuggestion;
  const [draggingRuleId, setDraggingRuleId] = createSignal<number | null>(null);
  const [dropTargetRuleId, setDropTargetRuleId] = createSignal<number | null>(null);
  const [dropPlacement, setDropPlacement] = createSignal<"before" | "after">("before");

  function clearDragState(): void {
    setDraggingRuleId(null);
    setDropTargetRuleId(null);
    setDropPlacement("before");
  }

  return (
    <section
      id="panel-rules"
      class={`panel panel-classification ${props.active ? "active" : ""}`}
      aria-hidden={!props.active}
      role="tabpanel"
      aria-labelledby="tab-rules"
    >
      <div class="panel-grid panel-grid-2 classification-grid">
        <DashboardSurface
          eyebrow="Library"
          title="Rules"
          description="Manual rules sit above cache and keep recurring windows classified consistently."
          class="surface-hero"
          actions={
            <>
              <button type="button" class="btn-secondary" onClick={() => void props.controller.reloadRules()}>
                Refresh
              </button>
              <button type="button" class="btn-primary" onClick={props.controller.beginCreateRule}>
                New rule
              </button>
            </>
          }
        >
          <div class="classification-toolbar" aria-label="Rules filters">
            <div class="form-group classification-search">
              <label for="classificationSearch">Search</label>
              <input
                id="classificationSearch"
                type="search"
                value={props.controller.searchQuery()}
                placeholder="Label, process, title, source..."
                onInput={(event) => props.controller.setSearchQuery(event.currentTarget.value)}
              />
            </div>
            <div class="form-group">
              <label for="classificationCategoryFilter">Category</label>
              <select
                id="classificationCategoryFilter"
                value={props.controller.categoryFilter()}
                onInput={(event) =>
                  props.controller.setCategoryFilter(event.currentTarget.value as "all" | "productive" | "distraction" | "neutral")
                }
              >
                <option value="all">all</option>
                <option value="productive">productive</option>
                <option value="distraction">distraction</option>
                <option value="neutral">neutral</option>
              </select>
            </div>
            <div class="form-group">
              <label for="classificationEnabledFilter">Status</label>
              <select
                id="classificationEnabledFilter"
                value={props.controller.enabledFilter()}
                onInput={(event) =>
                  props.controller.setEnabledFilter(event.currentTarget.value as "all" | "enabled" | "disabled")
                }
              >
                <option value="all">all</option>
                <option value="enabled">enabled</option>
                <option value="disabled">disabled</option>
              </select>
            </div>
            <div class="form-group">
              <label for="classificationScopeFilter">Scope</label>
              <select
                id="classificationScopeFilter"
                value={props.controller.scopeFilter()}
                onInput={(event) =>
                  props.controller.setScopeFilter(event.currentTarget.value as "all" | "process" | "title" | "both")
                }
              >
                <option value="all">all</option>
                <option value="process">process</option>
                <option value="title">title</option>
                <option value="both">both</option>
              </select>
            </div>
            <div class="form-group">
              <label for="classificationSourceFilter">Source</label>
              <select
                id="classificationSourceFilter"
                value={props.controller.sourceFilter()}
                onInput={(event) => props.controller.setSourceFilter(event.currentTarget.value)}
              >
                <option value="all">all</option>
                <For each={sourceOptions()}>
                  {(source) => <option value={source}>{source}</option>}
                </For>
              </select>
            </div>
            <div class="classification-toolbar-actions">
              <button type="button" class="btn-secondary" onClick={props.controller.resetFilters}>
                Clear filters
              </button>
              <span class="classification-toolbar-count">
                {filteredRules().length} / {rules().length}
              </span>
            </div>
          </div>

          <Show
            when={rules().length > 0}
            fallback={
              <div class="empty-state">
                No rules yet. Create one from a recent window or start a blank rule here.
              </div>
            }
          >
            <Show
              when={filteredRules().length > 0}
              fallback={
                <div class="empty-state">
                  {hasActiveFilters(props.controller)
                    ? "No rules match the current filters."
                    : "No rules are available right now."}
                </div>
              }
            >
              <ul class="classification-list">
                <For each={filteredRules()}>
                  {(rule) => {
                    const globalIndex = () => rules().findIndex((entry) => entry.id === rule.id);
                    const canMoveUp = () => globalIndex() > 0;
                    const canMoveDown = () => {
                      const index = globalIndex();
                      return index >= 0 && index < rules().length - 1;
                    };
                    const isDragging = () => draggingRuleId() === rule.id;
                    const isDropTarget = () => dropTargetRuleId() === rule.id;
                    const isDropBefore = () => isDropTarget() && dropPlacement() === "before";
                    const isDropAfter = () => isDropTarget() && dropPlacement() === "after";

                    return (
                      <li
                        class={`classification-item ${rule.enabled ? "is-enabled" : "is-disabled"} ${isDragging() ? "is-dragging" : ""} ${isDropTarget() ? "is-drop-target" : ""}`}
                        draggable="true"
                        onDragStart={(event) => {
                          const transfer = event.dataTransfer;
                          if (!transfer) {
                            return;
                          }
                          setDraggingRuleId(rule.id);
                          transfer.effectAllowed = "move";
                          transfer.setData("text/plain", String(rule.id));
                        }}
                        onDragEnd={clearDragState}
                        onDragOver={(event) => {
                          event.preventDefault();
                          if (draggingRuleId() !== rule.id) {
                            const rect = event.currentTarget.getBoundingClientRect();
                            const pointerAfterMidpoint = event.clientY > rect.top + rect.height / 2;
                            setDropTargetRuleId(rule.id);
                            setDropPlacement(pointerAfterMidpoint ? "after" : "before");
                          }
                        }}
                        onDragLeave={() => {
                          if (dropTargetRuleId() === rule.id) {
                            setDropTargetRuleId(null);
                            setDropPlacement("before");
                          }
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          const transfer = event.dataTransfer;
                          if (!transfer) {
                            clearDragState();
                            return;
                          }
                          const draggedId = Number(transfer.getData("text/plain"));
                          const draggedRule = rules().find((entry) => entry.id === draggedId);
                          if (draggedRule && draggedRule.id !== rule.id) {
                            void props.controller.reorderRule(draggedRule, rule, dropPlacement());
                          }
                          clearDragState();
                        }}
                      >
                        {isDropBefore() ? <div class="classification-drop-indicator classification-drop-indicator-before">Insert before</div> : null}
                        <div class="classification-item-main">
                          <div class="classification-item-head">
                            <details class="classification-item-details">
                              {/* Keep the rule row compact; the summary carries the scan-friendly bits. */}
                              <summary>
                                <span class="classification-item-summary-copy">
                                  <strong>{rule.label}</strong>
                                  <span class="classification-item-summary-text">{formatConditionSummary(rule)}</span>
                                </span>
                                <span class="classification-item-summary-meta">
                                  <span class={`classification-enabled-pill ${rule.enabled ? "is-enabled" : "is-disabled"}`}>
                                    {rule.enabled ? "Enabled" : "Disabled"}
                                  </span>
                                  <span class="classification-priority-pill">Priority {rule.priority}</span>
                                </span>
                              </summary>
                              <div class="classification-item-details-body">
                                <div class="classification-patterns">
                                  <span class="classification-field">
                                    <strong>Process</strong>
                                    <span>{rule.processNamePattern || "Any process"}</span>
                                  </span>
                                  <span class="classification-field">
                                    <strong>Window</strong>
                                    <span>{rule.windowTitlePattern || "Any title"}</span>
                                  </span>
                                  <span class="classification-field">
                                    <strong>Scope</strong>
                                    <span>{rule.scope}</span>
                                  </span>
                                  <span class="classification-field">
                                    <strong>Source</strong>
                                    <span>{rule.source}</span>
                                  </span>
                                </div>

                                <div class="classification-metrics">
                                  <span>Category: {rule.category}</span>
                                  <span>Hits: {rule.hitCount}</span>
                                  <span>Last used: {formatRuleDate(rule.lastUsedAt)}</span>
                                </div>
                              </div>
                            </details>
                            <div class="classification-item-actions">
                              <button type="button" class="btn-ghost" onClick={() => props.controller.beginEditRule(rule)}>
                                Edit
                              </button>
                              <button type="button" class="btn-ghost" onClick={() => void props.controller.duplicateRule(rule)}>
                                Duplicate
                              </button>
                              <button
                                type="button"
                                class="btn-ghost"
                                disabled={!canMoveUp()}
                                onClick={() => void props.controller.moveRule(rule, "up")}
                              >
                                Up
                              </button>
                              <button
                                type="button"
                                class="btn-ghost"
                                disabled={!canMoveDown()}
                                onClick={() => void props.controller.moveRule(rule, "down")}
                              >
                                Down
                              </button>
                              <button type="button" class="btn-ghost" onClick={() => void props.controller.toggleRuleEnabled(rule)}>
                                {rule.enabled ? "Disable" : "Enable"}
                              </button>
                              <button
                                type="button"
                                class="btn-ghost"
                                onClick={() => {
                                  if (window.confirm(`Delete rule "${rule.label}"?`)) {
                                    void props.controller.deleteRule(rule);
                                  }
                                }}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        </div>
                        {isDropAfter() ? <div class="classification-drop-indicator classification-drop-indicator-after">Insert after</div> : null}
                      </li>
                    );
                  }}
                </For>
              </ul>
            </Show>
          </Show>
        </DashboardSurface>

        <DashboardSurface
          eyebrow="Editor"
          title={draft().id ? "Edit rule" : "Create rule"}
          description="Keep the core rule fields visible. Matching conditions stay tucked into a collapsed section."
          class="surface-summary"
          actions={
            <button type="button" class="btn-secondary" onClick={props.controller.clearDraft}>
              Reset
            </button>
          }
        >
          <form class="classification-form" onSubmit={(event) => void props.controller.saveDraft(event)}>
            <div class="field-grid">
              <div class="form-group field-span">
                <label for="classificationLabel">Label</label>
                <input
                  id="classificationLabel"
                  type="text"
                  value={draft().label}
                  placeholder="Coding"
                  onInput={(event) => props.controller.updateDraft("label", event.currentTarget.value)}
                />
              </div>
              <div class="form-group">
                <label for="classificationCategory">Category</label>
                <select
                  id="classificationCategory"
                  value={draft().category}
                  onInput={(event) =>
                    props.controller.updateDraft("category", event.currentTarget.value as "productive" | "distraction" | "neutral")
                  }
                >
                  <option value="productive">productive</option>
                  <option value="distraction">distraction</option>
                  <option value="neutral">neutral</option>
                </select>
              </div>
              <div class="form-group">
                <label for="classificationScope">Scope</label>
                <select
                  id="classificationScope"
                  value={draft().scope}
                  onInput={(event) => props.controller.updateDraft("scope", event.currentTarget.value as "process" | "title" | "both")}
                >
                  <option value="process">process</option>
                  <option value="title">title</option>
                  <option value="both">both</option>
                </select>
              </div>
              {/* The matching section stays collapsed so the editor reads like a short form first. */}
              <details class="classification-advanced field-span">
                <summary>
                  <span>Matching conditions</span>
                  <span class="classification-condition-summary">{formatConditionSummary(draft())}</span>
                </summary>
                <div class="classification-advanced-body">
                  <div class="field-grid field-grid-two">
                    <div class="form-group">
                      <label for="classificationProcessPattern">Process pattern</label>
                      <input
                        id="classificationProcessPattern"
                        type="text"
                        value={draft().processNamePattern}
                        placeholder="code"
                        onInput={(event) => props.controller.updateDraft("processNamePattern", event.currentTarget.value)}
                      />
                    </div>
                    <div class="form-group">
                      <label for="classificationWindowPattern">Window title pattern</label>
                      <input
                        id="classificationWindowPattern"
                        type="text"
                        value={draft().windowTitlePattern}
                        placeholder="Leave blank to ignore"
                        onInput={(event) => props.controller.updateDraft("windowTitlePattern", event.currentTarget.value)}
                      />
                    </div>
                  </div>
                  <Show when={titleScopeSuggestion()}>
                    <div class="classification-scope-suggestion field-span" role="status" aria-live="polite">
                      <span>Title pattern entered. Use `both` when you want process + title together.</span>
                      <button
                        type="button"
                        class="btn-secondary"
                        onClick={() => props.controller.updateDraft("scope", titleScopeSuggestion() ?? "process")}
                      >
                        Switch to both
                      </button>
                    </div>
                  </Show>
                  <p class="settings-hint classification-hint field-span">
                    Title matching uses substring logic. Leave this blank unless the title is stable enough to help matching.
                  </p>
                </div>
              </details>
              <div class="form-group checkbox field-span">
                <label>
                  <input
                    type="checkbox"
                    checked={draft().enabled}
                    onInput={(event) => props.controller.updateDraft("enabled", event.currentTarget.checked)}
                  />
                  Enable this rule
                </label>
              </div>
            </div>

            <div class="classification-meta">
              <span>Priority: {draft().priority}</span>
              <span>Source: {draft().source}</span>
              <span>Hits: {draft().hitCount}</span>
              <span>Last used: {formatRuleDate(draft().lastUsedAt)}</span>
            </div>

            <Show when={props.controller.hasDuplicateDraft()}>
              <div class="classification-duplicate-warning" role="status" aria-live="polite">
                <strong>Potential duplicate detected.</strong>
                <span>Rules with the same scope and match patterns already exist.</span>
                <ul class="classification-duplicate-list">
                  <For each={props.controller.duplicateSuggestions()}>
                    {(rule) => (
                      <li>
                        <button type="button" class="btn-ghost" onClick={() => props.controller.beginEditRule(rule)}>
                          {rule.label}
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </div>
            </Show>

            <p class="settings-hint classification-hint">
              Save the rule after checking the preview values. Process and title patterns both use substring matching, so exact title
              copies are not required. The settings JSON stays in sync with this list.
            </p>

            <div class="classification-footer">
              <button type="submit" class="btn-primary">
                Save rule
              </button>
              <div class="settings-feedback classification-feedback" role="status" aria-live="polite">
                {props.controller.feedback()}
              </div>
            </div>
          </form>
        </DashboardSurface>
      </div>
    </section>
  );
}
