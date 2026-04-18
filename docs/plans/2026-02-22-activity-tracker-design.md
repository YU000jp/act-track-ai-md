# ActTrack AI MD — Design Document (v2)

Date: 2026-02-22

## 1. Overview

A personal desktop productivity tracker for Windows, built with Electrobun (Bun + Zig + WebView). The app lives in the system tray, monitors active windows via FFI, uses Google Gemini to auto-classify activities as productive/distraction/neutral, and sends native notifications when the user gets distracted. It includes a dashboard with timeline visualization, per-app time tracking, AI daily summaries, and weekly/monthly trend analytics.

## 2. Goals & Constraints

- **Target OS:** Windows (x64, Edge WebView2)
- **Framework:** Electrobun
- **AI Provider:** Google Gemini 2.0 Flash
- **Classification Strategy:** Cache-first hybrid — cached results are instant, new windows trigger async Gemini call, cache grows organically over time
- **Intervention:** Native OS notifications (non-blocking) with cooldown and grace period
- **Scope:** Personal tool for one user — no auth, no cloud sync, all data local

## 3. Architecture

```
┌─────────────────────────────────────────────────────┐
│                  ActTrack AI MD                      │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │          Main Process (Bun)                   │   │
│  │                                               │   │
│  │  ┌─────────┐  ┌──────────┐  ┌────────────┐  │   │
│  │  │ Window   │  │ AI       │  │ Activity   │  │   │
│  │  │ Tracker  │→ │ Classifier│→ │ Logger     │  │   │
│  │  │ (FFI)    │  │ (Gemini) │  │ (SQLite)   │  │   │
│  │  └─────────┘  └──────────┘  └────────────┘  │   │
│  │       │              │             │          │   │
│  │       │         ┌────┴────┐        │          │   │
│  │       │         │  Cache  │        │          │   │
│  │       │         │ (SQLite)│        │          │   │
│  │       │         └─────────┘        │          │   │
│  │       ▼                            ▼          │   │
│  │  ┌──────────┐              ┌────────────┐    │   │
│  │  │ Notifier │              │ Daily      │    │   │
│  │  │ (Native) │              │ Summarizer │    │   │
│  │  └──────────┘              │ (Gemini)   │    │   │
│  │                            └────────────┘    │   │
│  └──────────────────────────────────────────────┘   │
│                        ▲ RPC                         │
│  ┌─────────┐    ┌──────┴───────┐                    │
│  │ System  │    │  Dashboard   │                    │
│  │ Tray    │    │  (WebView)   │                    │
│  └─────────┘    └──────────────┘                    │
└─────────────────────────────────────────────────────┘
```

### 3.1 System Tray

App lives in the system tray — no persistent main window.

- **Left click:** Open/toggle Dashboard window
- **Right click:** Context menu (Start/Pause Tracking, Dashboard, Settings, Quit)
- **Dynamic title:** Shows tracking status ("Paused", "Productive", "Distracted")

### 3.2 Main Process (Bun)

All logic runs here:

- **Window Tracker:** Polls `user32.dll` via `bun:ffi` every 3 seconds to get foreground window title + process name
- **AI Classifier:** Cache-first lookup → Gemini API fallback for unknown windows
- **Activity Logger:** Persists all window switches to SQLite (timestamp, app, title, category, duration)
- **Notifier:** Calls `Utils.showNotification()` on distraction detection with cooldown/grace period
- **Daily Summarizer:** Batch sends day's activity log to Gemini for AI narrative summary

### 3.3 Dashboard (WebView)

Opened from tray click. Single window, 3 tabs: Today, Statistics, Settings.

## 4. Data Model

Two separate SQLite databases — cache (resettable) and activity log (permanent).

### 4.1 cache.sqlite

```sql
CREATE TABLE classification_cache (
  window_title TEXT NOT NULL,
  process_name TEXT NOT NULL,
  category     TEXT NOT NULL,  -- 'productive' | 'distraction' | 'neutral'
  label        TEXT NOT NULL,  -- AI-generated: "Coding", "Social Media", etc.
  confidence   REAL DEFAULT 1.0,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (window_title, process_name)
);
```

### 4.2 activity.sqlite

```sql
CREATE TABLE activity_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp    INTEGER NOT NULL,  -- unix ms
  process_name TEXT NOT NULL,
  window_title TEXT NOT NULL,
  category     TEXT NOT NULL,     -- 'productive' | 'distraction' | 'neutral'
  label        TEXT NOT NULL,
  duration_ms  INTEGER DEFAULT 0  -- computed on next window switch
);

CREATE TABLE daily_summary (
  date              TEXT PRIMARY KEY,  -- "2026-02-22"
  total_tracked_ms  INTEGER,
  productive_ms     INTEGER,
  distraction_ms    INTEGER,
  neutral_ms        INTEGER,
  top_apps          TEXT,  -- JSON array
  ai_summary        TEXT,  -- AI-generated narrative
  created_at        INTEGER
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
```

## 5. AI Classification Flow

### 5.1 Cache-First Hybrid

