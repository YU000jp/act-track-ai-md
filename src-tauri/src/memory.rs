use std::collections::HashMap;
use std::path::Path;

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension};

use crate::types::{MemoryRecord, MemoryStatus};

pub struct MemorySearchResult {
    pub record: MemoryRecord,
    pub score: f64,
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
              pinned        INTEGER NOT NULL DEFAULT 0,
              created_at    INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
            );
            CREATE INDEX IF NOT EXISTS idx_memory_entries_created_at ON memory_entries(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_memory_entries_pinned ON memory_entries(pinned, created_at DESC);
            "#,
        )?;

        Ok(Self { db })
    }

    pub fn initialize(&self) {}

    pub fn save(&self, memory_type: &str, content: &str, metadata: &HashMap<String, String>, pinned: bool) {
        let content = content.trim();
        if content.is_empty() {
            return;
        }

        let _ = self.db.execute(
            "INSERT INTO memory_entries (type, content, metadata_json, pinned) VALUES (?1, ?2, ?3, ?4)",
            params![memory_type, content, serde_json::to_string(metadata).unwrap_or_else(|_| "{}".to_string()), i64::from(pinned)],
        );
    }

    pub fn search(&self, query: &str, limit: usize) -> Vec<MemorySearchResult> {
        let tokens = to_tokens(query);
        let rows = self.list_rows(limit.saturating_mul(4).max(limit));

        let mut entries: Vec<_> = rows
            .into_iter()
            .map(|record| {
                let content = format!("{} {} {}", record.memory_type, record.content, serde_json::to_string(&record.metadata).unwrap_or_default());
                let score = score_content(&content, &tokens);
                MemorySearchResult { record, score }
            })
            .filter(|entry| entry.score > 0.0 || tokens.is_empty())
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
        let _ = self.db.execute("DELETE FROM memory_entries WHERE id = ?1", params![id]);
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

    fn list_rows(&self, limit: usize) -> Vec<MemoryRecord> {
        let mut stmt = match self.db.prepare(
            "SELECT id, type, content, metadata_json, pinned, created_at FROM memory_entries ORDER BY pinned DESC, created_at DESC LIMIT ?1",
        ) {
            Ok(stmt) => stmt,
            Err(_) => return Vec::new(),
        };

        let rows = match stmt.query_map(params![limit as i64], |row| {
            let metadata_json: String = row.get(3)?;
            let metadata: HashMap<String, String> = serde_json::from_str(&metadata_json).unwrap_or_default();
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
}

fn score_content(content: &str, query_tokens: &[String]) -> f64 {
    if query_tokens.is_empty() {
        return 0.0;
    }

    let normalized = content.to_lowercase();
    let hits = query_tokens
        .iter()
        .filter(|token| normalized.contains(token.as_str()))
        .count();
    hits as f64 / query_tokens.len() as f64
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
