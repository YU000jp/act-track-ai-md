# ActTrack AI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Windows desktop app that tracks active window usage, classifies activities with Gemini (cache-first), sends distraction notifications, and shows productivity analytics in a tray-launched dashboard.

**Architecture:** Electrobun main process owns tray, polling loop, FFI tracker, SQLite persistence, classification and notifications. A dashboard WebView (Today/Statistics/Settings) communicates over typed RPC. Classification is cache-first with async Gemini fallback and daily summary generation.

**Tech Stack:** Electrobun, Bun, TypeScript, `bun:ffi`, `bun:sqlite`, Google Gemini API, Chart.js, Bun test runner.

---

## Risk-First Execution Order (must follow this order)

To reduce Windows integration risk, execute tasks in this order:

1. Task 1 (Scaffold)
2. Task 2 (Shared types)
3. Task 6 (Windows FFI tracker)
4. Task 8 (Tray + lifecycle orchestration)
5. Task 3 (SQLite schema + repositories)
6. Task 7 (Notification policy)
7. Task 5 (Cache-first classifier)
8. Task 4 (Gemini client)
9. Task 9 (Dashboard UI)
10. Task 10 (Daily summary + verification)

Why: prove tray + message loop + FFI first, then persistence, then network-dependent AI.

---

### Task 1: Scaffold project + smoke test harness

**Files:**
- Create: `package.json`
- Create: `electrobun.config.ts`
- Create: `tsconfig.json`
- Create: `src/bun/index.ts`
- Create: `tests/smoke/app-start.test.ts`

**Step 1: Write the failing smoke test**

```typescript
// tests/smoke/app-start.test.ts
import { describe, expect, it } from "bun:test";

describe("app bootstrap", () => {
  it("exports startApp function", async () => {
    const mod = await import("../../src/bun/index");
    expect(typeof mod.startApp).toBe("function");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/smoke/app-start.test.ts`
Expected: FAIL (`Cannot find module '../../src/bun/index'` or `startApp is undefined`)

**Step 3: Write minimal implementation + config**

```typescript
// src/bun/index.ts
export function startApp(): void {
  // bootstrapping will be added in later tasks
}
```

Create minimal `electrobun.config.ts` with bun entrypoint `src/bun/index.ts` and app metadata.

**Step 4: Run test to verify it passes**

Run: `bun test tests/smoke/app-start.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add package.json bun.lock electrobun.config.ts tsconfig.json src/bun/index.ts tests/smoke/app-start.test.ts
git commit -m "chore: bootstrap electrobun project with smoke test"
```

---

### Task 2: Define shared domain types and RPC contracts

**Files:**
- Create: `src/shared/types.ts`
- Create: `tests/shared/types.test.ts`

**Step 1: Write the failing type-shape test**

```typescript
// tests/shared/types.test.ts
import { describe, expect, it } from "bun:test";
import type { ActivityCategory } from "../../src/shared/types";

describe("shared types", () => {
  it("supports all activity categories", () => {
    const vals: ActivityCategory[] = ["productive", "distraction", "neutral", "unknown"];
    expect(vals.length).toBe(4);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/shared/types.test.ts`
Expected: FAIL (type import path missing)

**Step 3: Write minimal implementation**

```typescript
// src/shared/types.ts
export type ActivityCategory = "productive" | "distraction" | "neutral" | "unknown";

export type ActivitySample = {
  timestamp: number;
  processName: string;
  windowTitle: string;
  durationMs: number;
  category: ActivityCategory;
  label: string;
};

export type DashboardRPC = {
  requests: {
    getTodaySummary: () => Promise<{
      trackedMs: number;
      productiveMs: number;
      distractionMs: number;
      neutralMs: number;
    }>;
    getTopApps: () => Promise<Array<{ processName: string; durationMs: number; category: ActivityCategory }>>;
    setSetting: (input: { key: string; value: string }) => Promise<void>;
  };
  messages: {
    trackingStatus: (payload: { running: boolean; state: "productive" | "distracted" | "idle" | "paused" }) => void;
  };
};
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/shared/types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/shared/types.ts tests/shared/types.test.ts
git commit -m "feat: add shared domain and RPC contracts"
```

---

### Task 3: SQLite layer (schema + repositories)

**Files:**
- Create: `src/bun/db.ts`
- Create: `tests/bun/db.test.ts`

**Step 1: Write the failing DB test**

```typescript
// tests/bun/db.test.ts
import { describe, expect, it } from "bun:test";
import { createDatastores } from "../../src/bun/db";

describe("db schema", () => {
  it("creates cache and activity tables", () => {
    const stores = createDatastores(":memory:", ":memory:");
    const row = stores.activity.query("SELECT name FROM sqlite_master WHERE type='table' AND name='activity_log'").get();
    expect(row).toBeTruthy();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/bun/db.test.ts`
Expected: FAIL (`createDatastores` missing)

**Step 3: Write minimal implementation**

