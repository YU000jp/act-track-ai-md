use std::fs::OpenOptions;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::PathBuf;

use anyhow::Context;
use serde::{Deserialize, Serialize};

const PROJECT_QUALIFIER: &str = "com";
const PROJECT_ORGANIZATION: &str = "irdan";
const PROJECT_NAME: &str = "act-track-ai-md";
const INBOX_FILE_NAME: &str = "browser-native-inbox.jsonl";
const CURSOR_FILE_NAME: &str = "browser-native-inbox.cursor";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeBrowserVisitInput {
    pub browser: String,
    pub profile: Option<String>,
    pub url: String,
    pub title: Option<String>,
    pub visited_at: Option<i64>,
    pub last_visit_at: Option<i64>,
    pub source: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeBrowserVisitRecord {
    pub event_id: String,
    pub browser: String,
    pub profile: String,
    pub url: String,
    pub title: String,
    pub visited_at: i64,
    pub last_visit_at: i64,
    pub source: String,
}

#[derive(Clone, Debug)]
pub struct BrowserNativeInboxPaths {
    pub inbox_path: PathBuf,
    pub cursor_path: PathBuf,
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub struct NativeInboxRead {
    pub records: Vec<NativeBrowserVisitRecord>,
    pub next_cursor: u64,
}

pub fn browser_native_inbox_paths() -> anyhow::Result<BrowserNativeInboxPaths> {
    let project_dirs = directories::ProjectDirs::from(
        PROJECT_QUALIFIER,
        PROJECT_ORGANIZATION,
        PROJECT_NAME,
    )
    .ok_or_else(|| anyhow::anyhow!("unable to resolve browser native inbox paths"))?;
    let data_dir = project_dirs.data_local_dir();
    Ok(BrowserNativeInboxPaths {
        inbox_path: data_dir.join(INBOX_FILE_NAME),
        cursor_path: data_dir.join(CURSOR_FILE_NAME),
    })
}

pub fn normalize_native_browser_visit(input: NativeBrowserVisitInput) -> NativeBrowserVisitRecord {
    let visited_at = input.visited_at.unwrap_or_else(now_unix_ms);
    let last_visit_at = input.last_visit_at.unwrap_or(visited_at);
    let profile = input.profile.unwrap_or_else(|| "default".to_string());
    let source = input
        .source
        .unwrap_or_else(|| "native-messaging".to_string());
    let title = input.title.unwrap_or_default();
    let event_id = stable_visit_key(&input.browser, &profile, &input.url, &title, visited_at, last_visit_at, &source);

    NativeBrowserVisitRecord {
        event_id,
        browser: input.browser,
        profile,
        url: input.url,
        title,
        visited_at,
        last_visit_at,
        source,
    }
}

#[allow(dead_code)]
pub fn append_native_browser_visit(record: &NativeBrowserVisitRecord) -> anyhow::Result<()> {
    let paths = browser_native_inbox_paths()?;
    if let Some(parent) = paths.inbox_path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("create browser native inbox directory at {:?}", parent))?;
    }

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&paths.inbox_path)
        .with_context(|| format!("open browser native inbox at {:?}", paths.inbox_path))?;
    let line = serde_json::to_string(record).context("serialize native browser visit record")?;
    file.write_all(line.as_bytes())
        .context("append native browser visit record")?;
    file.write_all(b"\n")
        .context("append native browser visit newline")?;
    file.flush().context("flush native browser visit record")?;
    Ok(())
}

#[allow(dead_code)]
pub fn load_native_browser_inbox_cursor() -> anyhow::Result<u64> {
    let paths = browser_native_inbox_paths()?;
    let Ok(raw) = std::fs::read_to_string(&paths.cursor_path) else {
        return Ok(0);
    };

    Ok(raw.trim().parse::<u64>().unwrap_or(0))
}

#[allow(dead_code)]
pub fn save_native_browser_inbox_cursor(cursor: u64) -> anyhow::Result<()> {
    let paths = browser_native_inbox_paths()?;
    if let Some(parent) = paths.cursor_path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("create browser native cursor directory at {:?}", parent))?;
    }

    std::fs::write(&paths.cursor_path, cursor.to_string())
        .with_context(|| format!("write browser native cursor at {:?}", paths.cursor_path))?;
    Ok(())
}

