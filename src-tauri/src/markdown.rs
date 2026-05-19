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
) -> anyhow::Result<(PathBuf, String)> {
    let output_directory = resolve_markdown_export_directory(Some(configured_path));
    std::fs::create_dir_all(&output_directory)
        .with_context(|| format!("create {:?}", output_directory))?;

    let (start, end) = Datastores::get_day_bounds(date);
    let activity = datastores.get_activity_range(start, end)?;
    let summary = match datastores.get_daily_summary(date)? {
        Some(summary) => summary,
        None => {
            let (total, productive, distraction, neutral) = datastores.get_stats_for_day(date)?;
            let top_apps = datastores.get_top_apps_for_day(date, 10)?;
            crate::types::DailySummary {
                date: date.to_string(),
                total_tracked_ms: total,
                productive_ms: productive,
                distraction_ms: distraction,
                neutral_ms: neutral,
                top_apps,
                ai_summary: None,
            }
        }
    };

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