Implement in `src/bun/db.ts`:
- `createDatastores(cachePath, activityPath)`
- Create tables: `classification_cache`, `activity_log`, `daily_summary`, `settings`
- Enable WAL mode (`PRAGMA journal_mode=WAL`) for concurrent read/write from tracker + dashboard
- Add migration version table (`schema_meta`) and migration step function
- Add query index on `(timestamp)` and `(process_name, timestamp)`
- Repository helpers:
  - `getCachedClassification(processName, windowTitle)`
  - `upsertCachedClassification(...)`
  - `insertActivitySample(...)`
  - `setActivityDuration(id, durationMs)`
  - `getTodayStats()` and `getTopAppsToday(limit)`

**Step 4: Run tests to verify they pass**

Run: `bun test tests/bun/db.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/bun/db.ts tests/bun/db.test.ts
git commit -m "feat: add sqlite schema and repositories"
```

---

### Task 4: Gemini client + strict JSON parsing

**Files:**
- Create: `src/bun/gemini.ts`
- Create: `tests/bun/gemini.test.ts`

**Step 1: Write failing parser tests**

```typescript
// tests/bun/gemini.test.ts
import { describe, expect, it } from "bun:test";
import { parseClassificationResponse } from "../../src/bun/gemini";

describe("gemini parser", () => {
  it("parses valid category payload", () => {
    const out = parseClassificationResponse('{"category":"productive","label":"Coding","confidence":0.92}');
    expect(out.category).toBe("productive");
  });

  it("rejects invalid category", () => {
    expect(() => parseClassificationResponse('{"category":"other"}')).toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/bun/gemini.test.ts`
Expected: FAIL (module/functions missing)

**Step 3: Write minimal implementation**

In `src/bun/gemini.ts` implement:
- `buildClassificationPrompt(processName, windowTitle)`
- `parseClassificationResponse(raw)` with schema validation
- `classifyWithGemini({ apiKey, processName, windowTitle, fetchImpl })`
- Timeout support (5s) and graceful fallback error propagation

**Step 4: Run tests to verify they pass**

Run: `bun test tests/bun/gemini.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/bun/gemini.ts tests/bun/gemini.test.ts
git commit -m "feat: add gemini classification client"
```

---

### Task 5: Cache-first classifier service

**Files:**
- Create: `src/bun/classifier.ts`
- Create: `tests/bun/classifier.test.ts`

**Step 1: Write failing behavior tests**

Add tests for:
- cache hit returns immediately without Gemini call
- cache miss calls Gemini and stores result
- Gemini failure returns `unknown` and does not crash

**Step 2: Run test to verify it fails**

Run: `bun test tests/bun/classifier.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

Implement `createClassifier({ repo, geminiClient, clock })` with:
- `classify(processName, windowTitle)`
- key by `(processName, windowTitle.slice(0, 200))`
- return `{ category, label, confidence, source: "cache" | "gemini" | "fallback" }`

**Step 4: Run tests to verify they pass**

Run: `bun test tests/bun/classifier.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/bun/classifier.ts tests/bun/classifier.test.ts
git commit -m "feat: implement cache-first activity classifier"
```

---

### Task 6: Windows tracker (FFI) with testable adapter boundary

**Files:**
- Create: `src/bun/tracker.ts`
- Create: `tests/bun/tracker.test.ts`

**Step 1: Write failing tests for adapter contract**

Test only pure adapter behavior:
- trims empty title
- normalizes process name to lower-case
- returns `null` when no foreground window
- maps self process/app windows to ignored result
- supports idle signal input (`GetLastInputInfo`) from binding adapter

**Step 2: Run test to verify it fails**

Run: `bun test tests/bun/tracker.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

In `src/bun/tracker.ts`:
- Define `WindowSnapshot = { processName: string; windowTitle: string }`
- Export `createWindowsTracker(ffiBindings)`
- Separate real FFI binding creation from pure normalization logic
- Bind APIs: `GetForegroundWindow`, `GetWindowTextW`, `GetWindowThreadProcessId`, `OpenProcess`, `GetModuleFileNameExW`, `CloseHandle`
- Add idle binding: `GetLastInputInfo` and expose `getIdleMs()`
- Add foreground attribution guard for `ApplicationFrameHost.exe` fallback behavior

**Step 4: Run tests to verify they pass**

Run: `bun test tests/bun/tracker.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/bun/tracker.ts tests/bun/tracker.test.ts
git commit -m "feat: add windows foreground tracker adapter"
```

---

### Task 7: Notification policy (grace period + cooldown)

**Files:**
- Create: `src/bun/notifier.ts`
- Create: `tests/bun/notifier.test.ts`

**Step 1: Write failing policy tests**

Cases:
- distraction under grace period (30s) does not notify
- distraction after grace period notifies
- second distraction within cooldown (5m) is suppressed
- neutral/productive never notify

**Step 2: Run test to verify it fails**

