# ActTrack AI MD

This project is a fork of [IrdanGu/act-track-ai](https://github.com/IrdanGu/act-track-ai), extended with a Tauri-based desktop app and related enhancements.

ActTrack AI MD is a Windows desktop app for foreground window tracking, Gemini-backed classification, SQLite activity logging, and daily summaries.

## Features

- Foreground window tracking
- Local Chrome, Edge, and Firefox browser history collection
- Native messaging browser bridge support for extension-fed visits
- Rule-first classification with cache and Gemini fallback
- SQLite activity log and daily summaries
- Unified activity log tab with date, source, app, category, and browser filters
- Native tray icon and notifications with Tauri
- Markdown export for daily reviews
- Local memory store for feedback and context
- Current feature and triage notes: [docs/app-function-overview-and-triage.md](docs/app-function-overview-and-triage.md)

## Tech Stack

- Tauri 2
- Rust backend
- pnpm for frontend build and tests
- SolidJS dashboard UI
- SQLite
- Google Gemini 2.0 Flash

## Requirements

- Windows 10/11 x64
- Node.js 22.21.1
- pnpm 10.33.2
- Rust 1.94.0

## Setup

```bash
pnpm install
```

Open the Settings screen in the app to enter your Gemini API key. The key is stored securely on the device.
When the key is present, classification uses custom rules first, then the SQLite cache, then Gemini, and finally an unknown fallback.

## Development

```bash
pnpm run tauri:dev
```

Tauri starts the Vite dev server automatically before the app starts. The dashboard is served from `http://127.0.0.1:1420` with Vite HMR.

To run the dashboard frontend by itself:

```bash
pnpm run dev:frontend
```

If Vite reports an outdated optimize cache, rerun with `pnpm run dev:frontend -- --force` or delete `node_modules/.vite-dashboard`.

## Build

```bash
pnpm run build:release
```

This runs the Tauri package step and copies the distributable files into `release-assets/`.

Tauri runs `pnpm run build:frontend` automatically before packaging.

If you only need the lower-level Tauri package step:

```bash
pnpm run tauri:build
```

## Verification

```bash
pnpm test
pnpm run typecheck
cargo check --manifest-path src-tauri/Cargo.toml
pnpm run build:frontend
pnpm run build:release
pnpm run tauri:build
```

## Notes

- The dashboard UI lives in `src/frontend/dashboard` and is implemented with SolidJS.
- `pnpm run build:frontend` generates the bundled dashboard entrypoint used by Tauri for packaging.
- `pnpm run build:release` creates the public release bundle and copies the distributables into `release-assets/`.
- `pnpm run dev:frontend` starts the local Vite dashboard server.
- Local data is stored under the app data directory.
- Non-secret settings are persisted in SQLite. The Gemini API key is stored in the OS credential store.
- Browser history capture is opt-in and currently targets Chrome, Edge, and Firefox on Windows.
- The native messaging bridge is supported through `browser-extensions/native-messaging/`.
