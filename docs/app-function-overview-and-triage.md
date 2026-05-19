# App Function Overview and Triage

This document summarizes the current behavior of ActTrack AI MD based on the Rust backend, Solid dashboard, and shared types.

## Scope

The app is a Windows desktop tracker with a Tauri shell, a SolidJS dashboard, SQLite-backed persistence, and optional Gemini integration.

## User-Facing Features

### 1. Foreground tracking

- Polls the foreground window on a configurable interval.
- Ignores the app's own window.
- Skips tracking while the user is idle beyond the configured timeout.
- Records process name, window title, category, label, timestamp, and duration.

### 2. Activity classification

Classification follows this order:

1. Matching custom classification rules.
2. SQLite classification cache.
3. Gemini fallback.
4. Unknown fallback if Gemini fails or no API key is configured.

Custom rules are JSON entries with:

- `processNamePattern`
- `windowTitlePattern`
- `category`
- `label`

### 3. Today dashboard

The Today tab shows:

- tracked time
- productive time
- distraction time
- neutral time
- top apps for the current day
- current summary feedback text

It also exposes actions to:

- generate a summary immediately
- save edited feedback back into the local store

### 4. Range statistics

The Statistics tab shows:

- 7, 14, or 30 day ranges
- total tracked time
- productive share
- average per day
- active days
- daily breakdown
- top apps for the selected range

The range snapshot is backend-aggregated rather than reconstructed in the UI.

### 5. Daily summaries

Daily summaries are stored locally and may include:

- total tracked time
- category breakdown
- top apps
- optional AI summary text

Summary generation can happen:

- manually from the dashboard
- automatically when the day rolls over

If a Gemini API key is present, the summary prompt uses:

- the selected language
- the selected tone
- recent memory context

### 6. Markdown export

Each day can be exported as Markdown.

Export behavior:

- Uses `markdownExportPath` if configured.
- Falls back to `~/act-track-logs` if the setting is empty.
- Hides window titles when `markdownPrivacyMode` is enabled.
- Runs on day rollover and after manual summary generation.

### 7. Memory console

The memory store keeps lightweight local notes:

- `pattern`
- `context`
- `feedback`
- `observation`

The dashboard can:

- list recent memories
- pin or unpin a record
- forget a record

Memory is used by the summary pipeline as local context.

### 8. Settings and runtime controls

The Settings tab exposes:

- Gemini API key
- summary language
- summary tone
- classification rules JSON
- poll interval
- idle timeout
- notification cooldown
- grace period
- markdown export path
- markdown privacy mode
- notifications toggle
- auto-start
- start-in-background behavior

Settings that affect launcher behavior may require a restart to take effect.

### 9. Tray and window behavior

- The tray menu opens the dashboard, toggles tracking, or quits the app.
- Closing the main window hides it instead of exiting.
- Auto-start can launch the app in a hidden state if configured.

## Storage Layout

The runtime keeps data local:

- classification cache: SQLite
- activity log and summaries: SQLite
- memory store: SQLite
- Gemini API key: OS credential store

## Review Triage

The codebase currently passes:

- `pnpm test`
- `pnpm run typecheck`
- `cargo check --manifest-path src-tauri/Cargo.toml`

### Findings

| Status | Finding | Impact | Location |
| --- | --- | --- | --- |
| Resolved | Open foreground samples are now refreshed while the window remains active and are split at day rollover or idle transitions. | Today totals and daily exports now stay aligned with the latest observed activity. | `src-tauri/src/app.rs` |
| Resolved | Top-app aggregation now rolls category totals up per process and picks the dominant category deterministically. | Top-app labels in Today and Statistics no longer depend on SQLite's non-aggregated grouping behavior. | `src-tauri/src/db.rs` |
| Resolved | Foreground tracking now keeps windows even when the process path cannot be resolved by falling back to `unknown`. | Protected or non-resolvable windows still contribute time and summary data instead of being dropped. | `src-tauri/src/tracker.rs` |

## Practical Verdict

The app is structurally coherent and the main dashboard flows are wired correctly. The two highest-risk tracking issues were addressed in the current codebase, and the unresolved-process-path case now degrades gracefully instead of dropping data.
