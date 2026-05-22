use std::{collections::HashMap, path::Path};

use anyhow::Context;
use chrono::{Duration, NaiveDate, Utc};
use rusqlite::{params, types::Type, Connection, OptionalExtension};

use crate::settings::ClassificationRule;
use crate::types::{
    ActivityCategory, ActivityLogEntry, ActivityLogQuery, ActivityLogSource, ActivitySample,
    BrowserVisit, ClassificationRuleRecord, ClassificationRuleScope, DailySummary,
    StatisticsDaySummary, StatisticsSnapshot, TopApp,
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

pub struct BrowserVisitInsert {
    pub browser: String,
    pub profile: String,
    pub source_visit_id: i64,
    pub url: String,
    pub title: String,
    pub visited_at: i64,
    pub last_visit_at: i64,
    pub source: String,
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
            CREATE TABLE IF NOT EXISTS classification_rules (
              id                  INTEGER PRIMARY KEY AUTOINCREMENT,
              process_name_pattern TEXT NOT NULL,
              window_title_pattern TEXT NOT NULL,
              category            TEXT NOT NULL,
              label               TEXT NOT NULL,
              enabled             INTEGER NOT NULL DEFAULT 1,
              scope               TEXT NOT NULL DEFAULT 'both',
              priority            INTEGER NOT NULL DEFAULT 0,
              source              TEXT NOT NULL DEFAULT 'manual',
              hit_count           INTEGER NOT NULL DEFAULT 0,
              last_used_at        INTEGER,
              created_at          INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
              updated_at          INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
            );
            "#,
        )?;
        Self::ensure_classification_rules_priority_column(&cache)?;

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
            CREATE TABLE IF NOT EXISTS browser_visit_log (
              id               INTEGER PRIMARY KEY AUTOINCREMENT,
              browser          TEXT NOT NULL,
              profile          TEXT NOT NULL,
              source_visit_id  INTEGER NOT NULL,
              url              TEXT NOT NULL,
              title            TEXT NOT NULL,
              visited_at       INTEGER NOT NULL,
              last_visit_at    INTEGER NOT NULL,
              source           TEXT NOT NULL,
              created_at       INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
              UNIQUE(browser, profile, source_visit_id)
            );
            CREATE INDEX IF NOT EXISTS idx_browser_visit_log_last_visit_at
              ON browser_visit_log(last_visit_at DESC, id DESC);
            CREATE INDEX IF NOT EXISTS idx_browser_visit_log_browser_profile
              ON browser_visit_log(browser, profile, visited_at DESC);
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

    pub fn get_classification_rules(&self) -> anyhow::Result<Vec<ClassificationRuleRecord>> {
        let mut stmt = self.cache.prepare(
            r#"
            SELECT
              id,
              process_name_pattern,
              window_title_pattern,
              category,
              label,
              enabled,
              scope,
              priority,
              source,
              hit_count,
              last_used_at,
              created_at,
              updated_at
            FROM classification_rules
            ORDER BY priority DESC, enabled DESC, last_used_at DESC, hit_count DESC, updated_at DESC, id DESC
            "#,
        )?;

        let rows = stmt.query_map([], |row| self.read_classification_rule_row(row))?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn replace_classification_rules_from_drafts(
        &self,
        drafts: &[ClassificationRule],
        source: &str,
    ) -> anyhow::Result<Vec<ClassificationRuleRecord>> {
        let tx = self.cache.unchecked_transaction()?;
        tx.execute("DELETE FROM classification_rules", [])?;

        let mut saved_rules = Vec::with_capacity(drafts.len());
        for (index, draft) in drafts.iter().enumerate() {
            let now = Self::now_ms();
            let record = ClassificationRuleRecord {
                id: 0,
                priority: drafts.len() as i64 - index as i64,
                process_name_pattern: draft.process_name_pattern.clone(),
                window_title_pattern: draft.window_title_pattern.clone(),
                category: draft.category,
                label: draft.label.clone(),
                enabled: draft.enabled,
                scope: draft.scope,
                source: source.to_string(),
                hit_count: 0,
                last_used_at: None,
                created_at: now,
                updated_at: now,
            };
            tx.execute(
                r#"
                INSERT INTO classification_rules (
                  process_name_pattern,
                  window_title_pattern,
                  category,
                  label,
                  enabled,
                  scope,
                  priority,
                  source,
                  hit_count,
                  last_used_at,
                  created_at,
                  updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                "#,
                params![
                    record.process_name_pattern,
                    record.window_title_pattern,
                    record.category.as_str(),
                    record.label,
                    if record.enabled { 1 } else { 0 },
                    scope_to_str(record.scope),
                    record.priority,
                    record.source,
                    record.hit_count,
                    record.last_used_at,
                    record.created_at,
                    record.updated_at,
                ],
            )?;
            saved_rules.push(Self::with_record_id(record, tx.last_insert_rowid()));
        }

        tx.commit()?;
        Ok(saved_rules)
    }

    pub fn upsert_classification_rule(
        &self,
        id: Option<i64>,
        draft: &ClassificationRule,
        source: &str,
    ) -> anyhow::Result<ClassificationRuleRecord> {
        match id {
            Some(id) => {
                let existing = self.get_classification_rule_by_id(id)?;
                if let Some(existing) = existing {
                    let updated = ClassificationRuleRecord {
                        id,
                        priority: existing.priority,
                        process_name_pattern: draft.process_name_pattern.clone(),
                        window_title_pattern: draft.window_title_pattern.clone(),
                        category: draft.category,
                        label: draft.label.clone(),
                        enabled: draft.enabled,
                        scope: draft.scope,
                        source: existing.source,
                        hit_count: existing.hit_count,
                        last_used_at: existing.last_used_at,
                        created_at: existing.created_at,
                        updated_at: Self::now_ms(),
                    };
                    self.write_classification_rule(&updated)?;
                    Ok(updated)
                } else {
                    self.insert_classification_rule(draft, source)
                }
            }
            None => self.insert_classification_rule(draft, source),
        }
    }

    pub fn insert_classification_rule(
        &self,
        draft: &ClassificationRule,
        source: &str,
    ) -> anyhow::Result<ClassificationRuleRecord> {
        let now = Self::now_ms();
        let priority = self.next_classification_rule_priority()?;
        let record = ClassificationRuleRecord {
            id: 0,
            priority,
            process_name_pattern: draft.process_name_pattern.clone(),
            window_title_pattern: draft.window_title_pattern.clone(),
            category: draft.category,
            label: draft.label.clone(),
            enabled: draft.enabled,
            scope: draft.scope,
            source: source.to_string(),
            hit_count: 0,
            last_used_at: None,
            created_at: now,
            updated_at: now,
        };
        let id = self.insert_classification_rule_record(&record)?;
        Ok(Self::with_record_id(record, id))
    }

    pub fn delete_classification_rule(&self, id: i64) -> anyhow::Result<()> {
        self.cache.execute(
            "DELETE FROM classification_rules WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    }

    pub fn set_classification_rule_enabled(
        &self,
        id: i64,
        enabled: bool,
    ) -> anyhow::Result<ClassificationRuleRecord> {
        let mut rule = self
            .get_classification_rule_by_id(id)?
            .ok_or_else(|| anyhow::anyhow!("missing classification rule {id}"))?;
        rule.enabled = enabled;
        rule.updated_at = Self::now_ms();
        self.write_classification_rule(&rule)?;
        Ok(rule)
    }

    pub fn record_classification_rule_hit(&self, id: i64, used_at: i64) -> anyhow::Result<()> {
        self.cache.execute(
            r#"
            UPDATE classification_rules
            SET hit_count = hit_count + 1,
                last_used_at = ?2,
                updated_at = ?2
            WHERE id = ?1
            "#,
            params![id, used_at],
        )?;
        Ok(())
    }

    pub fn get_classification_rule_by_id(
        &self,
        id: i64,
    ) -> anyhow::Result<Option<ClassificationRuleRecord>> {
        self.cache
            .query_row(
                r#"
                SELECT
                  id,
                  process_name_pattern,
                  window_title_pattern,
                  category,
                  label,
                  enabled,
                  scope,
                  priority,
                  source,
                  hit_count,
                  last_used_at,
                  created_at,
                  updated_at
                FROM classification_rules
                WHERE id = ?1
                "#,
                params![id],
                |row| self.read_classification_rule_row(row),
            )
            .optional()
            .map_err(Into::into)
    }

    fn insert_classification_rule_record(
        &self,
        rule: &ClassificationRuleRecord,
    ) -> anyhow::Result<i64> {
        self.cache.execute(
            r#"
            INSERT INTO classification_rules (
              process_name_pattern,
              window_title_pattern,
              category,
              label,
              enabled,
              scope,
              priority,
              source,
              hit_count,
              last_used_at,
              created_at,
              updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
            "#,
            params![
                rule.process_name_pattern,
                rule.window_title_pattern,
                rule.category.as_str(),
                rule.label,
                if rule.enabled { 1 } else { 0 },
                scope_to_str(rule.scope),
                rule.priority,
                rule.source,
                rule.hit_count,
                rule.last_used_at,
                rule.created_at,
                rule.updated_at,
            ],
        )?;
        Ok(self.cache.last_insert_rowid())
    }

    fn write_classification_rule(&self, rule: &ClassificationRuleRecord) -> anyhow::Result<()> {
        self.cache.execute(
            r#"
            INSERT INTO classification_rules (
              id,
              process_name_pattern,
              window_title_pattern,
              category,
              label,
              enabled,
              scope,
              priority,
              source,
              hit_count,
              last_used_at,
              created_at,
              updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
            ON CONFLICT(id) DO UPDATE SET
              process_name_pattern = excluded.process_name_pattern,
              window_title_pattern = excluded.window_title_pattern,
              category = excluded.category,
              label = excluded.label,
              enabled = excluded.enabled,
              scope = excluded.scope,
              priority = excluded.priority,
              source = excluded.source,
              hit_count = excluded.hit_count,
              last_used_at = excluded.last_used_at,
              created_at = excluded.created_at,
              updated_at = excluded.updated_at
            "#,
            params![
                rule.id,
                rule.process_name_pattern,
                rule.window_title_pattern,
                rule.category.as_str(),
                rule.label,
                if rule.enabled { 1 } else { 0 },
                scope_to_str(rule.scope),
                rule.priority,
                rule.source,
                rule.hit_count,
                rule.last_used_at,
                rule.created_at,
                rule.updated_at,
            ],
        )?;
        Ok(())
    }

    fn read_classification_rule_row(
        &self,
        row: &rusqlite::Row<'_>,
    ) -> Result<ClassificationRuleRecord, rusqlite::Error> {
        let category = match row.get::<_, String>(3)?.as_str() {
            "productive" => ActivityCategory::Productive,
            "distraction" => ActivityCategory::Distraction,
            "neutral" => ActivityCategory::Neutral,
            _ => ActivityCategory::Unknown,
        };
        let scope = match row.get::<_, String>(6)?.as_str() {
            "process" => ClassificationRuleScope::Process,
            "title" => ClassificationRuleScope::Title,
            _ => ClassificationRuleScope::Both,
        };
        Ok(ClassificationRuleRecord {
            id: row.get(0)?,
            process_name_pattern: row.get(1)?,
            window_title_pattern: row.get(2)?,
            category,
            label: row.get(4)?,
            enabled: row.get::<_, i64>(5)? != 0,
            scope,
            priority: row.get(7)?,
            source: row.get(8)?,
            hit_count: row.get(9)?,
            last_used_at: row.get(10)?,
            created_at: row.get(11)?,
            updated_at: row.get(12)?,
        })
    }

    fn with_record_id(mut rule: ClassificationRuleRecord, id: i64) -> ClassificationRuleRecord {
        rule.id = id;
        rule
    }

    fn next_classification_rule_priority(&self) -> anyhow::Result<i64> {
        self.cache
            .query_row(
                "SELECT COALESCE(MAX(priority), 0) + 1 FROM classification_rules",
                [],
                |row| row.get(0),
            )
            .map_err(Into::into)
    }

    pub fn move_classification_rule(
        &self,
        id: i64,
        direction: &str,
    ) -> anyhow::Result<ClassificationRuleRecord> {
        let mut rules = self.get_classification_rules()?;
        let Some(current_index) = rules.iter().position(|rule| rule.id == id) else {
            anyhow::bail!("missing classification rule {id}");
        };

        let target_index = match direction {
            "up" if current_index > 0 => current_index - 1,
            "down" if current_index + 1 < rules.len() => current_index + 1,
            "up" | "down" => return Ok(rules[current_index].clone()),
            other => anyhow::bail!("invalid rule move direction {other}"),
        };

        rules.swap(current_index, target_index);
        self.resequence_classification_rule_priorities(&rules)?;
        let updated_rules = self.get_classification_rules()?;
        Ok(updated_rules
            .into_iter()
            .find(|rule| rule.id == id)
            .expect("moved rule must still exist"))
    }

    pub fn reorder_classification_rule(
        &self,
        id: i64,
        target_id: i64,
        placement: &str,
    ) -> anyhow::Result<ClassificationRuleRecord> {
        if id == target_id {
            return self
                .get_classification_rule_by_id(id)?
                .ok_or_else(|| anyhow::anyhow!("missing classification rule {id}"));
        }

        let mut rules = self.get_classification_rules()?;
        let Some(from_index) = rules.iter().position(|rule| rule.id == id) else {
            anyhow::bail!("missing classification rule {id}");
        };
        let Some(mut target_index) = rules.iter().position(|rule| rule.id == target_id) else {
            anyhow::bail!("missing classification rule {target_id}");
        };

        let rule = rules.remove(from_index);
        if from_index < target_index {
            target_index -= 1;
        }

        let insert_index = match placement {
            "before" => target_index,
            "after" => target_index + 1,
            other => anyhow::bail!("invalid rule placement {other}"),
        };
        rules.insert(insert_index.min(rules.len()), rule);

        self.resequence_classification_rule_priorities(&rules)?;
        self.get_classification_rule_by_id(id)?
            .ok_or_else(|| anyhow::anyhow!("missing classification rule {id}"))
    }

    pub fn resequence_classification_rule_priorities(
        &self,
        ordered_rules: &[ClassificationRuleRecord],
    ) -> anyhow::Result<()> {
        let tx = self.cache.unchecked_transaction()?;
        let total = ordered_rules.len() as i64;
        for (index, rule) in ordered_rules.iter().enumerate() {
            let priority = total - index as i64;
            tx.execute(
                "UPDATE classification_rules SET priority = ?2 WHERE id = ?1",
                params![rule.id, priority],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    fn ensure_classification_rules_priority_column(cache: &Connection) -> anyhow::Result<()> {
        let mut stmt = cache.prepare("PRAGMA table_info(classification_rules)")?;
        let columns = stmt
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<Result<Vec<_>, _>>()?;
        if columns.iter().any(|column| column == "priority") {
            return Ok(());
        }

        cache.execute(
            "ALTER TABLE classification_rules ADD COLUMN priority INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
        Ok(())
    }

    fn now_ms() -> i64 {
        Utc::now().timestamp_millis()
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

    pub fn insert_browser_visit(&self, visit: BrowserVisitInsert) -> anyhow::Result<bool> {
        let affected = self
            .activity
            .execute(
                "INSERT OR IGNORE INTO browser_visit_log (browser, profile, source_visit_id, url, title, visited_at, last_visit_at, source) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    visit.browser,
                    visit.profile,
                    visit.source_visit_id,
                    visit.url,
                    visit.title,
                    visit.visited_at,
                    visit.last_visit_at,
                    visit.source,
                ],
            )
            .with_context(|| "insert browser visit".to_string())?;
        Ok(affected > 0)
    }

    pub fn get_browser_visits(&self, limit: i64) -> anyhow::Result<Vec<BrowserVisit>> {
        let mut stmt = self.activity.prepare(
            "SELECT browser, profile, url, title, visited_at, last_visit_at, source FROM browser_visit_log ORDER BY last_visit_at DESC, visited_at DESC, id DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit.max(0)], |row| {
            Ok(BrowserVisit {
                browser: row.get(0)?,
                profile: row.get(1)?,
                url: row.get(2)?,
                title: row.get(3)?,
                visited_at: row.get(4)?,
                last_visit_at: row.get(5)?,
                source: row.get(6)?,
            })
        })?;

        rows.collect::<Result<Vec<_>, _>>()
            .with_context(|| "collect browser visits".to_string())
    }

    pub fn get_activity_range(
        &self,
        from_ms: i64,
        to_ms: i64,
    ) -> anyhow::Result<Vec<ActivitySample>> {
        self.query_activity_range(from_ms, to_ms)
    }

    pub fn get_activity_log_entries(
        &self,
        query: &ActivityLogQuery,
    ) -> anyhow::Result<Vec<ActivityLogEntry>> {
        let (from_ms, to_ms) = day_bounds(&query.date);
        let mut entries = self.read_foreground_activity_log_entries(from_ms, to_ms)?;
        entries.extend(self.read_browser_activity_log_entries(from_ms, to_ms)?);

        let app_filter = normalize_activity_log_text(query.app.as_deref());
        let browser_filter = normalize_activity_log_text(query.browser.as_deref());
        let limit = query.limit.unwrap_or(200).max(0) as usize;

        entries.retain(|entry| {
            if let Some(source) = query.source {
                if entry.source != source {
                    return false;
                }
            }

            if let Some(category) = query.category {
                if entry.category != category {
                    return false;
                }
            }

            if let Some(ref browser_filter) = browser_filter {
                let Some(entry_browser) = entry.browser.as_deref() else {
                    return false;
                };
                if !contains_activity_log_text(entry_browser, browser_filter) {
                    return false;
                }
            }

            if let Some(ref app_filter) = app_filter {
                if !entry_matches_activity_log_text(entry, app_filter) {
                    return false;
                }
            }

            true
        });

        entries.sort_by(|left, right| {
            right
                .timestamp
                .cmp(&left.timestamp)
                .then_with(|| source_rank(right.source).cmp(&source_rank(left.source)))
                .then_with(|| right.id.cmp(&left.id))
        });
        entries.truncate(limit);
        Ok(entries)
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

    fn read_foreground_activity_log_entries(
        &self,
        from_ms: i64,
        to_ms: i64,
    ) -> anyhow::Result<Vec<ActivityLogEntry>> {
        let activity = self.query_activity_range(from_ms, to_ms)?;
        Ok(activity
            .into_iter()
            .map(|sample| ActivityLogEntry {
                id: format!("activity:{}", sample.id),
                timestamp: sample.timestamp,
                source: ActivityLogSource::Foreground,
                origin: "activity-log".to_string(),
                app_name: sample.process_name,
                title: sample.window_title,
                category: sample.category,
                label: sample.label,
                duration_ms: Some(sample.duration_ms),
                browser: None,
                profile: None,
                url: None,
            })
            .collect())
    }

    fn read_browser_activity_log_entries(
        &self,
        from_ms: i64,
        to_ms: i64,
    ) -> anyhow::Result<Vec<ActivityLogEntry>> {
        let mut stmt = self.activity.prepare(
            "SELECT id, browser, profile, url, title, visited_at, last_visit_at, source FROM browser_visit_log WHERE visited_at >= ?1 AND visited_at < ?2 ORDER BY visited_at DESC, last_visit_at DESC, id DESC",
        )?;
        let rows = stmt.query_map(params![from_ms, to_ms], |row| {
            let browser: String = row.get(1)?;
            let profile: String = row.get(2)?;
            let url: String = row.get(3)?;
            let title: String = row.get(4)?;
            let visited_at: i64 = row.get(5)?;
            let source: String = row.get(7)?;
            let display_title = if title.trim().is_empty() {
                url.clone()
            } else {
                title.clone()
            };

            Ok(ActivityLogEntry {
                id: format!("browser:{}", row.get::<_, i64>(0)?),
                timestamp: visited_at,
                source: ActivityLogSource::Browser,
                origin: source.clone(),
                app_name: browser.clone(),
                title: display_title,
                category: ActivityCategory::Unknown,
                label: source,
                duration_ms: None,
                browser: Some(browser),
                profile: Some(profile),
                url: Some(url),
            })
        })?;

        rows.collect::<Result<Vec<_>, _>>()
            .with_context(|| format!("collect browser activity log entries {from_ms}..{to_ms}"))
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

    fn read_daily_summary_ai_summary_only(&self, date_str: &str) -> anyhow::Result<Option<String>> {
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
        let entry = breakdown
            .entry(day.clone())
            .or_insert_with(|| StatisticsDaySummary {
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
        top_apps: aggregate_top_apps_from_map(today_top_app_aggregates.unwrap_or_default(), 10),
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

fn source_rank(source: ActivityLogSource) -> u8 {
    match source {
        ActivityLogSource::Foreground => 1,
        ActivityLogSource::Browser => 0,
    }
}

fn normalize_activity_log_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_lowercase())
}

fn contains_activity_log_text(value: &str, needle: &str) -> bool {
    value.to_lowercase().contains(needle)
}

fn entry_matches_activity_log_text(entry: &ActivityLogEntry, needle: &str) -> bool {
    let haystacks = [
        entry.app_name.as_str(),
        entry.title.as_str(),
        entry.label.as_str(),
        entry.origin.as_str(),
        entry.browser.as_deref().unwrap_or_default(),
        entry.profile.as_deref().unwrap_or_default(),
        entry.url.as_deref().unwrap_or_default(),
    ];

    haystacks
        .into_iter()
        .any(|value| contains_activity_log_text(value, needle))
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
            .max_by(
                |(left_category, left_total), (right_category, right_total)| {
                    left_total.cmp(right_total).then_with(|| {
                        category_rank(**left_category).cmp(&category_rank(**right_category))
                    })
                },
            )
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

fn scope_to_str(scope: ClassificationRuleScope) -> &'static str {
    match scope {
        ClassificationRuleScope::Process => "process",
        ClassificationRuleScope::Title => "title",
        ClassificationRuleScope::Both => "both",
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
