# ActTrack AI MD

ActTrack AI MD is a Windows desktop app for foreground window tracking, Gemini-backed classification, SQLite activity logging, and daily summaries.

## Features

- Foreground window tracking
- Cache-first classification with Gemini fallback
- SQLite activity log and daily summaries
- Native tray icon and notifications with Tauri
- Markdown export for daily reviews
- Local memory store for feedback and context

## Tech Stack

- Tauri 2
- Rust backend
- pnpm for frontend build and tests
- TypeScript dashboard UI
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

## Development

```bash
pnpm run tauri:dev
```

Tauri runs `scripts/build-frontend.mjs` automatically before the app starts.

## Build

```bash
pnpm run tauri:build
```

Tauri runs `scripts/build-frontend.mjs` automatically before packaging.

## Verification

```bash
pnpm test
pnpm run typecheck
cargo check --manifest-path src-tauri/Cargo.toml
pnpm run build:frontend
pnpm run tauri:build
```

## Notes

- The dashboard UI lives in `src/frontend/dashboard`.
- `pnpm run build:frontend` generates the bundled dashboard entrypoint used by Tauri and can also be run directly.
- Local data is stored under the app data directory.
- Non-secret settings are persisted in SQLite. The Gemini API key is stored in the OS credential store.
