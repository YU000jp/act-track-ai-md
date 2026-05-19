use std::collections::HashMap;

use serde_json::json;

use crate::db::Datastores;
use crate::error::{AppError, AppResult};
use crate::http::blocking_client;
use crate::memory::{MemorySearchResult, MemoryStore};
use crate::types::{DailySummary, TopApp};

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
}

pub fn generate_daily_summary(
    command: &'static str,
    datastores: &mut Datastores,
    api_key: &str,
    memory_store: Option<&MemoryStore>,
    date: &str,
) -> AppResult<SummaryGenerationReport> {
    let (total_tracked_ms, productive_ms, distraction_ms, neutral_ms) =
        datastores.get_stats_for_day(date).map_err(|error| {
            AppError::database_for(command, format!("read summary stats for {date}: {error}"))
        })?;
    let top_apps = datastores.get_top_apps_for_day(date, 10).map_err(|error| {
        AppError::database_for(command, format!("read top apps for {date}: {error}"))
    })?;
    let summary_language = datastores
        .get_setting("summaryLanguage")
        .map_err(|error| {
            AppError::settings_for(command, format!("read summary language: {error}"))
        })?
        .unwrap_or_else(|| "Japanese".to_string());
    let summary_tone = datastores
        .get_setting("summaryTone")
        .map_err(|error| AppError::settings_for(command, format!("read summary tone: {error}")))?
        .unwrap_or_else(|| "encouraging".to_string());
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
        let prompt = build_summary_prompt(
            date,
            total_tracked_ms,
            productive_ms,
            distraction_ms,
            neutral_ms,
            &top_apps,
            &summary_language,
            &summary_tone,
            &memory_context,
        );
        match call_gemini_for_summary(
            command,
            &prompt,
            api_key,
            &summary_language,
            &summary_tone,
            &memory_context,
        ) {
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
        context_metadata.insert("summaryLanguage".to_string(), summary_language.clone());
        context_metadata.insert("summaryTone".to_string(), summary_tone.clone());
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
        .save_daily_summary(&DailySummary {
            ai_summary: Some(edited.to_string()),
            ..existing
        })
        .map_err(|error| {
            AppError::database_for(
                command,
                format!("save summary feedback for {date}: {error}"),
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

    let results: Vec<MemorySearchResult> = memory_store.search(&query, 6);
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
        patterns: patterns.into_iter().take(3).collect(),
        contexts: contexts.into_iter().take(3).collect(),
    }
}

fn build_summary_prompt(
    date: &str,
    total_tracked_ms: i64,
    productive_ms: i64,
    distraction_ms: i64,
    neutral_ms: i64,
    top_apps: &[TopApp],
    summary_language: &str,
    summary_tone: &str,
    memory_context: &MemoryContext,
) -> String {
    let app_list = if top_apps.is_empty() {
        "No apps tracked".to_string()
    } else {
        top_apps
            .iter()
            .map(|app| {
                format!(
                    "- {}: {} ({})",
                    app.process_name,
                    format_ms(app.duration_ms),
                    app.category.as_str()
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    };
    let style_hints = if memory_context.patterns.is_empty() {
        "- none".to_string()
    } else {
        memory_context
            .patterns
            .iter()
            .map(|pattern| format!("- {pattern}"))
            .collect::<Vec<_>>()
            .join("\n")
    };
    let context_hints = if memory_context.contexts.is_empty() {
        "- none".to_string()
    } else {
        memory_context
            .contexts
            .iter()
            .map(|context| format!("- {context}"))
            .collect::<Vec<_>>()
            .join("\n")
    };

    format!(
        "Summarize my productivity for {date}.\n\nTotal tracked: {}\nProductive: {}\nDistraction: {}\nNeutral: {}\n\nTop apps:\n{app_list}\n\nPreferred markdown style patterns from my history:\n{style_hints}\n\nRelevant past context from my history:\n{context_hints}\n\nWrite a brief 2-3 sentence summary in {summary_language}.\nTone: {summary_tone}.\nFocus on what went well and one area to improve.",
        format_ms(total_tracked_ms),
        format_ms(productive_ms),
        format_ms(distraction_ms),
        format_ms(neutral_ms),
    )
}

fn call_gemini_for_summary(
    command: &'static str,
    prompt: &str,
    api_key: &str,
    summary_language: &str,
    summary_tone: &str,
    memory_context: &MemoryContext,
) -> Result<String, AppError> {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={api_key}"
    );
    let response = blocking_client()
        .post(url)
        .header("Content-Type", "application/json")
        .json(&json!({
            "contents": [{ "parts": [{ "text": prompt }] }],
            "systemInstruction": {
                "parts": [{
                    "text": format!(
                        "You are a productivity coach. Provide brief daily summaries in {summary_language} with a {summary_tone} tone.\nWhen available, follow these preferred markdown style patterns:\n{}\nRelevant past context:\n{}",
                        if memory_context.patterns.is_empty() { "- none".to_string() } else { memory_context.patterns.join("\n") },
                        if memory_context.contexts.is_empty() { "- none".to_string() } else { memory_context.contexts.join("\n") },
                    )
                }]
            }
        }))
        .send()
        .map_err(|error| AppError::external_api_for(command, format!("send Gemini request: {error}")))?;

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
