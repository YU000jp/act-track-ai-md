use serde::{Deserialize, Serialize};
use crate::types::{ActivityCategory, ClassificationRuleScope};

pub use crate::types::ClassificationRuleDraft as ClassificationRule;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub gemini_api_key_configured: bool,
    pub dashboard_bootstrap_timeout_ms: i64,
    pub poll_interval_ms: i64,
    pub idle_timeout_ms: i64,
    pub notification_cooldown_ms: i64,
    pub grace_period_ms: i64,
    pub markdown_export_path: String,
    pub notifications_enabled: bool,
    pub auto_start: bool,
    pub classification_rules_json: String,
    pub summary_language: String,
    pub summary_tone: String,
    pub markdown_privacy_mode: bool,
    pub start_in_background: bool,
    pub browser_history_enabled: bool,
    pub browser_history_poll_interval_ms: i64,
    pub browser_history_redact_query: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            gemini_api_key_configured: false,
            dashboard_bootstrap_timeout_ms: 5000,
            poll_interval_ms: 3000,
            idle_timeout_ms: 300_000,
            notification_cooldown_ms: 300_000,
            grace_period_ms: 30_000,
            markdown_export_path: String::new(),
            notifications_enabled: true,
            auto_start: false,
            classification_rules_json: String::new(),
            summary_language: "Japanese".to_string(),
            summary_tone: "encouraging".to_string(),
            markdown_privacy_mode: false,
            start_in_background: true,
            browser_history_enabled: false,
            browser_history_poll_interval_ms: 15_000,
            browser_history_redact_query: true,
        }
    }
}

pub fn load_app_settings(
    mut get_setting: impl FnMut(&str) -> anyhow::Result<Option<String>>,
    gemini_api_key_configured: bool,
) -> anyhow::Result<AppSettings> {
    let defaults = AppSettings::default();

    Ok(AppSettings {
        gemini_api_key_configured,
        dashboard_bootstrap_timeout_ms: parse_number_setting(
            get_setting("dashboardBootstrapTimeoutMs")?,
            defaults.dashboard_bootstrap_timeout_ms,
            1000,
        ),
        poll_interval_ms: parse_number_setting(
            get_setting("pollIntervalMs")?,
            defaults.poll_interval_ms,
            1,
        ),
        idle_timeout_ms: parse_number_setting(
            get_setting("idleTimeoutMs")?,
            defaults.idle_timeout_ms,
            1,
        ),
        notification_cooldown_ms: parse_number_setting(
            get_setting("notificationCooldownMs")?,
            defaults.notification_cooldown_ms,
            0,
        ),
        grace_period_ms: parse_number_setting(
            get_setting("gracePeriodMs")?,
            defaults.grace_period_ms,
            0,
        ),
        markdown_export_path: get_setting("markdownExportPath")?
            .unwrap_or(defaults.markdown_export_path),
        notifications_enabled: parse_boolean_setting(
            get_setting("notificationsEnabled")?,
            defaults.notifications_enabled,
        ),
        auto_start: parse_boolean_setting(get_setting("autoStart")?, defaults.auto_start),
        classification_rules_json: get_setting("classificationRulesJson")?
            .unwrap_or(defaults.classification_rules_json),
        summary_language: get_setting("summaryLanguage")?.unwrap_or(defaults.summary_language),
        summary_tone: get_setting("summaryTone")?.unwrap_or(defaults.summary_tone),
        markdown_privacy_mode: parse_boolean_setting(
            get_setting("markdownPrivacyMode")?,
            defaults.markdown_privacy_mode,
        ),
        start_in_background: parse_boolean_setting(
            get_setting("startInBackground")?,
            defaults.start_in_background,
        ),
        browser_history_enabled: parse_boolean_setting(
            get_setting("browserHistoryEnabled")?,
            defaults.browser_history_enabled,
        ),
        browser_history_poll_interval_ms: parse_number_setting(
            get_setting("browserHistoryPollIntervalMs")?,
            defaults.browser_history_poll_interval_ms,
            1000,
        ),
        browser_history_redact_query: parse_boolean_setting(
            get_setting("browserHistoryRedactQuery")?,
            defaults.browser_history_redact_query,
        ),
    })
}

pub fn parse_classification_rules(raw: Option<&str>) -> Vec<ClassificationRule> {
    let Some(raw) = raw.map(str::trim).filter(|value| !value.is_empty()) else {
        return Vec::new();
    };

    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(raw) else {
        return Vec::new();
    };

    let Some(items) = parsed.as_array() else {
        return Vec::new();
    };

    let mut rules = Vec::new();
    for rule in items {
        let Some(obj) = rule.as_object() else {
            continue;
        };

        let process_name_pattern = obj
            .get("processNamePattern")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .unwrap_or("")
            .to_string();
        let window_title_pattern = obj
            .get("windowTitlePattern")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .unwrap_or("")
            .to_string();
        let Some(category) = obj.get("category").and_then(|value| value.as_str()) else {
            continue;
        };
        let label = obj
            .get("label")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .unwrap_or("")
            .to_string();
        let enabled = obj.get("enabled").and_then(|value| value.as_bool()).unwrap_or(true);
        let scope = parse_classification_rule_scope(
            obj.get("scope").and_then(|value| value.as_str()),
            &process_name_pattern,
            &window_title_pattern,
        );

        if process_name_pattern.is_empty() && window_title_pattern.is_empty() {
            continue;
        }

        if label.is_empty() {
            continue;
        }

        let category = match category {
            "productive" => ActivityCategory::Productive,
            "distraction" => ActivityCategory::Distraction,
            "neutral" => ActivityCategory::Neutral,
            _ => continue,
        };

        rules.push(ClassificationRule {
            process_name_pattern,
            window_title_pattern,
            category,
            label,
            enabled,
            scope,
        });
    }

    rules
}

pub fn serialize_classification_rules(rules: &[ClassificationRule]) -> String {
    serde_json::to_string(rules).unwrap_or_else(|_| "[]".to_string())
}

fn parse_boolean_setting(value: Option<String>, fallback: bool) -> bool {
    match value.as_deref() {
        Some("true") => true,
        Some("false") => false,
        Some(_) => fallback,
        None => fallback,
    }
}

fn parse_number_setting(value: Option<String>, fallback: i64, min_value: i64) -> i64 {
    let Some(raw) = value else {
        return fallback;
    };

    let Ok(parsed) = raw.parse::<i64>() else {
        return fallback;
    };

    if parsed < min_value {
        return fallback;
    }

    parsed
}

fn parse_classification_rule_scope(
    scope: Option<&str>,
    process_name_pattern: &str,
    window_title_pattern: &str,
) -> ClassificationRuleScope {
    match scope {
        Some("process") => ClassificationRuleScope::Process,
        Some("title") => ClassificationRuleScope::Title,
        Some("both") => ClassificationRuleScope::Both,
        _ if !process_name_pattern.is_empty() && !window_title_pattern.is_empty() => ClassificationRuleScope::Both,
        _ if !window_title_pattern.is_empty() => ClassificationRuleScope::Title,
        _ => ClassificationRuleScope::Process,
    }
}
