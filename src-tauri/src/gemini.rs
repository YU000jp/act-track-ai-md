use serde_json::json;

use crate::http::blocking_client;
use crate::types::{ActivityCategory, ClassificationResult};

const VALID_CATEGORIES: [&str; 3] = ["productive", "distraction", "neutral"];

pub fn build_classification_prompt(process_name: &str, window_title: &str) -> (String, String) {
    let system = "You are a productivity classifier. Given a process name and window title, classify the activity. Respond with JSON only: { \"category\": \"productive\" | \"distraction\" | \"neutral\", \"label\": string, \"confidence\": number }".to_string();
    let user = format!("Process: {process_name}\nWindow Title: {window_title}");
    (system, user)
}

pub fn parse_classification_response(raw: &str) -> Result<ClassificationResult, String> {
    let cleaned = raw.trim().trim_start_matches("```json").trim_start_matches("```").trim_end_matches("```").trim();
    let parsed: serde_json::Value = serde_json::from_str(cleaned)
        .map_err(|_| format!("Invalid JSON response: {raw}"))?;

    let obj = parsed
        .as_object()
        .ok_or_else(|| "Response is not an object".to_string())?;

    let category = obj.get("category").and_then(|value| value.as_str()).ok_or_else(|| {
        "Missing category".to_string()
    })?;
    if !VALID_CATEGORIES.contains(&category) {
        return Err(format!("Invalid category: {category}"));
    }

    let label = obj
        .get("label")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|label| !label.is_empty())
        .ok_or_else(|| "Missing or empty label".to_string())?;

    let confidence = obj.get("confidence").and_then(|value| value.as_f64()).unwrap_or(1.0);

    Ok(ClassificationResult {
        category: match category {
            "productive" => ActivityCategory::Productive,
            "distraction" => ActivityCategory::Distraction,
            _ => ActivityCategory::Neutral,
        },
        label: label.to_string(),
        confidence,
        source: "gemini".to_string(),
    })
}

pub fn classify_with_gemini(
    api_key: &str,
    process_name: &str,
    window_title: &str,
) -> Result<ClassificationResult, String> {
    if api_key.trim().is_empty() {
        return Err("missing api key".to_string());
    }

    let (system, user) = build_classification_prompt(process_name, window_title);
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={api_key}"
    );
    let body = json!({
        "contents": [{ "parts": [{ "text": user }] }],
        "systemInstruction": { "parts": [{ "text": system }] }
    });

    let response = blocking_client()
        .post(url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .map_err(|error| error.to_string())?;

    if !response.status().is_success() {
        return Err(format!("Gemini API error: {}", response.status()));
    }

    let data: serde_json::Value = response.json().map_err(|error| error.to_string())?;
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
        .ok_or_else(|| "No candidates in Gemini response".to_string())?;

    let mut result = parse_classification_response(text)?;
    result.source = "gemini".to_string();
    Ok(result)
}