1. Window switch detected via FFI polling
2. Lookup `classification_cache` by `(process_name, window_title)`
3. **Cache hit:** Use stored category/label instantly (0ms)
4. **Cache miss:** Fire async Gemini API call → store result → notify if distraction
5. Cache grows organically — after 1-2 weeks, 95%+ hits are cached

### 5.2 Gemini Prompt

```
System: You are a productivity classifier. Given a Windows process name and
window title, classify the activity.

Rules:
- "productive": Work-related (coding, documents, email, project management, research)
- "distraction": Entertainment, social media, non-work browsing, gaming
- "neutral": System utilities, settings, file manager — neither productive nor distracting

Respond ONLY with JSON: { "category": "productive|distraction|neutral", "label": "short label", "confidence": 0.0-1.0 }

User: Process: {processName}
Title: {windowTitle}
```

Model: Gemini 2.0 Flash — ~200ms latency, $0.10/1M tokens.

### 5.3 Daily Summary

At 23:00 (or on-demand), batch the day's activity log to Gemini for a narrative summary including total tracked time, productive percentage, top distractions, and comparison to previous day.

## 6. Notification Behavior

- **Cooldown:** 5 minutes between notifications (configurable)
- **Grace period:** 30 seconds — quick checks (< 30s on distracting app) do not trigger notification
- **Neutral apps never trigger notifications**
- **No internet / no API key:** Classify as `neutral`, no notifications for unclassified windows

## 7. UI/UX

### 7.1 Tab: Today

- Tracking status + pause button
- Total tracked time
- Timeline bar (color-coded blocks per hour)
- Top apps with duration + category indicator
- AI daily summary (when available)

### 7.2 Tab: Statistics

- Weekly bar chart (productive hours per day)
- Monthly trend line chart (productive %)
- Top distractions ranked by time

### 7.3 Tab: Settings

- Gemini API key input
- Poll interval (default 3s)
- Idle timeout (default 5 min)
- Auto-start on boot toggle
- Notification on/off, cooldown duration
- Cache management (view count, clear)
- Data export (JSON) and reset

## 8. Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| Framework | Electrobun | Bun runtime, tiny bundle, native WebView, built-in system tray |
| Runtime | Bun | FFI support, built-in SQLite, fast startup |
| FFI | `user32.dll`, `kernel32.dll`, `psapi.dll` | Active window title + process name |
| AI | Google Gemini 2.0 Flash | Cheap, fast, sufficient for classification |
| Database | `bun:sqlite` (2 files) | `cache.sqlite` + `activity.sqlite` |
| Frontend | Vanilla HTML/CSS/TS | Simple 3-tab dashboard, no framework overhead |
| Charts | Chart.js | Timeline & bar/line charts for statistics |
| Notifications | `Utils.showNotification()` | Native OS notifications via Electrobun |
| System Tray | `Tray` class | Built-in Electrobun API |

## 9. Error Handling

| Scenario | Handling |
|---|---|
| No API key | App runs, all classifications default to `neutral`, persistent "Set API key" prompt |
| API rate limit / error | Log as `unknown`, retry next cycle, no crash |
| API timeout (>5s) | Cancel request, skip cache, log as `unknown` |
| FFI failure | Return empty, skip poll cycle |
| SQLite write error | Log to console, retry next write |
| No internet | Cached classifications still work, new apps = `unknown` |
| App startup | Auto-start tracking if configured, load cache from SQLite |

## 10. Edge Cases

| Case | Behavior |
|---|---|
| Desktop shown (all minimized) | `explorer.exe` + empty title → `neutral` |
| Lock screen / screensaver | Idle detection (no switch for 5 min) → pause tracking |
| Same title, different process | Cache key = `process_name + window_title` — handled |
| Very long window title | Truncate to 200 chars before Gemini call |
| Multiple monitors | `GetForegroundWindow` returns active window only — acceptable |
| Fullscreen game | Game .exe → AI classifies as distraction |
| Daily summary timing | 23:00 auto-generate or manual trigger from dashboard |

## 11. File Structure

```
act-track-ai-md/
├── electrobun.config.ts
├── package.json
├── src/
│   ├── bun/
│   │   ├── index.ts            # Entry, tray setup, main loop
│   │   ├── tracker.ts          # FFI window tracking
│   │   ├── classifier.ts       # Cache-first AI classification
│   │   ├── gemini.ts           # Gemini API client
│   │   ├── db.ts               # SQLite setup & queries
│   │   ├── notifier.ts         # Notification logic
│   │   ├── summarizer.ts       # Daily AI summary
│   │   └── rpc.ts              # RPC handlers for dashboard
│   ├── views/
│   │   ├── dashboard/
│   │   │   ├── index.html
│   │   │   ├── style.css
│   │   │   ├── main.ts
│   │   │   └── charts.ts
│   │   └── assets/
│   │       └── icon.png
│   └── shared/
│       └── types.ts            # Shared RPC types
├── data/                       # Runtime, gitignored
│   ├── cache.sqlite
│   └── activity.sqlite
└── docs/
    └── plans/
```
