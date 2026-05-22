use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use anyhow::Context;
use chrono::Utc;
use rusqlite::{params, Connection, OpenFlags};

use crate::db::{BrowserVisitInsert, Datastores};
use crate::settings::AppSettings;

const CHROMIUM_EPOCH_OFFSET_MS: i64 = 11_644_473_600_000;
const DEFAULT_LOOKBACK_DAYS: i64 = 7;
const MAX_BATCH_SIZE: i64 = 500;

#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq)]
enum BrowserHistoryKind {
    Chromium,
    Firefox,
}

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
struct BrowserProfileKey {
    browser: String,
    profile: String,
}

#[derive(Clone, Debug)]
struct BrowserProfile {
    browser: String,
    profile: String,
    kind: BrowserHistoryKind,
    history_path: PathBuf,
}

#[derive(Clone, Debug)]
struct BrowserWatermark {
    visit_time_raw: i64,
    source_visit_id: i64,
}

impl BrowserWatermark {
    fn initial(kind: BrowserHistoryKind) -> Self {
        let lookback_ms = DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
        Self {
            visit_time_raw: unix_ms_to_history_time(
                kind,
                Utc::now().timestamp_millis() - lookback_ms,
            ),
            source_visit_id: 0,
        }
    }
}

#[derive(Clone, Debug)]
struct BrowserHistoryRow {
    source_visit_id: i64,
    url: String,
    title: String,
    visited_at_raw: i64,
    last_visit_at_raw: i64,
}

pub struct BrowserHistoryCollector {
    watermarks: HashMap<BrowserProfileKey, BrowserWatermark>,
}

impl BrowserHistoryCollector {
    pub fn new() -> Self {
        Self {
            watermarks: HashMap::new(),
        }
    }

    pub fn sync(&mut self, datastores: &Arc<Mutex<Datastores>>, settings: &AppSettings) -> usize {
        if !settings.browser_history_enabled {
            return 0;
        }

        let mut inserted = 0usize;
        for profile in discover_browser_profiles() {
            let key = BrowserProfileKey {
                browser: profile.browser.clone(),
                profile: profile.profile.clone(),
            };
            let watermark = self
                .watermarks
                .entry(key.clone())
                .or_insert_with(|| BrowserWatermark::initial(profile.kind))
                .clone();

            match read_history_rows(
                profile.kind,
                &profile.history_path,
                watermark.visit_time_raw,
                watermark.source_visit_id,
                MAX_BATCH_SIZE,
            ) {
                Ok(rows) => {
                    let mut next_watermark = watermark;
                    for row in rows {
                        let visit = BrowserVisitInsert {
                            browser: profile.browser.clone(),
                            profile: profile.profile.clone(),
                            source_visit_id: row.source_visit_id,
                            url: row.url.clone(),
                            title: row.title.clone(),
                            visited_at: history_time_to_unix_ms(profile.kind, row.visited_at_raw),
                            last_visit_at: history_time_to_unix_ms(
                                profile.kind,
                                row.last_visit_at_raw,
                            ),
                            source: "history-db".to_string(),
                        };

                        match datastores.lock() {
                            Ok(datastores) => match datastores.insert_browser_visit(visit) {
                                Ok(saved) if saved => {
                                    inserted += 1;
                                }
                                Ok(_) => {}
                                Err(error) => {
                                    log::warn!(
                                        "browser history insert failed for {} / {}: {error}",
                                        profile.browser,
                                        profile.profile
                                    );
                                }
                            },
                            Err(error) => {
                                log::warn!(
                                    "browser history datastore lock failed for {} / {}: {error}",
                                    profile.browser,
                                    profile.profile
                                );
                            }
                        }

                        if row.visited_at_raw > next_watermark.visit_time_raw
                            || (row.visited_at_raw == next_watermark.visit_time_raw
                                && row.source_visit_id > next_watermark.source_visit_id)
                        {
                            next_watermark.visit_time_raw = row.visited_at_raw;
                            next_watermark.source_visit_id = row.source_visit_id;
                        }
                    }

                    self.watermarks.insert(key, next_watermark);
                }
                Err(error) => {
                    log::warn!(
                        "browser history sync failed for {} / {}: {error}",
                        profile.browser,
                        profile.profile
                    );
                }
            }
        }

        inserted
    }
}

