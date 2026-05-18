use std::path::Path;

use anyhow::Context;
use chrono::Utc;
use rusqlite::{params, types::Type, Connection, OptionalExtension};

use crate::types::{ActivityCategory, ActivitySample, DailySummary, TopApp};

pub struct CachedClassification {
    pub category: ActivityCategory,
    pub label: String,
    pub confidence: f64,
}

pub struct ActivityInsert {
    pub timestamp: i64,
    pub process_name: String,
    pub window_title: String,
    pub category: ActivityCategory,
    pub label: String,
}

pub struct Datastores {
    cache: Connection,
    activity: Connection,
}

impl Datastores {
    pub fn open(cache_path: &Path, activity_path: &Path) -> anyhow::Result<Self> {
        if let Some(parent) = cache_path.parent() {
            std::fs::create_dir_all(parent).with_context(|| format!("create {:?}", parent))?;
        }
        if let Some(parent) = activity_path.parent() {
            std::fs::create_dir_all(parent).with_context(|| format!("create {:?}", parent))?;
        }

        let cache = Connection::open(cache_path)?;
        let activity = Connection::open(activity_path)?;

        cache.pragma_update(None, "journal_mode", "WAL")?;
        activity.pragma_update(None, "journal_mode", "WAL")?;

        cache.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS classification_cache (
              process_name TEXT NOT NULL,
              window_title TEXT NOT NULL,
              category     TEXT NOT NULL,
              label        TEXT NOT NULL,
              confidence    REAL DEFAULT 1.0,
              created_at    INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
              PRIMARY KEY (process_name, window_title)
            );
            "#,
        )?;

        activity.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS activity_log (
              id           INTEGER PRIMARY KEY AUTOINCREMENT,
              timestamp    INTEGER NOT NULL,
              process_name TEXT NOT NULL,
              window_title TEXT NOT NULL,
              category     TEXT NOT NULL,
              label        TEXT NOT NULL,
              duration_ms  INTEGER DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity_log(timestamp);
            CREATE INDEX IF NOT EXISTS idx_activity_process_ts ON activity_log(process_name, timestamp);
            CREATE TABLE IF NOT EXISTS daily_summary (
              date              TEXT PRIMARY KEY,
              total_tracked_ms  INTEGER,
              productive_ms     INTEGER,
              distraction_ms    INTEGER,
              neutral_ms        INTEGER,
              top_apps          TEXT,
              ai_summary        TEXT,
              created_at        INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
            );
            CREATE TABLE IF NOT EXISTS settings (
              key   TEXT PRIMARY KEY,
              value TEXT
            );
            "#,
        )?;

