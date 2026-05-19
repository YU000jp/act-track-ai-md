use std::collections::HashMap;
use std::path::Path;

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension};

use crate::types::{MemoryRecord, MemoryStatus};

pub struct MemorySearchResult {
    pub record: MemoryRecord,
    pub score: f64,
}

struct MemorySearchRow {
    record: MemoryRecord,
    search_text: String,
}

pub struct MemoryStore {
    db: Connection,
}

impl MemoryStore {
    pub fn open(path: &Path) -> anyhow::Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).with_context(|| format!("create {:?}", parent))?;
        }

        let db = Connection::open(path)?;
        db.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS memory_entries (
              id            INTEGER PRIMARY KEY AUTOINCREMENT,
              type          TEXT NOT NULL,
              content       TEXT NOT NULL,
              metadata_json TEXT NOT NULL DEFAULT '{}',
              search_text   TEXT NOT NULL DEFAULT '',
              pinned        INTEGER NOT NULL DEFAULT 0,
              created_at    INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
            );
            CREATE INDEX IF NOT EXISTS idx_memory_entries_created_at ON memory_entries(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_memory_entries_pinned ON memory_entries(pinned, created_at DESC);
            "#,
        )?;
        ensure_search_text_column(&db)?;

        Ok(Self { db })
    }

    pub fn initialize(&self) {}

    pub fn save(
        &self,
        memory_type: &str,
        content: &str,
        metadata: &HashMap<String, String>,
        pinned: bool,
    ) {
        let content = content.trim();
        if content.is_empty() {
            return;
        }

        let search_text = build_search_text(memory_type, content, metadata);
        let _ = self.db.execute(
            "INSERT INTO memory_entries (type, content, metadata_json, search_text, pinned) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![memory_type, content, serde_json::to_string(metadata).unwrap_or_else(|_| "{}".to_string()), search_text, i64::from(pinned)],
        );
    }

    pub fn search(&self, query: &str, limit: usize) -> Vec<MemorySearchResult> {
        if limit == 0 {
            return Vec::new();
        }

        let tokens = to_tokens(query);
        if tokens.is_empty() {
            return self
                .list_rows(limit)
                .into_iter()
                .map(|record| MemorySearchResult { record, score: 0.0 })
                .collect();
        }

        let total_rows = self.count_rows();
        let rows = self.list_search_rows(search_candidate_limit(limit, total_rows));

        let mut entries: Vec<_> = rows
            .into_iter()
            .map(|record| {
                let score = score_content(&record.search_text, &tokens);
                MemorySearchResult {
                    record: record.record,
                    score,
                }
            })
            .filter(|entry| entry.score > 0.0)
            .collect();

        entries.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| b.record.pinned.cmp(&a.record.pinned))
                .then_with(|| b.record.created_at.cmp(&a.record.created_at))
        });

        entries.truncate(limit);
        entries
    }

    pub fn recall(&self, limit: usize) -> Vec<MemoryRecord> {
        self.list_rows(limit)
    }

    pub fn forget(&self, id: i64) {
        let _ = self
            .db
            .execute("DELETE FROM memory_entries WHERE id = ?1", params![id]);
    }

    pub fn pin(&self, id: i64, pinned: bool) {
        let _ = self.db.execute(
            "UPDATE memory_entries SET pinned = ?1 WHERE id = ?2",
            params![i64::from(pinned), id],
        );
    }

    pub fn get_status(&self) -> MemoryStatus {
        let row = self
            .db
            .query_row(
                "SELECT COUNT(*) AS total, SUM(CASE WHEN pinned = 1 THEN 1 ELSE 0 END) AS pinned FROM memory_entries",
                [],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<i64>>(1)?)),
            )
            .optional()
            .ok()
            .flatten()
            .unwrap_or((0, Some(0)));

        MemoryStatus {
            enabled: true,
            backend: "sqlite".to_string(),
            total: row.0.max(0) as usize,
            pinned: row.1.unwrap_or(0).max(0) as usize,
        }
    }

    pub fn get_snapshot(&self, limit: usize) -> (MemoryStatus, Vec<MemoryRecord>) {
        (self.get_status(), self.recall(limit))
    }

    fn list_rows(&self, limit: usize) -> Vec<MemoryRecord> {
        let mut stmt = match self.db.prepare(
            "SELECT id, type, content, metadata_json, pinned, created_at FROM memory_entries ORDER BY pinned DESC, created_at DESC LIMIT ?1",
        ) {
            Ok(stmt) => stmt,
            Err(_) => return Vec::new(),
        };

        let rows = match stmt.query_map(params![limit as i64], |row| {
            let metadata_json: String = row.get(3)?;
            let metadata: HashMap<String, String> =
                serde_json::from_str(&metadata_json).unwrap_or_default();
            Ok(MemoryRecord {
                id: row.get(0)?,
                memory_type: row.get::<_, String>(1)?,
                content: row.get(2)?,
                metadata,
                pinned: row.get::<_, i64>(4)? == 1,
                created_at: row.get(5)?,
            })
        }) {
            Ok(rows) => rows,
            Err(_) => return Vec::new(),
        };

        rows.filter_map(Result::ok).collect()
    }

    fn list_search_rows(&self, limit: usize) -> Vec<MemorySearchRow> {
        let mut stmt = match self.db.prepare(
            "SELECT id, type, content, metadata_json, search_text, pinned, created_at FROM memory_entries ORDER BY pinned DESC, created_at DESC LIMIT ?1",
        ) {
            Ok(stmt) => stmt,
            Err(_) => return Vec::new(),
        };

        let rows = match stmt.query_map(params![limit as i64], |row| {
            let metadata_json: String = row.get(3)?;
            let metadata: HashMap<String, String> =
                serde_json::from_str(&metadata_json).unwrap_or_default();
            Ok(MemorySearchRow {
                record: MemoryRecord {
                    id: row.get(0)?,
                    memory_type: row.get::<_, String>(1)?,
                    content: row.get(2)?,
                    metadata,
                    pinned: row.get::<_, i64>(5)? == 1,
                    created_at: row.get(6)?,
                },
                search_text: row.get::<_, String>(4)?,
            })
        }) {
            Ok(rows) => rows,
            Err(_) => return Vec::new(),
        };

        rows.filter_map(Result::ok).collect()
    }

    fn count_rows(&self) -> usize {
        self.db
            .query_row("SELECT COUNT(*) FROM memory_entries", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap_or(0)
            .max(0) as usize
    }
}

