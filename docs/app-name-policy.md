# App naming policy (temporary)

The current app name is **provisional** and may be renamed again.

## Canonical app name (current)

- Display name: `ActTrack AI MD`
- Package name: `act-track-ai-md`
- App identifier: `com.irdan.acttrackaimd`
- Provisional flag: `true` (`APP_META.isProvisionalName`)

## Files to update on next rename

- `src/shared/app-meta.ts` (primary source)
- `package.json`
- `bun.lock`
- `electrobun.config.ts`
- `src/views/dashboard/index.html`
- `README.md`
- `docs/` user-facing references

## Guidance

When adding code, prefer reading app metadata from `src/shared/app-meta.ts` instead of hard-coding names in multiple places.
