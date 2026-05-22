use std::collections::HashMap;

use serde_json::json;

use crate::db::Datastores;
use crate::error::{AppError, AppResult};
use crate::http::blocking_client;
use crate::memory::{MemorySearchResult, MemoryStore};
use crate::types::{DailySummary, TopApp};

const SUMMARY_MEMORY_SEARCH_LIMIT: usize = 4;
const SUMMARY_MEMORY_PATTERN_LIMIT: usize = 2;
const SUMMARY_MEMORY_CONTEXT_LIMIT: usize = 2;
const SUMMARY_TOP_APP_LIMIT: usize = 3;
const SUMMARY_MAX_OUTPUT_TOKENS: i64 = 128;

pub fn format_ai_summary_for_markdown(ai_summary: Option<&str>) -> String {
    match ai_summary {
        Some(summary) if !summary.trim().is_empty() => format!("## AI Summary\n\n{summary}\n"),
        _ => String::new(),
    }
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryGenerationReport {
    pub summary: DailySummary,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ai_summary_error: Option<AppError>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub markdown_export_error: Option<AppError>,
}

pub fn generate_daily_summary(
    command: &'static str,
    datastores: &Datastores,
    api_key: &str,
    memory_store: Option<&MemoryStore>,
    date: &str,
    summary_language: &str,
    summary_tone: &str,
) -> AppResult<SummaryGenerationReport> {
    let day_snapshot = datastores
        .get_day_activity_snapshot(date)
        .map_err(|error| {
            AppError::database_for(
                command,
                format!("read day activity snapshot for {date}: {error}"),
            )
        })?;
    let summary = day_snapshot.summary;
    let total_tracked_ms = summary.total_tracked_ms;
    let productive_ms = summary.productive_ms;
    let distraction_ms = summary.distraction_ms;
    let neutral_ms = summary.neutral_ms;
    let top_apps = summary.top_apps.clone();
    let api_key = api_key.trim();

    let memory_context = collect_memory_context(
        memory_store,
        date,
        &top_apps,
        &summary_language,
        &summary_tone,
    );
    let mut ai_summary = None;
    let mut ai_summary_error = None;
    if !api_key.is_empty() && total_tracked_ms > 0 {
        let prompt = build_summary_user_prompt(
            date,
            total_tracked_ms,
            productive_ms,
            distraction_ms,
            neutral_ms,
            &top_apps,
            &summary_language,
            &summary_tone,
        );
        let system_instruction =
            build_summary_system_instruction(&summary_language, &summary_tone, &memory_context);
        match call_gemini_for_summary(command, &prompt, &system_instruction, api_key) {
            Ok(summary) => ai_summary = Some(summary),
            Err(error) => ai_summary_error = Some(error),
        }
    }

    let summary = DailySummary {
        date: date.to_string(),
        total_tracked_ms,
        productive_ms,
        distraction_ms,
        neutral_ms,
        top_apps: top_apps.clone(),
        ai_summary: ai_summary.clone(),
    };

    datastores.save_daily_summary(&summary).map_err(|error| {
        AppError::database_for(command, format!("save daily summary for {date}: {error}"))
    })?;

    if let Some(memory_store) = memory_store {
        let top_app_names = summary
            .top_apps
            .iter()
            .map(|app| app.process_name.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        let mut context_metadata = HashMap::new();
        context_metadata.insert("date".to_string(), date.to_string());
        context_metadata.insert("summaryLanguage".to_string(), summary_language.to_string());
        context_metadata.insert("summaryTone".to_string(), summary_tone.to_string());
        memory_store.save(
            "context",
            &format!(
                "Daily summary context for {date}: apps={}, trackedMs={}",
                if top_app_names.is_empty() {
                    "none"
                } else {
                    &top_app_names
                },
                summary.total_tracked_ms
            ),
            &context_metadata,
            false,
        );

        if let Some(ref ai_summary) = summary.ai_summary {
            let mut metadata = HashMap::new();
            metadata.insert("date".to_string(), date.to_string());
            metadata.insert("source".to_string(), "gemini-summary".to_string());
            memory_store.save("pattern", ai_summary, &metadata, false);
        }
    }

    Ok(SummaryGenerationReport {
        summary,
        ai_summary_error,
        markdown_export_error: None,
    })
}

pub fn save_summary_feedback(
    command: &'static str,
    datastores: &mut Datastores,
    memory_store: Option<&MemoryStore>,
    date: &str,
    edited_summary: &str,
    original_summary: Option<&str>,
) -> AppResult<()> {
    let edited = edited_summary.trim();
    if edited.is_empty() {
        return Ok(());
    }

    // Feedback needs the stored totals/top apps to preserve the existing summary shape.
    let Some(existing) = datastores.get_daily_summary(date).map_err(|error| {
        AppError::database_for(
            command,
            format!("read summary for feedback {date}: {error}"),
        )
    })?
    else {
        return Ok(());
    };

    let existing_ai_summary = existing.ai_summary.clone();
    datastores
        .update_daily_summary_ai_summary(date, Some(edited))
        .map_err(|error| {
            AppError::database_for(
                command,
                format!("update summary feedback for {date}: {error}"),
            )
        })?;

    if let Some(memory_store) = memory_store {
        let mut feedback_metadata = HashMap::new();
        feedback_metadata.insert("date".to_string(), date.to_string());
        if let Some(original) = original_summary.or(existing_ai_summary.as_deref()) {
            feedback_metadata.insert("originalSummary".to_string(), original.to_string());
        }
        memory_store.save("feedback", edited, &feedback_metadata, false);

        let mut pattern_metadata = HashMap::new();
        pattern_metadata.insert("date".to_string(), date.to_string());
        pattern_metadata.insert("source".to_string(), "user-feedback".to_string());
        memory_store.save("pattern", edited, &pattern_metadata, false);
    }

    Ok(())
}

fn collect_memory_context(
    memory_store: Option<&MemoryStore>,
    date: &str,
    top_apps: &[TopApp],
    summary_language: &str,
    summary_tone: &str,
) -> MemoryContext {
    let Some(memory_store) = memory_store else {
        return MemoryContext::default();
    };

    let query = format!(
        "{date} {summary_language} {summary_tone} {}",
        top_apps
            .iter()
            .map(|app| app.process_name.as_str())
            .collect::<Vec<_>>()
            .join(" ")
    );

    let results: Vec<MemorySearchResult> = memory_store.search(&query, SUMMARY_MEMORY_SEARCH_LIMIT);
    let mut patterns = Vec::new();
    let mut contexts = Vec::new();

    for result in results {
        let memory_type = result.record.memory_type.as_str();
        if memory_type == "pattern" || memory_type == "feedback" {
            patterns.push(result.record.content);
        } else {
            contexts.push(result.record.content);
        }
    }

    MemoryContext {
        patterns: patterns
            .into_iter()
            .take(SUMMARY_MEMORY_PATTERN_LIMIT)
            .collect(),
        contexts: contexts
            .into_iter()
            .take(SUMMARY_MEMORY_CONTEXT_LIMIT)
            .collect(),
    }
}

fn build_summary_user_prompt(
    date: &str,
    total_tracked_ms: i64,
    productive_ms: i64,
    distraction_ms: i64,
    neutral_ms: i64,
    top_apps: &[TopApp],
    summary_language: &str,
    summary_tone: &str,
) -> String {
    let app_list = if top_apps.is_empty() {
        "No apps tracked".to_string()
    } else {
        top_apps
            .iter()
            .take(SUMMARY_TOP_APP_LIMIT)
            .map(format_top_app_summary)
            .collect::<Vec<_>>()
            .join("\n")
    };

    format!(
        "Summarize my productivity for {date}.\n\nTotal tracked: {}\nProductive: {}\nDistraction: {}\nNeutral: {}\n\nTop apps:\n{app_list}\n\nWrite a brief 2-3 sentence summary in {summary_language}.\nTone: {summary_tone}.\nFocus on what went well and one area to improve.",
        format_ms(total_tracked_ms),
        format_ms(productive_ms),
        format_ms(distraction_ms),
        format_ms(neutral_ms),
    )
}

fn build_summary_system_instruction(
    summary_language: &str,
    summary_tone: &str,
    memory_context: &MemoryContext,
) -> String {
    let style_hints = format_memory_list(&memory_context.patterns);
    let context_hints = format_memory_list(&memory_context.contexts);

    format!(
        "You are a productivity coach. Provide brief daily summaries in {summary_language} with a {summary_tone} tone.\nUse these preferred markdown style patterns when relevant:\n{style_hints}\nRelevant past context:\n{context_hints}"
    )
}

fn format_memory_list(items: &[String]) -> String {
    if items.is_empty() {
        "- none".to_string()
    } else {
        items
            .iter()
            .map(|item| format!("- {item}"))
            .collect::<Vec<_>>()
            .join("\n")
    }
}

fn format_top_app_summary(app: &TopApp) -> String {
    format!(
        "- {}: {} ({})",
        app.process_name,
        format_ms(app.duration_ms),
        app.category.as_str()
    )
}

fn call_gemini_for_summary(
    command: &'static str,
    prompt: &str,
    system_instruction: &str,
    api_key: &str,
) -> Result<String, AppError> {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={api_key}"
    );
    let response = blocking_client()
        .post(url)
        .header("Content-Type", "application/json")
        .json(&json!({
            "contents": [{ "parts": [{ "text": prompt }] }],
            "systemInstruction": { "parts": [{ "text": system_instruction }] },
            "generationConfig": {
                "maxOutputTokens": SUMMARY_MAX_OUTPUT_TOKENS
            }
        }))
        .send()
        .map_err(|error| {
            AppError::external_api_for(command, format!("send Gemini request: {error}"))
        })?;

    if !response.status().is_success() {
        return Err(AppError::external_api_for(
            command,
            format!("Gemini API error: {}", response.status()),
        ));
    }

    let data: serde_json::Value = response.json().map_err(|error| {
        AppError::external_api_for(command, format!("decode Gemini response: {error}"))
    })?;
    let text = data
        .get("candidates")
        .and_then(|value| value.as_array())
        .and_then(|items| items.first())
        .and_then(|candidate| candidate.get("content"))
        .and_then(|content| content.get("parts"))
        .and_then(|parts| parts.as_array())
        .and_then(|parts| parts.first())
        .and_then(|part| part.get("text"))
        .and_then(|text| text.as_str())
        .ok_or_else(|| AppError::external_api_for(command, "No candidates in Gemini response"))?;

    Ok(text.to_string())
}

fn format_ms(ms: i64) -> String {
    let hours = ms.max(0) / 3_600_000;
    let minutes = (ms.max(0) % 3_600_000) / 60_000;
    format!("{hours}h {minutes}m")
}

#[derive(Default)]
struct MemoryContext {
    patterns: Vec<String>,
    contexts: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{ActivityCategory, TopApp};

    fn sample_top_app(process_name: &str, duration_ms: i64, category: ActivityCategory) -> TopApp {
        TopApp {
            process_name: process_name.to_string(),
            duration_ms,
            category,
        }
    }

    #[test]
    fn summary_user_prompt_limits_top_apps_and_omits_memory_context() {
        let prompt = build_summary_user_prompt(
            "2026-05-19",
            7_200_000,
            3_600_000,
            2_400_000,
            1_200_000,
            &[
                sample_top_app("alpha", 5_400_000, ActivityCategory::Productive),
                sample_top_app("beta", 3_000_000, ActivityCategory::Distraction),
                sample_top_app("gamma", 1_800_000, ActivityCategory::Neutral),
                sample_top_app("delta", 600_000, ActivityCategory::Productive),
            ],
            "Japanese",
            "calm",
        );

        assert!(prompt.contains("alpha"));
        assert!(prompt.contains("beta"));
        assert!(prompt.contains("gamma"));
        assert!(!prompt.contains("delta"));
        assert!(!prompt.contains("Preferred markdown style patterns from my history"));
        assert!(!prompt.contains("Relevant past context from my history"));
    }

    #[test]
    fn summary_system_instruction_includes_memory_context_once() {
        let memory_context = MemoryContext {
            patterns: vec!["Use concise markdown bullets".to_string()],
            contexts: vec!["Recent work focused on docs".to_string()],
        };

        let instruction = build_summary_system_instruction("Japanese", "calm", &memory_context);

        assert!(instruction.contains("Use concise markdown bullets"));
        assert!(instruction.contains("Recent work focused on docs"));
        assert!(!instruction.contains("Top apps:"));
    }
}
