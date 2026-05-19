use std::{collections::HashMap, path::Path};

use anyhow::Context;
use chrono::{Duration, NaiveDate, Utc};
use rusqlite::{params, types::Type, Connection, OptionalExtension};

use crate::types::{
    ActivityCategory, ActivitySample, DailySummary, StatisticsDaySummary, StatisticsSnapshot,
    TopApp,
};

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
            .query_row("SELECT COUNT(*) FROM classification_cache", [], |row| {
                row.get::<_, i64>(0)
            })
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

    pub fn get_activity_range(
        &self,
        from_ms: i64,
        to_ms: i64,
    ) -> anyhow::Result<Vec<ActivitySample>> {
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
            Err(error) => {
                return Err(error)
                    .with_context(|| format!("query activity range {from_ms}..{to_ms}"))
            }
        };

        rows.collect::<Result<Vec<_>, _>>()
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
        self.get_top_apps_for_range(start, end, limit)
    }

    pub fn get_statistics_snapshot(
        &self,
        end_date_str: &str,
        range_days: i64,
        top_limit: i64,
    ) -> anyhow::Result<StatisticsSnapshot> {
        let end_date = NaiveDate::parse_from_str(end_date_str, "%Y-%m-%d")
            .unwrap_or_else(|_| Utc::now().date_naive());
        let clamped_range_days = range_days.clamp(1, 30);
        let start_date = end_date - Duration::days(clamped_range_days - 1);
        let range_end_exclusive = end_date + Duration::days(1);
        let (start_ms, _) = day_bounds(&start_date.format("%Y-%m-%d").to_string());
        let (end_ms, _) = day_bounds(&range_end_exclusive.format("%Y-%m-%d").to_string());

        let mut breakdown = std::collections::BTreeMap::<String, StatisticsDaySummary>::new();
        for offset in 0..clamped_range_days {
            let day = start_date + Duration::days(offset);
            let date = day.format("%Y-%m-%d").to_string();
            breakdown.insert(
                date.clone(),
                StatisticsDaySummary {
                    date,
                    tracked_ms: 0,
                    productive_ms: 0,
                    distraction_ms: 0,
                    neutral_ms: 0,
                },
            );
        }

        let mut totals = StatisticsDaySummary {
            date: start_date.format("%Y-%m-%d").to_string(),
            tracked_ms: 0,
            productive_ms: 0,
            distraction_ms: 0,
            neutral_ms: 0,
        };

        let mut daily_stmt = match self.activity.prepare(
            r#"
            SELECT
              date(timestamp / 1000, 'unixepoch') AS day,
              category,
              COALESCE(SUM(duration_ms), 0) AS total
            FROM activity_log
            WHERE timestamp >= ?1 AND timestamp < ?2
            GROUP BY date(timestamp / 1000, 'unixepoch'), category
            ORDER BY day ASC
            "#,
        ) {
            Ok(stmt) => stmt,
            Err(error) => {
                return Err(error)
                    .with_context(|| format!("prepare statistics query for {end_date_str}"))
            }
        };

        let rows = match daily_stmt.query_map(params![start_ms, end_ms], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        }) {
            Ok(rows) => rows,
            Err(error) => {
                return Err(error).with_context(|| format!("query statistics for {end_date_str}"))
            }
        };

        for row in rows
            .collect::<Result<Vec<_>, _>>()
            .with_context(|| format!("collect statistics for {end_date_str}"))?
        {
            let entry = breakdown
                .entry(row.0.clone())
                .or_insert_with(|| StatisticsDaySummary {
                    date: row.0.clone(),
                    tracked_ms: 0,
                    productive_ms: 0,
                    distraction_ms: 0,
                    neutral_ms: 0,
                });
            entry.tracked_ms += row.2;
            totals.tracked_ms += row.2;
            match row.1.as_str() {
                "productive" => {
                    entry.productive_ms += row.2;
                    totals.productive_ms += row.2;
                }
                "distraction" => {
                    entry.distraction_ms += row.2;
                    totals.distraction_ms += row.2;
                }
                "neutral" => {
                    entry.neutral_ms += row.2;
                    totals.neutral_ms += row.2;
                }
                _ => {}
            }
        }

        let active_days = breakdown.values().filter(|day| day.tracked_ms > 0).count() as i64;

        let top_apps = self
            .get_top_apps_for_range(start_ms, end_ms, top_limit)
            .with_context(|| format!("collect top apps statistics for {end_date_str}"))?;

        Ok(StatisticsSnapshot {
            range_days: clamped_range_days,
            start_date: start_date.format("%Y-%m-%d").to_string(),
            end_date: (end_date - Duration::days(1))
                .format("%Y-%m-%d")
                .to_string(),
            tracked_ms: totals.tracked_ms,
            productive_ms: totals.productive_ms,
            distraction_ms: totals.distraction_ms,
            neutral_ms: totals.neutral_ms,
            active_days,
            daily_breakdown: breakdown.into_values().collect(),
            top_apps,
        })
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

    fn get_top_apps_for_range(
        &self,
        start_ms: i64,
        end_ms: i64,
        limit: i64,
    ) -> anyhow::Result<Vec<TopApp>> {
        let mut stmt = match self.activity.prepare(
            r#"
            SELECT process_name, category, COALESCE(SUM(duration_ms), 0) AS total
            FROM activity_log
            WHERE timestamp >= ?1 AND timestamp < ?2
            GROUP BY process_name, category
            ORDER BY process_name ASC, total DESC
            "#,
        ) {
            Ok(stmt) => stmt,
            Err(error) => {
                return Err(error).with_context(|| {
                    format!("prepare top apps query for {start_ms}..{end_ms}")
                })
            }
        };

        let rows = match stmt.query_map(params![start_ms, end_ms], |row| {
            let category = match row.get::<_, String>(1)?.as_str() {
                "productive" => ActivityCategory::Productive,
                "distraction" => ActivityCategory::Distraction,
                "neutral" => ActivityCategory::Neutral,
                _ => ActivityCategory::Unknown,
            };
            Ok((
                row.get::<_, String>(0)?,
                category,
                row.get::<_, i64>(2)?,
            ))
        }) {
            Ok(rows) => rows,
            Err(error) => {
                return Err(error).with_context(|| format!("query top apps for {start_ms}..{end_ms}"))
            }
        };

        let mut aggregates: HashMap<String, TopAppAggregate> = HashMap::new();
        for row in rows
            .collect::<Result<Vec<_>, _>>()
            .with_context(|| format!("collect top apps for {start_ms}..{end_ms}"))?
        {
            aggregates
                .entry(row.0)
                .or_default()
                .absorb(row.1, row.2);
        }

        let mut top_apps: Vec<TopApp> = aggregates
            .into_iter()
            .map(|(process_name, aggregate)| TopApp {
                process_name,
                duration_ms: aggregate.total_ms,
                category: aggregate.dominant_category(),
            })
            .collect();

        top_apps.sort_by(|a, b| {
            b.duration_ms
                .cmp(&a.duration_ms)
                .then_with(|| a.process_name.cmp(&b.process_name))
        });
        top_apps.truncate(limit.max(0) as usize);

        Ok(top_apps)
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

#[derive(Default)]
struct TopAppAggregate {
    total_ms: i64,
    category_totals: HashMap<ActivityCategory, i64>,
}

impl TopAppAggregate {
    fn absorb(&mut self, category: ActivityCategory, duration_ms: i64) {
        self.total_ms += duration_ms;
        *self.category_totals.entry(category).or_insert(0) += duration_ms;
    }

    fn dominant_category(&self) -> ActivityCategory {
        self.category_totals
            .iter()
            .max_by(|(left_category, left_total), (right_category, right_total)| {
                left_total
                    .cmp(right_total)
                    .then_with(|| category_rank(**left_category).cmp(&category_rank(**right_category)))
            })
            .map(|(category, _)| *category)
            .unwrap_or(ActivityCategory::Unknown)
    }
}

fn category_rank(category: ActivityCategory) -> u8 {
    match category {
        ActivityCategory::Productive => 3,
        ActivityCategory::Distraction => 2,
        ActivityCategory::Neutral => 1,
        ActivityCategory::Unknown => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn create_test_datastores() -> (Datastores, PathBuf) {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let base_dir = std::env::temp_dir().join(format!("act-track-ai-md-db-test-{unique}"));
        std::fs::create_dir_all(&base_dir).expect("create temp dir");
        let cache_path = base_dir.join("cache.db");
        let activity_path = base_dir.join("activity.db");
        let stores = Datastores::open(&cache_path, &activity_path).expect("open datastores");
        (stores, base_dir)
    }

    fn seed_activity(
        datastores: &Datastores,
        timestamp: i64,
        process_name: &str,
        window_title: &str,
        category: ActivityCategory,
        label: &str,
        duration_ms: i64,
    ) {
        let id = datastores
            .insert_activity_sample(ActivityInsert {
                timestamp,
                process_name: process_name.to_string(),
                window_title: window_title.to_string(),
                category,
                label: label.to_string(),
            })
            .expect("insert activity");
        datastores
            .set_activity_duration(id, duration_ms)
            .expect("set duration");
    }

    #[test]
    fn top_apps_use_the_dominant_category_per_process() {
        let (datastores, temp_dir) = create_test_datastores();
        let (day_start, _) = Datastores::get_day_bounds("2026-05-19");

        seed_activity(
            &datastores,
            day_start + 1_000,
            "browser.exe",
            "Docs",
            ActivityCategory::Productive,
            "Work",
            1_000,
        );
        seed_activity(
            &datastores,
            day_start + 2_000,
            "browser.exe",
            "Social",
            ActivityCategory::Distraction,
            "Browse",
            3_000,
        );
        seed_activity(
            &datastores,
            day_start + 3_000,
            "editor.exe",
            "Project",
            ActivityCategory::Productive,
            "Code",
            5_000,
        );

        let top_apps = datastores
            .get_top_apps_for_day("2026-05-19", 10)
            .expect("read top apps");

        assert_eq!(top_apps.len(), 2);
        assert_eq!(top_apps[0].process_name, "editor.exe");
        assert_eq!(top_apps[0].category, ActivityCategory::Productive);
        assert_eq!(top_apps[0].duration_ms, 5_000);
        assert_eq!(top_apps[1].process_name, "browser.exe");
        assert_eq!(top_apps[1].category, ActivityCategory::Distraction);
        assert_eq!(top_apps[1].duration_ms, 4_000);

        let snapshot = datastores
            .get_statistics_snapshot("2026-05-19", 7, 10)
            .expect("read statistics");

        assert_eq!(snapshot.top_apps[0].process_name, "editor.exe");
        assert_eq!(snapshot.top_apps[1].process_name, "browser.exe");
        assert_eq!(snapshot.top_apps[1].category, ActivityCategory::Distraction);

        let _ = std::fs::remove_dir_all(temp_dir);
    }
}