fn discover_browser_profiles() -> Vec<BrowserProfile> {
    let mut profiles = Vec::new();
    for (browser, kind, root, history_file) in browser_history_roots() {
        profiles.extend(discover_profiles_for_browser(
            &browser,
            kind,
            &root,
            history_file,
        ));
    }
    profiles.sort_by(|left, right| {
        left.browser
            .cmp(&right.browser)
            .then_with(|| left.profile.cmp(&right.profile))
    });
    profiles
}

fn browser_history_roots() -> Vec<(String, BrowserHistoryKind, PathBuf, &'static str)> {
    let mut roots = Vec::new();

    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        let base = PathBuf::from(local_app_data);
        roots.push((
            "chrome".to_string(),
            BrowserHistoryKind::Chromium,
            base.join("Google").join("Chrome").join("User Data"),
            "History",
        ));
        roots.push((
            "edge".to_string(),
            BrowserHistoryKind::Chromium,
            base.join("Microsoft").join("Edge").join("User Data"),
            "History",
        ));
    }

    for root in firefox_profile_roots() {
        roots.push((
            "firefox".to_string(),
            BrowserHistoryKind::Firefox,
            root,
            "places.sqlite",
        ));
    }

    roots
}

fn firefox_profile_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();

    if let Some(app_data) = std::env::var_os("APPDATA") {
        roots.push(
            PathBuf::from(app_data)
                .join("Mozilla")
                .join("Firefox")
                .join("Profiles"),
        );
    }

    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        roots.push(
            PathBuf::from(local_app_data)
                .join("Mozilla")
                .join("Firefox")
                .join("Profiles"),
        );
    }

    if let Some(home) = std::env::var_os("HOME") {
        roots.push(PathBuf::from(home.clone()).join(".mozilla").join("firefox"));
        roots.push(
            PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("Firefox")
                .join("Profiles"),
        );
    }

    roots
}

fn discover_profiles_for_browser(
    browser: &str,
    kind: BrowserHistoryKind,
    root: &Path,
    history_filename: &'static str,
) -> Vec<BrowserProfile> {
    let mut profiles = Vec::new();
    let Ok(entries) = std::fs::read_dir(root) else {
        return profiles;
    };

    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }

        let history_path = entry.path().join(history_filename);
        if !history_path.is_file() {
            continue;
        }

        let profile_name = entry.file_name().to_string_lossy().to_string();
        profiles.push(BrowserProfile {
            browser: browser.to_string(),
            profile: profile_name,
            kind,
            history_path,
        });
    }

    profiles
}

