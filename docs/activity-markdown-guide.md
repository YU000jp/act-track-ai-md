# Activity Log and Markdown Export Guide

This guide describes the current Tauri-based implementation.

## What is tracked

The app records:

- timestamp
- process name
- window title
- activity category
- label
- duration

All data stays local in SQLite-backed stores under the app data directory.

## Export behavior

Markdown export is handled by the Rust backend in `src-tauri/src/markdown.rs`.

Exports are generated:

- automatically when the day rolls over
- after a manual daily summary generation

The export path comes from the `markdownExportPath` setting. If that setting is empty, the app uses a default folder under the user home directory.

## Privacy mode

When `markdownPrivacyMode` is enabled, window titles are replaced with `[hidden]` in the exported Markdown.

## Output shape

Each daily file includes:

- the date
- category and tag summary
- tracked time totals
- AI summary if present
- a per-sample activity table

## Settings that affect export

- `markdownExportPath`
- `markdownPrivacyMode`
- `summaryLanguage`
- `summaryTone`
- `autoStart`

## Notes

- The old Bun/Electrobun export notes were removed from the runtime path.
- The current dashboard still exposes the export-related settings, but export execution now lives in the Tauri backend.
