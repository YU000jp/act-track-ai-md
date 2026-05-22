use std::path::PathBuf;

use anyhow::Context;
use chrono::{Local, Timelike, Utc};

use crate::db::Datastores;
use crate::summarizer::format_ai_summary_for_markdown;

pub fn resolve_markdown_export_directory(configured_path: Option<&str>) -> PathBuf {
    let home_dir = directories::BaseDirs::new()
        .map(|dirs| dirs.home_dir().to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    let base_path = configured_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir.join("act-track-logs"));

    if base_path.is_absolute() {
        base_path
    } else {
        home_dir.join(base_path)
    }
}

pub fn export_day(
    datastores: &Datastores,
    date: &str,
    configured_path: &str,
    hide_window_titles: bool,
    stored_summary: Option<&crate::types::DailySummary>,
) -> anyhow::Result<(PathBuf, String)> {
    let output_directory = resolve_markdown_export_directory(Some(configured_path));
    std::fs::create_dir_all(&output_directory)
        .with_context(|| format!("create {:?}", output_directory))?;

    let day_snapshot = datastores.get_day_activity_snapshot(date)?;
    let mut summary = day_snapshot.summary;
    let activity = day_snapshot.activity;
    if let Some(stored_summary) = stored_summary {
        // Export callers that just generated the summary already know the AI text.
        summary.ai_summary = stored_summary.ai_summary.clone();
    } else if let Some(ai_summary) = datastores.get_daily_summary_ai_summary(date)? {
        // Fallback stays lightweight: pull only the persisted AI summary, not the full row.
        summary.ai_summary = Some(ai_summary);
    }

    let categories: Vec<String> = summary
        .top_apps
        .iter()
        .map(|app| app.category.as_str().to_string())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();
    let labels: Vec<String> = activity
        .iter()
        .map(|sample| sample.label.clone())
        .filter(|label| !label.is_empty())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();
    let tags: Vec<String> = categories
        .iter()
        .map(|value| to_tag(value))
        .chain(labels.iter().map(|value| to_tag(value)))
        .filter(|tag| !tag.is_empty())
        .collect();

    let mut lines = vec![
        format!("# Activity Log: {date}"),
        String::new(),
        if categories.is_empty() {
            "Categories: none".to_string()
        } else {
            format!("Categories: {}", categories.join(", "))
        },
        if tags.is_empty() {
            "Tags: none".to_string()
        } else {
            format!("Tags: {}", tags.join(" "))
        },
        String::new(),
        "## Stats".to_string(),
        format!(
            "- Total tracked: {}",
            format_duration(summary.total_tracked_ms)
        ),
        format!("- Productive: {}", format_duration(summary.productive_ms)),
        format!("- Distraction: {}", format_duration(summary.distraction_ms)),
        format!("- Neutral: {}", format_duration(summary.neutral_ms)),
        String::new(),
        format_ai_summary_for_markdown(summary.ai_summary.as_deref()),
        "## Activity Log".to_string(),
        String::new(),
        "| Time | App | Window | Category | Label | Duration |".to_string(),
        "| --- | --- | --- | --- | --- | --- |".to_string(),
    ];

    for sample in activity {
        let window_title = if hide_window_titles {
            "[hidden]".to_string()
        } else {
            escape_cell(&sample.window_title)
        };
        lines.push(format!(
            "| {} | {} | {} | {} | {} | {} |",
            format_timestamp(sample.timestamp),
            escape_cell(&sample.process_name),
            window_title,
            sample.category.as_str(),
            escape_cell(&sample.label),
            format_duration(sample.duration_ms),
        ));
    }

    let markdown = lines
        .join("\n")
        .replace("\n\n\n", "\n\n")
        .trim_end()
        .to_string()
        + "\n";
    let output_path = output_directory.join(format!("{date}.md"));
    std::fs::write(&output_path, markdown.as_bytes())?;

    Ok((output_path, markdown))
}

fn format_duration(ms: i64) -> String {
    let total_minutes = ms.max(0) / 60_000;
    let hours = total_minutes / 60;
    let minutes = total_minutes % 60;
    format!("{hours}h {minutes}m")
}

fn format_timestamp(ms: i64) -> String {
    let dt = chrono::DateTime::<Utc>::from_timestamp_millis(ms)
        .map(|dt| dt.with_timezone(&Local))
        .unwrap_or_else(Local::now);
    format!("{:02}:{:02}", dt.hour(), dt.minute())
}

fn escape_cell(value: &str) -> String {
    value.replace(['\r', '\n'], " ").replace('|', "\\|")
}