fn read_history_rows(
    kind: BrowserHistoryKind,
    history_path: &Path,
    since_visit_time_raw: i64,
    since_visit_id: i64,
    limit: i64,
) -> anyhow::Result<Vec<BrowserHistoryRow>> {
    let connection = Connection::open_with_flags(history_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .with_context(|| format!("open browser history database at {:?}", history_path))?;
    connection.busy_timeout(std::time::Duration::from_millis(250))?;

    let query = match kind {
        BrowserHistoryKind::Chromium => {
            r#"
            SELECT
              v.id,
              u.url,
              COALESCE(u.title, ''),
              v.visit_time,
              COALESCE(u.last_visit_time, v.visit_time)
            FROM visits v
            INNER JOIN urls u ON u.id = v.url
            WHERE v.visit_time > ?1 OR (v.visit_time = ?1 AND v.id > ?2)
            ORDER BY v.visit_time ASC, v.id ASC
            LIMIT ?3
            "#
        }
        BrowserHistoryKind::Firefox => {
            r#"
            SELECT
              v.id,
              p.url,
              COALESCE(p.title, ''),
              v.visit_date,
              COALESCE(p.last_visit_date, v.visit_date)
            FROM moz_historyvisits v
            INNER JOIN moz_places p ON p.id = v.place_id
            WHERE v.visit_date > ?1 OR (v.visit_date = ?1 AND v.id > ?2)
            ORDER BY v.visit_date ASC, v.id ASC
            LIMIT ?3
            "#
        }
    };

    let mut statement = connection.prepare(query)?;
    let rows = statement.query_map(
        params![since_visit_time_raw, since_visit_id, limit.max(1)],
        |row| {
            Ok(BrowserHistoryRow {
                source_visit_id: row.get(0)?,
                url: row.get(1)?,
                title: row.get(2)?,
                visited_at_raw: row.get::<_, i64>(3)?,
                last_visit_at_raw: row.get::<_, i64>(4)?,
            })
        },
    )?;

    rows.collect::<Result<Vec<_>, _>>()
        .with_context(|| format!("read browser history rows from {:?}", history_path))
}

fn history_time_to_unix_ms(kind: BrowserHistoryKind, raw: i64) -> i64 {
    match kind {
        BrowserHistoryKind::Chromium => chromium_time_to_unix_ms(raw),
        BrowserHistoryKind::Firefox => firefox_time_to_unix_ms(raw),
    }
}

fn unix_ms_to_history_time(kind: BrowserHistoryKind, raw: i64) -> i64 {
    match kind {
        BrowserHistoryKind::Chromium => unix_ms_to_chromium_time(raw),
        BrowserHistoryKind::Firefox => unix_ms_to_firefox_time(raw),
    }
}

fn chromium_time_to_unix_ms(raw: i64) -> i64 {
    if raw <= 0 {
        return 0;
    }

    if raw > 10_000_000_000_000 {
        return raw / 1_000 - CHROMIUM_EPOCH_OFFSET_MS;
    }

    raw
}

fn firefox_time_to_unix_ms(raw: i64) -> i64 {
    if raw <= 0 {
        return 0;
    }

    raw / 1_000
}

fn unix_ms_to_chromium_time(raw: i64) -> i64 {
    if raw <= 0 {
        return 0;
    }

    (raw + CHROMIUM_EPOCH_OFFSET_MS) * 1_000
}

fn unix_ms_to_firefox_time(raw: i64) -> i64 {
    if raw <= 0 {
        return 0;
    }

    raw * 1_000
}

pub fn redact_url_query(url: &str) -> String {
    let Some((head, _)) = url.split_once('?') else {
        return url.split('#').next().unwrap_or(url).to_string();
    };

    head.split('#').next().unwrap_or(head).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn create_temp_chromium_history_db() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let temp_dir = std::env::temp_dir().join(format!("act-track-ai-md-chromium-test-{unique}"));
        std::fs::create_dir_all(&temp_dir).expect("temp dir");
        let history_path = temp_dir.join("History");
        let connection = Connection::open(&history_path).expect("open temp history db");
        connection
            .execute_batch(
                r#"
                CREATE TABLE urls (
                  id INTEGER PRIMARY KEY,
                  url TEXT NOT NULL,
                  title TEXT,
                  visit_count INTEGER DEFAULT 0,
                  typed_count INTEGER DEFAULT 0,
                  last_visit_time INTEGER DEFAULT 0,
                  hidden INTEGER DEFAULT 0
                );
                CREATE TABLE visits (
                  id INTEGER PRIMARY KEY,
                  url INTEGER NOT NULL,
                  visit_time INTEGER NOT NULL
                );
                "#,
            )
            .expect("create schema");

        connection
            .execute(
                "INSERT INTO urls (id, url, title, last_visit_time) VALUES (?1, ?2, ?3, ?4)",
                params![
                    1i64,
                    "https://example.com/path?q=1",
                    "Example",
                    unix_ms_to_chromium_time(1_700_000_010_000)
                ],
            )
            .expect("insert url");
        connection
            .execute(
                "INSERT INTO visits (id, url, visit_time) VALUES (?1, ?2, ?3)",
                params![42i64, 1i64, unix_ms_to_chromium_time(1_700_000_000_000)],
            )
            .expect("insert visit");

        drop(connection);
        history_path
    }

    fn create_temp_firefox_history_db() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let temp_dir = std::env::temp_dir().join(format!("act-track-ai-md-firefox-test-{unique}"));
        std::fs::create_dir_all(&temp_dir).expect("temp dir");
        let history_path = temp_dir.join("places.sqlite");
        let connection = Connection::open(&history_path).expect("open temp firefox history db");
        connection
            .execute_batch(
                r#"
                CREATE TABLE moz_places (
                  id INTEGER PRIMARY KEY,
                  url TEXT NOT NULL,
                  title TEXT,
                  last_visit_date INTEGER
                );
                CREATE TABLE moz_historyvisits (
                  id INTEGER PRIMARY KEY,
                  place_id INTEGER NOT NULL,
                  visit_date INTEGER NOT NULL
                );
                "#,
            )
            .expect("create firefox schema");

        connection
            .execute(
                "INSERT INTO moz_places (id, url, title, last_visit_date) VALUES (?1, ?2, ?3, ?4)",
                params![
                    1i64,
                    "https://example.org/path?q=2",
                    "Firefox Example",
                    1_700_000_010_000_000i64
                ],
            )
            .expect("insert firefox place");
        connection
            .execute(
                "INSERT INTO moz_historyvisits (id, place_id, visit_date) VALUES (?1, ?2, ?3)",
                params![99i64, 1i64, 1_700_000_000_000_000i64],
            )
            .expect("insert firefox visit");

        drop(connection);
        history_path
    }

    #[test]
    fn converts_chromium_time_to_unix_ms() {
        assert_eq!(
            chromium_time_to_unix_ms(unix_ms_to_chromium_time(1_700_000_000_000)),
            1_700_000_000_000
        );
    }

    #[test]
    fn converts_firefox_time_to_unix_ms() {
        assert_eq!(
            firefox_time_to_unix_ms(1_700_000_000_000_000),
            1_700_000_000_000
        );
    }

    #[test]
    fn redacts_query_and_fragment_from_urls() {
        assert_eq!(
            redact_url_query("https://example.com/path?q=1#section"),
            "https://example.com/path"
        );
    }

    #[test]
    fn reads_history_rows_from_chromium_schema() {
        let history_path = create_temp_chromium_history_db();

        let rows = read_history_rows(
            BrowserHistoryKind::Chromium,
            &history_path,
            unix_ms_to_chromium_time(1_699_999_999_000),
            0,
            10,
        )
        .expect("read rows");

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].source_visit_id, 42);
        assert_eq!(rows[0].url, "https://example.com/path?q=1");
        assert_eq!(rows[0].title, "Example");
        assert_eq!(
            history_time_to_unix_ms(BrowserHistoryKind::Chromium, rows[0].visited_at_raw),
            1_700_000_000_000
        );
    }

    #[test]
    fn reads_history_rows_from_firefox_schema() {
        let history_path = create_temp_firefox_history_db();

        let rows = read_history_rows(
            BrowserHistoryKind::Firefox,
            &history_path,
            unix_ms_to_firefox_time(1_699_999_999_000),
            0,
            10,
        )
        .expect("read rows");

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].source_visit_id, 99);
        assert_eq!(rows[0].url, "https://example.org/path?q=2");
        assert_eq!(rows[0].title, "Firefox Example");
        assert_eq!(
            history_time_to_unix_ms(BrowserHistoryKind::Firefox, rows[0].visited_at_raw),
            1_700_000_000_000
        );
    }
}