        Ok(Self { cache, activity })
    }

    pub fn get_cached_classification(
        &self,
        process_name: &str,
        window_title: &str,
    ) -> Option<CachedClassification> {
        self.cache
            .query_row(
                "SELECT category, label, confidence FROM classification_cache WHERE process_name = ?1 AND window_title = ?2",
                params![process_name, window_title],
                |row| {
                    let category = match row.get::<_, String>(0)?.as_str() {
                        "productive" => ActivityCategory::Productive,
                        "distraction" => ActivityCategory::Distraction,
                        "neutral" => ActivityCategory::Neutral,
                        _ => ActivityCategory::Unknown,
                    };
                    Ok(CachedClassification {
                        category,
                        label: row.get(1)?,
                        confidence: row.get(2)?,
                    })
                },
            )
            .optional()
            .ok()
            .flatten()
    }

    pub fn upsert_cached_classification(
        &self,
        process_name: &str,
        window_title: &str,
        category: ActivityCategory,
        label: &str,
        confidence: f64,
    ) {
        let _ = self.cache.execute(
            r#"
            INSERT INTO classification_cache (process_name, window_title, category, label, confidence)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(process_name, window_title) DO UPDATE SET
              category = excluded.category,
              label = excluded.label,
              confidence = excluded.confidence
            "#,
            params![process_name, window_title, category.as_str(), label, confidence],
        );
    }

    #[allow(dead_code)]
    pub fn get_cache_count(&self) -> usize {
        self.cache
            .query_row("SELECT COUNT(*) FROM classification_cache", [], |row| row.get::<_, i64>(0))
            .unwrap_or(0) as usize
    }

    #[allow(dead_code)]
    pub fn clear_cache(&self) {
        let _ = self.cache.execute("DELETE FROM classification_cache", []);
    }

    pub fn insert_activity_sample(&self, sample: ActivityInsert) -> anyhow::Result<i64> {
        self.activity
            .execute(
                "INSERT INTO activity_log (timestamp, process_name, window_title, category, label) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    sample.timestamp,
                    sample.process_name,
                    sample.window_title,
                    sample.category.as_str(),
                    sample.label,
                ],
            )
            .with_context(|| "insert activity sample".to_string())?;
        Ok(self.activity.last_insert_rowid())
    }

    pub fn set_activity_duration(&self, id: i64, duration_ms: i64) -> anyhow::Result<()> {
        self.activity
            .execute(
                "UPDATE activity_log SET duration_ms = ?1 WHERE id = ?2",
                params![duration_ms, id],
            )
            .with_context(|| format!("update duration for activity {id}"))?;
        Ok(())
    }

    pub fn get_activity_range(&self, from_ms: i64, to_ms: i64) -> anyhow::Result<Vec<ActivitySample>> {
        let mut stmt = match self.activity.prepare(
            "SELECT id, timestamp, process_name, window_title, category, label, duration_ms FROM activity_log WHERE timestamp >= ?1 AND timestamp < ?2 ORDER BY timestamp",
        ) {
            Ok(stmt) => stmt,
            Err(error) => return Err(error).with_context(|| format!("prepare activity range query {from_ms}..{to_ms}")),
        };

        let rows = match stmt.query_map(params![from_ms, to_ms], |row| {
            Ok(ActivitySample {
                id: row.get(0)?,
                timestamp: row.get(1)?,
                process_name: row.get(2)?,
                window_title: row.get(3)?,
                category: match row.get::<_, String>(4)?.as_str() {
                    "productive" => ActivityCategory::Productive,
                    "distraction" => ActivityCategory::Distraction,
                    "neutral" => ActivityCategory::Neutral,
                    _ => ActivityCategory::Unknown,
                },
                label: row.get(5)?,
                duration_ms: row.get(6)?,
            })
        }) {
            Ok(rows) => rows,
            Err(error) => return Err(error).with_context(|| format!("query activity range {from_ms}..{to_ms}")),
        };

        rows
            .collect::<Result<Vec<_>, _>>()
            .with_context(|| format!("collect activity range {from_ms}..{to_ms}"))
    }

    pub fn get_stats_for_day(&self, date_str: &str) -> anyhow::Result<(i64, i64, i64, i64)> {
        let (start, end) = day_bounds(date_str);
        let mut total = 0;
        let mut productive = 0;
        let mut distraction = 0;
        let mut neutral = 0;

        let mut stmt = match self.activity.prepare(
            "SELECT category, COALESCE(SUM(duration_ms), 0) AS total FROM activity_log WHERE timestamp >= ?1 AND timestamp < ?2 GROUP BY category",
        ) {
            Ok(stmt) => stmt,
            Err(error) => return Err(error).with_context(|| format!("prepare stats query for {date_str}")),
        };

        let rows = match stmt.query_map(params![start, end], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        }) {
            Ok(rows) => rows,
            Err(error) => return Err(error).with_context(|| format!("query stats for {date_str}")),
        };

        for row in rows
            .collect::<Result<Vec<_>, _>>()
            .with_context(|| format!("collect stats for {date_str}"))?
        {
            total += row.1;
            match row.0.as_str() {
                "productive" => productive = row.1,
                "distraction" => distraction = row.1,
                "neutral" => neutral = row.1,
                _ => {}
            }
        }

        Ok((total, productive, distraction, neutral))
    }

    pub fn get_top_apps_for_day(&self, date_str: &str, limit: i64) -> anyhow::Result<Vec<TopApp>> {
        let (start, end) = day_bounds(date_str);
        let mut stmt = match self.activity.prepare(
            "SELECT process_name, COALESCE(SUM(duration_ms), 0) AS total, category FROM activity_log WHERE timestamp >= ?1 AND timestamp < ?2 GROUP BY process_name ORDER BY total DESC LIMIT ?3",
        ) {
            Ok(stmt) => stmt,
            Err(error) => return Err(error).with_context(|| format!("prepare top apps query for {date_str}")),
        };

        let rows = match stmt.query_map(params![start, end, limit], |row| {
            Ok(TopApp {
                process_name: row.get(0)?,
                duration_ms: row.get(1)?,
                category: match row.get::<_, String>(2)?.as_str() {
                    "productive" => ActivityCategory::Productive,
                    "distraction" => ActivityCategory::Distraction,
                    "neutral" => ActivityCategory::Neutral,
                    _ => ActivityCategory::Unknown,
                },
            })
        }) {
            Ok(rows) => rows,
            Err(error) => return Err(error).with_context(|| format!("query top apps for {date_str}")),
        };

        rows
            .collect::<Result<Vec<_>, _>>()
            .with_context(|| format!("collect top apps for {date_str}"))
    }

    pub fn get_setting(&self, key: &str) -> anyhow::Result<Option<String>> {
        self.activity
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![key],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .with_context(|| format!("read setting {key}"))
    }

    pub fn set_setting(&self, key: &str, value: &str) -> anyhow::Result<()> {
        self.activity
            .execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, value],
            )
            .with_context(|| format!("save setting {key}"))?;
        Ok(())
    }

    pub fn delete_setting(&self, key: &str) -> anyhow::Result<()> {
        self.activity
            .execute("DELETE FROM settings WHERE key = ?1", params![key])
            .with_context(|| format!("delete setting {key}"))?;
        Ok(())
    }

    pub fn save_daily_summary(&self, summary: &DailySummary) -> anyhow::Result<()> {
        let top_apps = serde_json::to_string(&summary.top_apps)
            .with_context(|| format!("serialize top apps for {}", summary.date))?;
        self.activity
            .execute(
                "INSERT INTO daily_summary (date, total_tracked_ms, productive_ms, distraction_ms, neutral_ms, top_apps, ai_summary) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT(date) DO UPDATE SET total_tracked_ms = excluded.total_tracked_ms, productive_ms = excluded.productive_ms, distraction_ms = excluded.distraction_ms, neutral_ms = excluded.neutral_ms, top_apps = excluded.top_apps, ai_summary = excluded.ai_summary",
                params![
                    summary.date,
                    summary.total_tracked_ms,
                    summary.productive_ms,
                    summary.distraction_ms,
                    summary.neutral_ms,
                    top_apps,
                    summary.ai_summary,
                ],
            )
            .with_context(|| format!("save daily summary for {}", summary.date))?;
        Ok(())
    }

    pub fn get_daily_summary(&self, date_str: &str) -> anyhow::Result<Option<DailySummary>> {
        self.activity
            .query_row(
                "SELECT date, total_tracked_ms, productive_ms, distraction_ms, neutral_ms, top_apps, ai_summary FROM daily_summary WHERE date = ?1",
                params![date_str],
                |row| {
                    let top_apps_json: String = row.get(5)?;
                    let top_apps = serde_json::from_str::<Vec<TopApp>>(&top_apps_json).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(5, Type::Text, Box::new(error))
                    })?;
                    Ok(DailySummary {
                        date: row.get(0)?,
                        total_tracked_ms: row.get(1)?,
                        productive_ms: row.get(2)?,
                        distraction_ms: row.get(3)?,
                        neutral_ms: row.get(4)?,
                        top_apps,
                        ai_summary: row.get(6)?,
                    })
                },
            )
            .optional()
            .with_context(|| format!("read daily summary for {date_str}"))
    }

    pub fn get_day_bounds(date_str: &str) -> (i64, i64) {
        day_bounds(date_str)
    }
}

fn day_bounds(date_str: &str) -> (i64, i64) {
    let date = chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
        .unwrap_or_else(|_| Utc::now().date_naive());
    let start = date
        .and_hms_opt(0, 0, 0)
        .expect("valid midnight")
        .and_utc()
        .timestamp_millis();
    (start, start + 86_400_000)
}