fn score_content(content: &str, query_tokens: &[String]) -> f64 {
    if query_tokens.is_empty() {
        return 0.0;
    }

    let hits = query_tokens
        .iter()
        .filter(|token| content.contains(token.as_str()))
        .count();
    hits as f64 / query_tokens.len() as f64
}

fn build_search_text(
    memory_type: &str,
    content: &str,
    metadata: &HashMap<String, String>,
) -> String {
    let mut text = String::with_capacity(
        memory_type.len()
            + content.len()
            + metadata
                .iter()
                .map(|(key, value)| key.len() + value.len() + 2)
                .sum::<usize>(),
    );
    text.push_str(memory_type);
    text.push(' ');
    text.push_str(content);
    for (key, value) in metadata {
        text.push(' ');
        text.push_str(key);
        text.push(' ');
        text.push_str(value);
    }
    text.to_lowercase()
}

fn search_candidate_limit(limit: usize, total_rows: usize) -> usize {
    if total_rows <= limit {
        total_rows
    } else {
        limit.saturating_mul(3).max(limit).min(total_rows)
    }
}

fn ensure_search_text_column(db: &Connection) -> anyhow::Result<()> {
    let mut stmt = db.prepare("PRAGMA table_info(memory_entries)")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
    let mut has_search_text = false;

    for column in rows {
        if column? == "search_text" {
            has_search_text = true;
            break;
        }
    }

    if !has_search_text {
        db.execute(
            "ALTER TABLE memory_entries ADD COLUMN search_text TEXT NOT NULL DEFAULT ''",
            [],
        )?;
        backfill_search_text(db)?;
    }

    Ok(())
}

fn backfill_search_text(db: &Connection) -> anyhow::Result<()> {
    let mut stmt = db.prepare(
        "SELECT id, type, content, metadata_json FROM memory_entries WHERE search_text = ''",
    )?;
    let rows = stmt.query_map([], |row| {
        let metadata_json: String = row.get(3)?;
        let metadata: HashMap<String, String> =
            serde_json::from_str(&metadata_json).unwrap_or_default();
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            metadata,
        ))
    })?;

    for row in rows.filter_map(Result::ok) {
        let (id, memory_type, content, metadata) = row;
        let search_text = build_search_text(&memory_type, &content, &metadata);
        db.execute(
            "UPDATE memory_entries SET search_text = ?1 WHERE id = ?2",
            params![search_text, id],
        )?;
    }

    Ok(())
}

fn to_tokens(value: &str) -> Vec<String> {
    value
        .to_lowercase()
        .split(|c: char| !matches!(c, 'a'..='z' | '0'..='9' | '\u{3040}'..='\u{30ff}' | '\u{4e00}'..='\u{9faf}'))
        .map(str::trim)
        .filter(|token| token.len() > 1)
        .map(ToOwned::to_owned)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn create_test_store() -> (MemoryStore, PathBuf) {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let base_dir = std::env::temp_dir().join(format!("act-track-ai-md-memory-test-{unique}"));
        std::fs::create_dir_all(&base_dir).expect("create temp dir");
        let path = base_dir.join("memory.db");
        let store = MemoryStore::open(&path).expect("open memory store");
        (store, base_dir)
    }

    fn insert_memory(
        store: &MemoryStore,
        memory_type: &str,
        content: &str,
        metadata_json: &str,
        pinned: bool,
        created_at: i64,
    ) {
        let metadata: HashMap<String, String> =
            serde_json::from_str(metadata_json).expect("parse metadata");
        let search_text = build_search_text(memory_type, content, &metadata);
        store
            .db
            .execute(
                "INSERT INTO memory_entries (type, content, metadata_json, search_text, pinned, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![memory_type, content, metadata_json, search_text, i64::from(pinned), created_at],
            )
            .expect("insert memory");
    }

    #[test]
    fn search_ranks_relevant_results_first() {
        let (store, temp_dir) = create_test_store();
        insert_memory(
            &store,
            "pattern",
            "Project notes",
            r#"{"topic":"project","detail":"notes"}"#,
            false,
            100,
        );
        insert_memory(
            &store,
            "context",
            "Random memo",
            r#"{"topic":"project"}"#,
            false,
            200,
        );
        insert_memory(
            &store,
            "feedback",
            "Unrelated",
            r#"{"topic":"other"}"#,
            false,
            300,
        );

        let results = store.search("project notes", 2);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].record.content, "Project notes");
        assert!(results[0].score > results[1].score);

        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn search_with_empty_query_returns_recent_results_up_to_limit() {
        let (store, temp_dir) = create_test_store();
        insert_memory(&store, "context", "Older", r#"{}"#, false, 100);
        insert_memory(&store, "context", "Newer", r#"{}"#, false, 200);

        let results = store.search("", 1);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].record.content, "Newer");

        let _ = std::fs::remove_dir_all(temp_dir);
    }
}