#[allow(dead_code)]
pub fn read_native_browser_visits_from_cursor(cursor: u64) -> anyhow::Result<NativeInboxRead> {
    let paths = browser_native_inbox_paths()?;
    let Ok(metadata) = std::fs::metadata(&paths.inbox_path) else {
        return Ok(NativeInboxRead {
            records: Vec::new(),
            next_cursor: cursor,
        });
    };

    let file_len = metadata.len();
    let start_cursor = cursor.min(file_len);
    if file_len == start_cursor {
        return Ok(NativeInboxRead {
            records: Vec::new(),
            next_cursor: start_cursor,
        });
    }

    let mut file = OpenOptions::new()
        .read(true)
        .open(&paths.inbox_path)
        .with_context(|| format!("open browser native inbox at {:?}", paths.inbox_path))?;
    file.seek(SeekFrom::Start(start_cursor))
        .context("seek browser native inbox")?;

    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer)
        .context("read browser native inbox")?;

    let text = String::from_utf8(buffer).context("decode browser native inbox as UTF-8")?;
    let mut records = Vec::new();
    let mut consumed = 0u64;

    for segment in text.split_inclusive('\n') {
        if !segment.ends_with('\n') {
            break;
        }

        consumed += segment.len() as u64;
        let line = segment.trim_end_matches(['\n', '\r']);
        if line.trim().is_empty() {
            continue;
        }

        if let Ok(record) = serde_json::from_str::<NativeBrowserVisitRecord>(line) {
            records.push(record);
        }
    }

    Ok(NativeInboxRead {
        records,
        next_cursor: start_cursor + consumed,
    })
}

#[allow(dead_code)]
pub fn read_native_message(reader: &mut impl Read) -> anyhow::Result<Option<serde_json::Value>> {
    let mut length_buf = [0u8; 4];
    match reader.read_exact(&mut length_buf) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => {
            return Ok(None);
        }
        Err(error) => return Err(error).context("read native message length"),
    }

    let length = u32::from_le_bytes(length_buf) as usize;
    if length == 0 {
        return Ok(Some(serde_json::Value::Null));
    }

    let mut payload = vec![0u8; length];
    reader
        .read_exact(&mut payload)
        .context("read native message payload")?;
    let message = serde_json::from_slice(&payload).context("parse native message payload")?;
    Ok(Some(message))
}

#[allow(dead_code)]
pub fn write_native_message(writer: &mut impl Write, value: &serde_json::Value) -> anyhow::Result<()> {
    let payload = serde_json::to_vec(value).context("serialize native message response")?;
    let length = u32::try_from(payload.len()).context("native message too large")?;
    writer
        .write_all(&length.to_le_bytes())
        .context("write native message length")?;
    writer
        .write_all(&payload)
        .context("write native message payload")?;
    writer.flush().context("flush native message response")?;
    Ok(())
}

pub fn stable_visit_key(
    browser: &str,
    profile: &str,
    url: &str,
    title: &str,
    visited_at: i64,
    last_visit_at: i64,
    source: &str,
) -> String {
    let canonical = format!(
        "{browser}|{profile}|{url}|{title}|{visited_at}|{last_visit_at}|{source}"
    );
    format!("{:016x}", fnv1a64(canonical.as_bytes()))
}

pub fn stable_visit_id(key: &str) -> i64 {
    (fnv1a64(key.as_bytes()) & i64::MAX as u64) as i64
}

fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn now_unix_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn stable_visit_key_is_deterministic() {
        let first = stable_visit_key("firefox", "default", "https://example.com", "Example", 1, 1, "native-messaging");
        let second = stable_visit_key("firefox", "default", "https://example.com", "Example", 1, 1, "native-messaging");
        assert_eq!(first, second);
    }

    #[test]
    fn stable_visit_id_is_non_negative() {
        let id = stable_visit_id("example");
        assert!(id >= 0);
    }

    #[test]
    fn normalizes_native_visit_input() {
        let record = normalize_native_browser_visit(NativeBrowserVisitInput {
            browser: "firefox".to_string(),
            profile: None,
            url: "https://example.com".to_string(),
            title: None,
            visited_at: Some(1_700_000_000_000),
            last_visit_at: None,
            source: None,
        });

        assert_eq!(record.browser, "firefox");
        assert_eq!(record.profile, "default");
        assert_eq!(record.source, "native-messaging");
        assert_eq!(record.visited_at, 1_700_000_000_000);
        assert_eq!(record.last_visit_at, 1_700_000_000_000);
        assert!(!record.event_id.is_empty());
    }

    #[test]
    fn inbox_paths_share_a_stable_base() {
        let paths = browser_native_inbox_paths().expect("paths");
        assert!(paths.inbox_path.ends_with(PathBuf::from(INBOX_FILE_NAME)));
        assert!(paths.cursor_path.ends_with(PathBuf::from(CURSOR_FILE_NAME)));
    }
}