fn to_tag(value: &str) -> String {
    let trimmed = value.trim().to_lowercase();
    let dashed: String = trimmed
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect();
    let normalized = dashed.trim_matches('-').to_string();
    if normalized.is_empty() {
        String::new()
    } else {
        format!("#{}", normalized)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{ActivityInsert, Datastores};
    use crate::summarizer;
    use crate::types::{ActivityCategory, DailySummary};
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn create_test_datastores() -> (Datastores, PathBuf) {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let base_dir = std::env::temp_dir().join(format!("act-track-ai-md-markdown-test-{unique}"));
        std::fs::create_dir_all(&base_dir).expect("create temp dir");
        let cache_path = base_dir.join("cache.db");
        let activity_path = base_dir.join("activity.db");
        let datastores = Datastores::open(&cache_path, &activity_path).expect("open datastores");

        (datastores, base_dir)
    }

    fn seed_activity_sample(
        datastores: &Datastores,
        timestamp: i64,
        process_name: &str,
        window_title: &str,
        category: ActivityCategory,
        label: &str,
        duration_ms: i64,
    ) -> i64 {
        let id = datastores
            .insert_activity_sample(ActivityInsert {
                timestamp,
                process_name: process_name.to_string(),
                window_title: window_title.to_string(),
                category,
                label: label.to_string(),
            })
            .expect("insert activity sample");
        datastores
            .set_activity_duration(id, duration_ms)
            .expect("set duration");
        id
    }

    fn sample_date() -> &'static str {
        "2026-05-19"
    }

    #[test]
    fn resolve_export_directory_falls_back_to_home_based_default() {
        let home_dir = directories::BaseDirs::new()
            .map(|dirs| dirs.home_dir().to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."));

        assert_eq!(
            resolve_markdown_export_directory(None),
            home_dir.join("act-track-logs")
        );
        assert_eq!(
            resolve_markdown_export_directory(Some("   ")),
            home_dir.join("act-track-logs")
        );
    }

    #[test]
    fn resolve_export_directory_keeps_relative_paths_under_home() {
        let home_dir = directories::BaseDirs::new()
            .map(|dirs| dirs.home_dir().to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."));
        let resolved = resolve_markdown_export_directory(Some("exports/daily"));

        assert_eq!(resolved, home_dir.join("exports/daily"));
    }

    #[test]
    fn resolve_export_directory_preserves_absolute_paths() {
        let absolute = if cfg!(windows) {
            PathBuf::from(r"C:\tmp\act-track-markdown")
        } else {
            PathBuf::from("/tmp/act-track-markdown")
        };

        assert_eq!(
            resolve_markdown_export_directory(Some(absolute.to_str().expect("absolute path"))),
            absolute
        );
    }

    #[test]
    fn to_tag_normalizes_labels() {
        assert_eq!(to_tag("  Productive Work  "), "#productive-work");
        assert_eq!(to_tag("++"), String::new());
    }

    #[test]
    fn escape_cell_replaces_newlines_and_pipes() {
        assert_eq!(escape_cell("line1\r\nline2|x"), "line1  line2\\|x");
    }

    #[test]
    fn export_day_writes_expected_markdown_shape() {
        let (datastores, temp_dir) = create_test_datastores();
        let day_start = Datastores::get_day_bounds(sample_date()).0;
        seed_activity_sample(
            &datastores,
            day_start + 61_000,
            "code",
            "main.rs | VSCode",
            ActivityCategory::Productive,
            "Coding",
            61_000,
        );

        let report = summarizer::generate_daily_summary(
            "test_export_day_writes_expected_markdown_shape",
            &datastores,
            "",
            None,
            sample_date(),
            "Japanese",
            "encouraging",
        )
        .expect("generate summary");
        let stored_summary = DailySummary {
            ai_summary: Some("Daily AI summary".to_string()),
            ..report.summary.clone()
        };
        let export_dir = temp_dir.join("exports");
        let export_dir_string = export_dir.to_string_lossy().to_string();

        let (output_path, markdown) = export_day(
            &datastores,
            sample_date(),
            &export_dir_string,
            true,
            Some(&stored_summary),
        )
        .expect("export markdown");

        assert_eq!(
            output_path,
            export_dir.join(format!("{}.md", sample_date()))
        );
        assert_eq!(
            std::fs::read_to_string(&output_path).expect("read markdown"),
            markdown
        );
        assert!(markdown.contains("# Activity Log: 2026-05-19"));
        assert!(markdown.contains("Categories: productive"));
        assert!(markdown.contains("Tags: #productive #coding"));
        assert!(markdown.contains("## Stats"));
        assert!(markdown.contains("- Total tracked: 0h 1m"));
        assert!(markdown.contains("## AI Summary"));
        assert!(markdown.contains("Daily AI summary"));
        assert!(markdown.contains("## Activity Log"));
        assert!(markdown.contains("| Time | App | Window | Category | Label | Duration |"));

        let row = markdown
            .lines()
            .find(|line| line.contains("code") && line.contains("[hidden]"))
            .expect("table row");
        let cells = row
            .split('|')
            .map(str::trim)
            .filter(|cell| !cell.is_empty())
            .collect::<Vec<_>>();

        assert_eq!(cells.len(), 6);
        assert_eq!(
            cells[1..],
            ["code", "[hidden]", "productive", "Coding", "0h 1m"]
        );

        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn export_day_honors_privacy_mode_in_table_rows() {
        let (datastores, temp_dir) = create_test_datastores();
        let day_start = Datastores::get_day_bounds(sample_date()).0;
        seed_activity_sample(
            &datastores,
            day_start + 120_000,
            "browser",
            "Secret | Window",
            ActivityCategory::Neutral,
            "Browsing",
            120_000,
        );

        let export_dir = temp_dir.join("private");
        let export_dir_string = export_dir.to_string_lossy().to_string();
        let (_, markdown) = export_day(&datastores, sample_date(), &export_dir_string, true, None)
            .expect("export markdown");

        let row = markdown
            .lines()
            .find(|line| line.contains("browser") && line.contains("[hidden]"))
            .expect("private table row");
        let cells = row
            .split('|')
            .map(str::trim)
            .filter(|cell| !cell.is_empty())
            .collect::<Vec<_>>();

        assert_eq!(cells[2], "[hidden]");
        assert_eq!(cells[4], "Browsing");

        let _ = std::fs::remove_dir_all(temp_dir);
    }
}
