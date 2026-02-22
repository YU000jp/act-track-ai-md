import { Database } from "bun:sqlite";
import type { ActivityCategory, ActivitySample, DailySummary } from "../shared/types";

type CacheRow = {
  category: ActivityCategory;
  label: string;
  confidence: number;
};

type ActivityInsert = {
  timestamp: number;
  processName: string;
  windowTitle: string;
  category: ActivityCategory;
  label: string;
};

type StatsResult = {
  totalTrackedMs: number;
  productiveMs: number;
  distractionMs: number;
  neutralMs: number;
};

type TopAppRow = {
  processName: string;
  durationMs: number;
  category: ActivityCategory;
};

export type Datastores = {
  cache: Database;
  activity: Database;
  getCachedClassification: (processName: string, windowTitle: string) => CacheRow | null;
  upsertCachedClassification: (processName: string, windowTitle: string, category: ActivityCategory, label: string, confidence: number) => void;
  getCacheCount: () => number;
  clearCache: () => void;
  insertActivitySample: (sample: ActivityInsert) => number;
  setActivityDuration: (id: number, durationMs: number) => void;
  getActivityRange: (fromMs: number, toMs: number) => ActivitySample[];
  getStatsForDay: (dateStr: string) => StatsResult;
  getTopAppsForDay: (dateStr: string, limit: number) => TopAppRow[];
  getSetting: (key: string) => string | null;
  setSetting: (key: string, value: string) => void;
  saveDailySummary: (summary: DailySummary) => void;
  getDailySummary: (dateStr: string) => DailySummary | null;
};

function dayBounds(dateStr: string): { start: number; end: number } {
  const d = new Date(dateStr + "T00:00:00");
  const start = d.getTime();
  const end = start + 86_400_000;
  return { start, end };
}

