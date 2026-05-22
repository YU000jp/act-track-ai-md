# Native Messaging Browser Bridge

This folder contains the extension and host manifest templates for forwarding browser visits into Act Track AI MD.

## What it does

- The extension watches tab activation and completed navigation.
- The native host receives visit snapshots over `stdin` / `stdout`.
- The host appends normalized events to the app inbox file.
- The Tauri app ingests the inbox and stores the data in `browser_visit_log`.

## Files

- `manifest.json` - extension manifest shared by Chrome and Firefox.
- `background.js` - background worker that forwards active tab snapshots.
- `native-host.chrome.json` - Chrome / Edge native host manifest template.
- `native-host.firefox.json` - Firefox native host manifest template.

## Install notes

- Build `act-track-ai-md-native-host` from `src-tauri`.
- Update the `path` field in the host manifest template to the built binary path.
- Update the extension ID placeholders before installing the extension.
- Register the host manifest in the browser-specific location required by the browser.

## Data model

- `browser` identifies the browser family (`chrome`, `edge`, `firefox`).
- `profile` is a lightweight label from the extension, defaulting to `native-messaging`.
- `source` is set to `native-messaging`.
- The app generates a stable event key from the visit payload to deduplicate repeated messages.