Run: `bun test tests/bun/notifier.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

Implement `createNotifierPolicy({ notify, now, graceMs, cooldownMs })` with:
- `onSample(sample)`
- in-memory state for first distraction timestamp and last notification timestamp

**Step 4: Run tests to verify they pass**

Run: `bun test tests/bun/notifier.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/bun/notifier.ts tests/bun/notifier.test.ts
git commit -m "feat: add distraction notification policy"
```

---

### Task 8: Tray + orchestration loop integration

**Files:**
- Modify: `src/bun/index.ts`
- Create: `src/bun/rpc.ts`
- Create: `tests/bun/index.integration.test.ts`

**Step 1: Write failing integration test (with fakes)**

Test behavior using dependency injection:
- starting app creates tray and sets menu
- `Start Tracking` action starts polling loop
- tracker sample flows through classifier -> DB -> notifier
- `Pause Tracking` stops loop
- `Quit` action cleanly stops loop and exits process
- single-instance lock prevents second app instance

**Step 2: Run test to verify it fails**

Run: `bun test tests/bun/index.integration.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

In `src/bun/index.ts`:
- wire datastore, tracker, classifier, notifier, rpc
- create tray with menu actions: start/pause, dashboard, settings, quit
- update tray title by state (`Paused`, `Productive`, `Distracted`, `Idle`)
- polling interval setting default `3000ms`
- ignore app's own windows from tracking
- if idle >= configured timeout, pause sample accumulation until active again
- enforce single-instance behavior and focus existing dashboard on second launch

In `src/bun/rpc.ts`:
- handlers for `getTodaySummary`, `getTopApps`, `setSetting`

**Step 4: Run tests to verify they pass**

Run: `bun test tests/bun/index.integration.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/bun/index.ts src/bun/rpc.ts tests/bun/index.integration.test.ts
git commit -m "feat: integrate tray and tracking orchestration"
```

---

### Task 9: Dashboard UI (Today/Statistics/Settings)

**Files:**
- Create: `src/views/dashboard/index.html`
- Create: `src/views/dashboard/style.css`
- Create: `src/views/dashboard/main.ts`
- Create: `src/views/dashboard/charts.ts`
- Create: `src/views/assets/icon.png`
- Create: `tests/views/dashboard.dom.test.ts`

**Step 1: Write failing DOM test**

Cases:
- renders three tabs
- tab switch updates visible panel
- settings form submits `setSetting`

**Step 2: Run test to verify it fails**

Run: `bun test tests/views/dashboard.dom.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

Implement dashboard:
- Today: tracked totals + top apps list + summary text
- Statistics: weekly bar + monthly trend via Chart.js wrappers
- Settings: Gemini API key, poll interval, idle timeout, notification cooldown

**Step 4: Run tests to verify they pass**

Run: `bun test tests/views/dashboard.dom.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/views/dashboard src/views/assets/icon.png tests/views/dashboard.dom.test.ts
git commit -m "feat: add dashboard UI with analytics and settings"
```

---

### Task 10: Daily summary service + end-to-end verification

**Files:**
- Create: `src/bun/summarizer.ts`
- Create: `tests/bun/summarizer.test.ts`
- Modify: `src/bun/index.ts`
- Modify: `src/bun/rpc.ts`
- Create: `.env.example`
- Modify: `README.md`

**Step 1: Write failing summary test**

Test that summarizer:
- aggregates today's data
- calls Gemini once with compact context
- stores `daily_summary` row

**Step 2: Run test to verify it fails**

Run: `bun test tests/bun/summarizer.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

Implement `generateDailySummary(date)` and wire:
- on-demand RPC (`generateSummaryNow`)
- scheduled job (23:00 local)

Add docs:
- `.env.example` with `GEMINI_API_KEY=`
- `README.md` setup, Windows requirements, run/build/test commands
- document WebView2 runtime requirement and first-run check steps

**Step 4: Run full verification**

Run in order:
- `bun test`
- `bunx tsc --noEmit`
- `bunx electrobun build --targets=win-x64 --env=dev`
- Fresh machine smoke: launch built app, verify tray appears, start tracking, open dashboard, quit from tray

Expected:
- Tests: PASS
- Typecheck: PASS
- Build: PASS

**Step 5: Commit**

```bash
git add src/bun/summarizer.ts src/bun/index.ts src/bun/rpc.ts tests/bun/summarizer.test.ts .env.example README.md
git commit -m "feat: add daily AI summary and finalize MVP verification"
```

---

## Done Criteria

- Tray app boots and can start/pause tracking from menu
- Foreground app/window is captured on Windows and saved to SQLite with durations
- Classification is cache-first with Gemini fallback and robust fallback behavior
- Distraction notifications obey grace period + cooldown
- Dashboard shows Today/Statistics/Settings with real data
- Daily summary can be generated and persisted
- `bun test`, typecheck, and Electrobun Windows build all pass