export function createDatastores(cachePath: string, activityPath: string): Datastores {
  const cache = new Database(cachePath);
  const activity = new Database(activityPath);

  cache.exec("PRAGMA journal_mode=WAL");
  activity.exec("PRAGMA journal_mode=WAL");

  cache.exec(`
    CREATE TABLE IF NOT EXISTS classification_cache (
      process_name TEXT NOT NULL,
      window_title TEXT NOT NULL,
      category     TEXT NOT NULL,
      label        TEXT NOT NULL,
      confidence   REAL DEFAULT 1.0,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      PRIMARY KEY (process_name, window_title)
    )
  `);

  activity.exec(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp    INTEGER NOT NULL,
      process_name TEXT NOT NULL,
      window_title TEXT NOT NULL,
      category     TEXT NOT NULL,
      label        TEXT NOT NULL,
      duration_ms  INTEGER DEFAULT 0
    )
  `);

  activity.exec(`
    CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity_log(timestamp)
  `);

  activity.exec(`
    CREATE INDEX IF NOT EXISTS idx_activity_process_ts ON activity_log(process_name, timestamp)
  `);

  activity.exec(`
    CREATE TABLE IF NOT EXISTS daily_summary (
      date              TEXT PRIMARY KEY,
      total_tracked_ms  INTEGER,
      productive_ms     INTEGER,
      distraction_ms    INTEGER,
      neutral_ms        INTEGER,
      top_apps          TEXT,
      ai_summary        TEXT,
      created_at        INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);

  activity.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  const stmtGetCache = cache.prepare<CacheRow, [string, string]>(
    "SELECT category, label, confidence FROM classification_cache WHERE process_name = ? AND window_title = ?",
  );

  const stmtUpsertCache = cache.prepare(
    `INSERT INTO classification_cache (process_name, window_title, category, label, confidence)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(process_name, window_title) DO UPDATE SET category=excluded.category, label=excluded.label, confidence=excluded.confidence`,
  );

  const stmtCacheCount = cache.prepare<{ cnt: number }, []>("SELECT count(*) as cnt FROM classification_cache");

  const stmtInsertActivity = activity.prepare(
    "INSERT INTO activity_log (timestamp, process_name, window_title, category, label) VALUES (?, ?, ?, ?, ?)",
  );

  const stmtSetDuration = activity.prepare(
    "UPDATE activity_log SET duration_ms = ? WHERE id = ?",
  );

  const stmtActivityRange = activity.prepare<
    { id: number; timestamp: number; process_name: string; window_title: string; category: string; label: string; duration_ms: number },
    [number, number]
  >("SELECT * FROM activity_log WHERE timestamp >= ? AND timestamp < ? ORDER BY timestamp");

  const stmtDayStats = activity.prepare<
    { category: string; total: number },
    [number, number]
  >("SELECT category, SUM(duration_ms) as total FROM activity_log WHERE timestamp >= ? AND timestamp < ? GROUP BY category");

  const stmtTopApps = activity.prepare<
    { process_name: string; total: number; category: string },
    [number, number, number]
  >("SELECT process_name, SUM(duration_ms) as total, category FROM activity_log WHERE timestamp >= ? AND timestamp < ? GROUP BY process_name ORDER BY total DESC LIMIT ?");

  const stmtGetSetting = activity.prepare<{ value: string }, [string]>("SELECT value FROM settings WHERE key = ?");

  const stmtSetSetting = activity.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  );

  const stmtSaveSummary = activity.prepare(
    `INSERT INTO daily_summary (date, total_tracked_ms, productive_ms, distraction_ms, neutral_ms, top_apps, ai_summary)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET total_tracked_ms=excluded.total_tracked_ms, productive_ms=excluded.productive_ms, distraction_ms=excluded.distraction_ms, neutral_ms=excluded.neutral_ms, top_apps=excluded.top_apps, ai_summary=excluded.ai_summary`,
  );

  const stmtGetSummary = activity.prepare<
    { date: string; total_tracked_ms: number; productive_ms: number; distraction_ms: number; neutral_ms: number; top_apps: string; ai_summary: string | null },
    [string]
  >("SELECT * FROM daily_summary WHERE date = ?");

  return {
    cache,
    activity,

    getCachedClassification(processName, windowTitle) {
      const row = stmtGetCache.get(processName, windowTitle);
      return row ?? null;
    },

    upsertCachedClassification(processName, windowTitle, category, label, confidence) {
      stmtUpsertCache.run(processName, windowTitle, category, label, confidence);
    },

    getCacheCount() {
      return (stmtCacheCount.get() as { cnt: number }).cnt;
    },

    clearCache() {
      cache.exec("DELETE FROM classification_cache");
    },

    insertActivitySample(sample) {
      stmtInsertActivity.run(sample.timestamp, sample.processName, sample.windowTitle, sample.category, sample.label);
      return activity.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!.id;
    },

    setActivityDuration(id, durationMs) {
      stmtSetDuration.run(durationMs, id);
    },

    getActivityRange(fromMs, toMs) {
      const rows = stmtActivityRange.all(fromMs, toMs);
      return rows.map((r) => ({
        id: r.id,
        timestamp: r.timestamp,
        processName: r.process_name,
        windowTitle: r.window_title,
        category: r.category as ActivityCategory,
        label: r.label,
        durationMs: r.duration_ms,
      }));
    },

    getStatsForDay(dateStr) {
      const { start, end } = dayBounds(dateStr);
      const rows = stmtDayStats.all(start, end);
      const result: StatsResult = { totalTrackedMs: 0, productiveMs: 0, distractionMs: 0, neutralMs: 0 };
      for (const row of rows) {
        const ms = row.total || 0;
        result.totalTrackedMs += ms;
        if (row.category === "productive") result.productiveMs = ms;
        else if (row.category === "distraction") result.distractionMs = ms;
        else if (row.category === "neutral") result.neutralMs = ms;
      }
      return result;
    },

    getTopAppsForDay(dateStr, limit) {
      const { start, end } = dayBounds(dateStr);
      return stmtTopApps.all(start, end, limit).map((r) => ({
        processName: r.process_name,
        durationMs: r.total,
        category: r.category as ActivityCategory,
      }));
    },

    getSetting(key) {
      const row = stmtGetSetting.get(key);
      return row ? row.value : null;
    },

    setSetting(key, value) {
      stmtSetSetting.run(key, value);
    },

    saveDailySummary(summary) {
      stmtSaveSummary.run(
        summary.date,
        summary.totalTrackedMs,
        summary.productiveMs,
        summary.distractionMs,
        summary.neutralMs,
        JSON.stringify(summary.topApps),
        summary.aiSummary,
      );
    },

    getDailySummary(dateStr) {
      const row = stmtGetSummary.get(dateStr);
      if (!row) return null;
      return {
        date: row.date,
        totalTrackedMs: row.total_tracked_ms,
        productiveMs: row.productive_ms,
        distractionMs: row.distraction_ms,
        neutralMs: row.neutral_ms,
        topApps: JSON.parse(row.top_apps || "[]"),
        aiSummary: row.ai_summary,
      };
    },
  };
}
