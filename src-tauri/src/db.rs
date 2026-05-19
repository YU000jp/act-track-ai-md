use std::{collections::HashMap, path::Path};

use anyhow::Context;
use chrono::{Duration, NaiveDate, Utc};
use rusqlite::{params, types::Type, Connection, OptionalExtension};

use crate::types::{
    ActivityCategory, ActivitySample, DailySummary, StatisticsDaySummary, StatisticsSnapshot,
    TopApp,
};

pub struct DayActivitySnapshot {
    pub activity: Vec<ActivitySample>,
    pub summary: DailySummary,
}

pub struct BootstrapAggregationSnapshot {
    pub today_summary: DailySummary,
    pub statistics_snapshot: StatisticsSnapshot,
}

struct RangeAggregationSnapshot {
    statistics_snapshot: StatisticsSnapshot,
    today_summary: Option<DailySummary>,
}

struct RangeAggregationRow {
    day: String,
    process_name: String,
    category: ActivityCategory,
    total_ms: i64,
}

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
        self.query_activity_range(from_ms, to_ms)
    }

    #[allow(dead_code)]
    pub fn get_stats_for_day(&self, date_str: &str) -> anyhow::Result<(i64, i64, i64, i64)> {
        let snapshot = self.get_day_activity_snapshot(date_str)?;
        Ok((
            snapshot.summary.total_tracked_ms,
            snapshot.summary.productive_ms,
            snapshot.summary.distraction_ms,
            snapshot.summary.neutral_ms,
        ))
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub fn get_top_apps_for_day(&self, date_str: &str, limit: i64) -> anyhow::Result<Vec<TopApp>> {
        let snapshot = self.get_day_activity_snapshot(date_str)?;
        let mut top_apps = snapshot.summary.top_apps;
        top_apps.truncate(limit.max(0) as usize);
        Ok(top_apps)
    }

    pub fn get_statistics_snapshot(
        &self,
        end_date_str: &str,
        range_days: i64,
        top_limit: i64,
    ) -> anyhow::Result<StatisticsSnapshot> {
        Ok(self
            .collect_range_activity_snapshot(end_date_str, range_days, top_limit, false)?
            .statistics_snapshot)
    }

    pub fn get_dashboard_bootstrap_snapshot(
        &self,
        end_date_str: &str,
        range_days: i64,
        top_limit: i64,
    ) -> anyhow::Result<BootstrapAggregationSnapshot> {
        let snapshot =
            self.collect_range_activity_snapshot(end_date_str, range_days, top_limit, true)?;

        Ok(BootstrapAggregationSnapshot {
            today_summary: snapshot
                .today_summary
                .expect("today summary requested for bootstrap"),
            statistics_snapshot: snapshot.statistics_snapshot,
        })
    }

    pub fn get_day_activity_snapshot(&self, date_str: &str) -> anyhow::Result<DayActivitySnapshot> {
        let (start, end) = day_bounds(date_str);
        let activity = self
            .get_activity_range(start, end)
            .with_context(|| format!("collect day activity for {date_str}"))?;
        Ok(aggregate_day_activity_snapshot(date_str, activity))
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
        // Full replace is only used when all aggregate fields are being refreshed together.
        self.save_daily_summary_full(summary)
    }

    pub fn update_daily_summary_ai_summary(
        &self,
        date_str: &str,
        ai_summary: Option<&str>,
    ) -> anyhow::Result<()> {
        // Keep this path narrow so feedback updates do not rewrite aggregate totals.
        self.update_daily_summary_ai_summary_only(date_str, ai_summary)
    }

    pub fn get_daily_summary(&self, date_str: &str) -> anyhow::Result<Option<DailySummary>> {
        // Full read is reserved for callers that need totals, top apps, and AI text together.
        self.read_daily_summary_full(date_str)
    }

    pub fn get_daily_summary_ai_summary(&self, date_str: &str) -> anyhow::Result<Option<String>> {
        // Lightweight read for callers that only need the stored AI summary text.
        self.read_daily_summary_ai_summary_only(date_str)
    }

    pub fn get_day_bounds(date_str: &str) -> (i64, i64) {
        day_bounds(date_str)
    }

    fn query_activity_range(
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

    fn save_daily_summary_full(&self, summary: &DailySummary) -> anyhow::Result<()> {
        // One upsert keeps the aggregate row authoritative when we intentionally refresh it.
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

    fn update_daily_summary_ai_summary_only(
        &self,
        date_str: &str,
        ai_summary: Option<&str>,
    ) -> anyhow::Result<()> {
        // Feedback edits only touch the AI text; totals come from the activity snapshot.
        self.activity
            .execute(
                "UPDATE daily_summary SET ai_summary = ?2 WHERE date = ?1",
                params![date_str, ai_summary],
            )
            .with_context(|| format!("update ai summary for {date_str}"))?;
        Ok(())
    }

    fn read_daily_summary_full(&self, date_str: &str) -> anyhow::Result<Option<DailySummary>> {
        // Full row parse remains centralized here to keep the SQL shape in one place.
        self.activity
            .query_row(
                "SELECT date, total_tracked_ms, productive_ms, distraction_ms, neutral_ms, top_apps, ai_summary FROM daily_summary WHERE date = ?1",
                params![date_str],
                read_daily_summary_row,
            )
            .optional()
            .with_context(|| format!("read daily summary for {date_str}"))
    }

    fn read_daily_summary_ai_summary_only(
        &self,
        date_str: &str,
    ) -> anyhow::Result<Option<String>> {
        // Avoid deserializing totals or top apps when the caller only needs AI text.
        self.activity
            .query_row(
                "SELECT ai_summary FROM daily_summary WHERE date = ?1",
                params![date_str],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .with_context(|| format!("read daily summary ai summary for {date_str}"))
            .map(|value| value.flatten())
    }

    fn collect_range_activity_snapshot(
        &self,
        end_date_str: &str,
        range_days: i64,
        top_limit: i64,
        include_today_summary: bool,
    ) -> anyhow::Result<RangeAggregationSnapshot> {
        let end_date = NaiveDate::parse_from_str(end_date_str, "%Y-%m-%d")
            .unwrap_or_else(|_| Utc::now().date_naive());
        let clamped_range_days = range_days.clamp(1, 30);
        let start_date = end_date - Duration::days(clamped_range_days - 1);
        let range_end_exclusive = end_date + Duration::days(1);
        let (start_ms, _) = day_bounds(&start_date.format("%Y-%m-%d").to_string());
        let (end_ms, _) = day_bounds(&range_end_exclusive.format("%Y-%m-%d").to_string());
        let activity = self
            .query_range_aggregation_rows(start_ms, end_ms)
            .with_context(|| format!("collect range activity for {end_date_str}"))?;
        let (statistics_snapshot, today_summary) = aggregate_range_activity_snapshot(
            end_date,
            clamped_range_days,
            top_limit,
            &activity,
            end_date_str,
            include_today_summary,
        );

        Ok(RangeAggregationSnapshot {
            statistics_snapshot,
            today_summary,
        })
    }

    fn query_range_aggregation_rows(
        &self,
        from_ms: i64,
        to_ms: i64,
    ) -> anyhow::Result<Vec<RangeAggregationRow>> {
        let mut stmt = match self.activity.prepare(
            r#"
            SELECT
              date(timestamp / 1000.0, 'unixepoch') AS day,
              process_name,
              category,
              SUM(duration_ms) AS total_ms
            FROM activity_log
            WHERE timestamp >= ?1 AND timestamp < ?2
            GROUP BY day, process_name, category
            ORDER BY day, process_name, category
            "#,
        ) {
            Ok(stmt) => stmt,
            Err(error) => {
                return Err(error)
                    .with_context(|| format!("prepare range aggregation query {from_ms}..{to_ms}"))
            }
        };

        let rows = match stmt.query_map(params![from_ms, to_ms], |row| {
            Ok(RangeAggregationRow {
                day: row.get(0)?,
                process_name: row.get(1)?,
                category: match row.get::<_, String>(2)?.as_str() {
                    "productive" => ActivityCategory::Productive,
                    "distraction" => ActivityCategory::Distraction,
                    "neutral" => ActivityCategory::Neutral,
                    _ => ActivityCategory::Unknown,
                },
                total_ms: row.get(3)?,
            })
        }) {
            Ok(rows) => rows,
            Err(error) => {
                return Err(error)
                    .with_context(|| format!("query range aggregation {from_ms}..{to_ms}"))
            }
        };

        rows.collect::<Result<Vec<_>, _>>()
            .with_context(|| format!("collect range aggregation {from_ms}..{to_ms}"))
    }
}

fn aggregate_day_activity_snapshot(
    date_str: &str,
    activity: Vec<ActivitySample>,
) -> DayActivitySnapshot {
    let top_apps = aggregate_top_apps(&activity, 10);
    let (tracked_ms, productive_ms, distraction_ms, neutral_ms) = aggregate_totals(&activity);

    DayActivitySnapshot {
        activity,
        summary: DailySummary {
            date: date_str.to_string(),
            total_tracked_ms: tracked_ms,
            productive_ms,
            distraction_ms,
            neutral_ms,
            top_apps,
            ai_summary: None,
        },
    }
}

fn read_daily_summary_row(row: &rusqlite::Row<'_>) -> Result<DailySummary, rusqlite::Error> {
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
}

fn aggregate_range_activity_snapshot(
    end_date: NaiveDate,
    range_days: i64,
    top_limit: i64,
    activity: &[RangeAggregationRow],
    today_date: &str,
    include_today_summary: bool,
) -> (StatisticsSnapshot, Option<DailySummary>) {
    let start_date = end_date - Duration::days(range_days - 1);
    let mut breakdown = std::collections::BTreeMap::<String, StatisticsDaySummary>::new();
    for offset in 0..range_days {
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

    let mut top_app_aggregates: HashMap<String, TopAppAggregate> = HashMap::new();
    let mut today_totals = include_today_summary.then(|| StatisticsDaySummary {
        date: today_date.to_string(),
        tracked_ms: 0,
        productive_ms: 0,
        distraction_ms: 0,
        neutral_ms: 0,
    });
    let mut today_top_app_aggregates: Option<HashMap<String, TopAppAggregate>> =
        include_today_summary.then(HashMap::new);

    for sample in activity {
        let day = sample.day.clone();
        let is_today = include_today_summary && day == today_date;
        let entry = breakdown.entry(day.clone()).or_insert_with(|| StatisticsDaySummary {
            date: day.clone(),
            tracked_ms: 0,
            productive_ms: 0,
            distraction_ms: 0,
            neutral_ms: 0,
        });
        entry.tracked_ms += sample.total_ms;
        totals.tracked_ms += sample.total_ms;

        if is_today {
            let today_totals = today_totals
                .as_mut()
                .expect("today totals present when summary is requested");
            today_totals.tracked_ms += sample.total_ms;
        }

        match sample.category {
            ActivityCategory::Productive => {
                entry.productive_ms += sample.total_ms;
                totals.productive_ms += sample.total_ms;
                if is_today {
                    let today_totals = today_totals
                        .as_mut()
                        .expect("today totals present when summary is requested");
                    today_totals.productive_ms += sample.total_ms;
                }
            }
            ActivityCategory::Distraction => {
                entry.distraction_ms += sample.total_ms;
                totals.distraction_ms += sample.total_ms;
                if is_today {
                    let today_totals = today_totals
                        .as_mut()
                        .expect("today totals present when summary is requested");
                    today_totals.distraction_ms += sample.total_ms;
                }
            }
            ActivityCategory::Neutral => {
                entry.neutral_ms += sample.total_ms;
                totals.neutral_ms += sample.total_ms;
                if is_today {
                    let today_totals = today_totals
                        .as_mut()
                        .expect("today totals present when summary is requested");
                    today_totals.neutral_ms += sample.total_ms;
                }
            }
            ActivityCategory::Unknown => {}
        }

        top_app_aggregates
            .entry(sample.process_name.clone())
            .or_default()
            .absorb(sample.category, sample.total_ms);

        if is_today {
            let today_top_app_aggregates = today_top_app_aggregates
                .as_mut()
                .expect("today aggregates present when summary is requested");
            today_top_app_aggregates
                .entry(sample.process_name.clone())
                .or_default()
                .absorb(sample.category, sample.total_ms);
        }
    }

    let top_apps = aggregate_top_apps_from_map(top_app_aggregates, top_limit);
    let active_days = breakdown.values().filter(|day| day.tracked_ms > 0).count() as i64;

    let statistics_snapshot = StatisticsSnapshot {
        range_days,
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
    };

    let today_summary = today_totals.map(|today_totals| DailySummary {
        date: today_date.to_string(),
        total_tracked_ms: today_totals.tracked_ms,
        productive_ms: today_totals.productive_ms,
        distraction_ms: today_totals.distraction_ms,
        neutral_ms: today_totals.neutral_ms,
        top_apps: aggregate_top_apps_from_map(
            today_top_app_aggregates.unwrap_or_default(),
            10,
        ),
        ai_summary: None,
    });

    (statistics_snapshot, today_summary)
}

fn aggregate_top_apps(activity: &[ActivitySample], limit: i64) -> Vec<TopApp> {
    let mut aggregates: HashMap<String, TopAppAggregate> = HashMap::new();
    for sample in activity {
        aggregates
            .entry(sample.process_name.clone())
            .or_default()
            .absorb(sample.category, sample.duration_ms);
    }

    aggregate_top_apps_from_map(aggregates, limit)
}

fn aggregate_top_apps_from_map(
    aggregates: HashMap<String, TopAppAggregate>,
    limit: i64,
) -> Vec<TopApp> {
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
    top_apps
}

fn aggregate_totals(activity: &[ActivitySample]) -> (i64, i64, i64, i64) {
    let mut total = 0;
    let mut productive = 0;
    let mut distraction = 0;
    let mut neutral = 0;

    for sample in activity {
        total += sample.duration_ms;
        match sample.category {
            ActivityCategory::Productive => productive += sample.duration_ms,
            ActivityCategory::Distraction => distraction += sample.duration_ms,
            ActivityCategory::Neutral => neutral += sample.duration_ms,
            ActivityCategory::Unknown => {}
        }
    }

    (total, productive, distraction, neutral)
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
        let day_snapshot = datastores
            .get_day_activity_snapshot("2026-05-19")
            .expect("read day snapshot");

        assert_eq!(top_apps.len(), 2);
        assert_eq!(top_apps[0].process_name, "editor.exe");
        assert_eq!(top_apps[0].category, ActivityCategory::Productive);
        assert_eq!(top_apps[0].duration_ms, 5_000);
        assert_eq!(top_apps[1].process_name, "browser.exe");
        assert_eq!(top_apps[1].category, ActivityCategory::Distraction);
        assert_eq!(top_apps[1].duration_ms, 4_000);

        assert_eq!(day_snapshot.summary.total_tracked_ms, 9_000);
        assert_eq!(day_snapshot.summary.productive_ms, 6_000);
        assert_eq!(day_snapshot.summary.distraction_ms, 3_000);
        assert_eq!(day_snapshot.summary.top_apps[0].process_name, "editor.exe");

        let snapshot = datastores
            .get_statistics_snapshot("2026-05-19", 7, 10)
            .expect("read statistics");

        assert_eq!(snapshot.top_apps[0].process_name, "editor.exe");
        assert_eq!(snapshot.top_apps[1].process_name, "browser.exe");
        assert_eq!(snapshot.top_apps[1].category, ActivityCategory::Distraction);

        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn bootstrap_aggregation_reuses_the_same_range_scan() {
        let (datastores, temp_dir) = create_test_datastores();
        let (today_start, _) = Datastores::get_day_bounds("2026-05-19");
        let (yesterday_start, _) = Datastores::get_day_bounds("2026-05-18");

        seed_activity(
            &datastores,
            yesterday_start + 1_000,
            "editor.exe",
            "Yesterday",
            ActivityCategory::Productive,
            "Code",
            2_000,
        );
        seed_activity(
            &datastores,
            today_start + 1_000,
            "browser.exe",
            "Today docs",
            ActivityCategory::Productive,
            "Docs",
            3_000,
        );
        seed_activity(
            &datastores,
            today_start + 2_000,
            "browser.exe",
            "Today social",
            ActivityCategory::Distraction,
            "Scroll",
            1_000,
        );

        let bootstrap = datastores
            .get_dashboard_bootstrap_snapshot("2026-05-19", 7, 10)
            .expect("read bootstrap snapshot");
        let today_snapshot = datastores
            .get_day_activity_snapshot("2026-05-19")
            .expect("read day snapshot");
        let statistics_snapshot = datastores
            .get_statistics_snapshot("2026-05-19", 7, 10)
            .expect("read statistics snapshot");

        assert_eq!(
            bootstrap.today_summary.total_tracked_ms,
            today_snapshot.summary.total_tracked_ms
        );
        assert_eq!(
            bootstrap.today_summary.productive_ms,
            today_snapshot.summary.productive_ms
        );
        assert_eq!(
            bootstrap.today_summary.distraction_ms,
            today_snapshot.summary.distraction_ms
        );
        let bootstrap_today_top_apps = bootstrap
            .today_summary
            .top_apps
            .iter()
            .map(|app| (app.process_name.as_str(), app.duration_ms, app.category))
            .collect::<Vec<_>>();
        let today_top_apps = today_snapshot
            .summary
            .top_apps
            .iter()
            .map(|app| (app.process_name.as_str(), app.duration_ms, app.category))
            .collect::<Vec<_>>();
        assert_eq!(bootstrap_today_top_apps, today_top_apps);
        assert_eq!(
            bootstrap.statistics_snapshot.tracked_ms,
            statistics_snapshot.tracked_ms
        );
        let bootstrap_breakdown = bootstrap
            .statistics_snapshot
            .daily_breakdown
            .iter()
            .map(|day| {
                (
                    day.date.as_str(),
                    day.tracked_ms,
                    day.productive_ms,
                    day.distraction_ms,
                    day.neutral_ms,
                )
            })
            .collect::<Vec<_>>();
        let statistics_breakdown = statistics_snapshot
            .daily_breakdown
            .iter()
            .map(|day| {
                (
                    day.date.as_str(),
                    day.tracked_ms,
                    day.productive_ms,
                    day.distraction_ms,
                    day.neutral_ms,
                )
            })
            .collect::<Vec<_>>();
        assert_eq!(bootstrap_breakdown, statistics_breakdown);
        let bootstrap_top_apps = bootstrap
            .statistics_snapshot
            .top_apps
            .iter()
            .map(|app| (app.process_name.as_str(), app.duration_ms, app.category))
            .collect::<Vec<_>>();
        let statistics_top_apps = statistics_snapshot
            .top_apps
            .iter()
            .map(|app| (app.process_name.as_str(), app.duration_ms, app.category))
            .collect::<Vec<_>>();
        assert_eq!(bootstrap_top_apps, statistics_top_apps);

        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn ai_summary_only_update_preserves_other_daily_summary_fields() {
        let (datastores, temp_dir) = create_test_datastores();
        let summary = DailySummary {
            date: "2026-05-19".to_string(),
            total_tracked_ms: 12_345,
            productive_ms: 8_000,
            distraction_ms: 3_000,
            neutral_ms: 1_345,
            top_apps: vec![TopApp {
                process_name: "editor.exe".to_string(),
                duration_ms: 12_345,
                category: ActivityCategory::Productive,
            }],
            ai_summary: Some("initial".to_string()),
        };

        datastores
            .save_daily_summary(&summary)
            .expect("save summary");
        datastores
            .update_daily_summary_ai_summary("2026-05-19", Some("edited"))
            .expect("update ai summary");

        let updated = datastores
            .get_daily_summary("2026-05-19")
            .expect("load summary")
            .expect("summary exists");

        assert_eq!(updated.total_tracked_ms, 12_345);
        assert_eq!(updated.productive_ms, 8_000);
        assert_eq!(updated.distraction_ms, 3_000);
        assert_eq!(updated.neutral_ms, 1_345);
        assert_eq!(updated.top_apps.len(), 1);
        assert_eq!(updated.top_apps[0].process_name, "editor.exe");
        assert_eq!(updated.ai_summary.as_deref(), Some("edited"));

        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn ai_summary_only_read_returns_just_the_summary_text() {
        let (datastores, temp_dir) = create_test_datastores();
        let summary = DailySummary {
            date: "2026-05-19".to_string(),
            total_tracked_ms: 4_000,
            productive_ms: 2_500,
            distraction_ms: 1_000,
            neutral_ms: 500,
            top_apps: vec![TopApp {
                process_name: "browser.exe".to_string(),
                duration_ms: 4_000,
                category: ActivityCategory::Productive,
            }],
            ai_summary: Some("brief summary".to_string()),
        };

        datastores
            .save_daily_summary(&summary)
            .expect("save summary");

        let ai_summary = datastores
            .get_daily_summary_ai_summary("2026-05-19")
            .expect("read ai summary");

        assert_eq!(ai_summary.as_deref(), Some("brief summary"));

        let _ = std::fs::remove_dir_all(temp_dir);
    }
}
