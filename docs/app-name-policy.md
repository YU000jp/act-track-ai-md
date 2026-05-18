# App naming policy

The current app name is provisional and may change again.

## Canonical app name

- Display name: `ActTrack AI MD`
- Package name: `act-track-ai-md`
- App identifier: `com.irdan.acttrackaimd`
- Provisional flag: `true` (`APP_META.isProvisionalName`)

## Files to update on next rename

- `src/shared/app-meta.ts` (primary source)
- `package.json`
- `pnpm-lock.yaml`
- `src-tauri/tauri.conf.json`
- `src/frontend/dashboard/index.html`
- `README.md`
- `docs/` user-facing references

## Guidance

When adding code, prefer reading app metadata from `src/shared/app-meta.ts` instead of hard-coding names in multiple places.
