use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivityCategory {
    Productive,
    Distraction,
    Neutral,
    Unknown,
}

impl ActivityCategory {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Productive => "productive",
            Self::Distraction => "distraction",
            Self::Neutral => "neutral",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClassificationRuleScope {
    Process,
    Title,
    Both,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassificationRuleDraft {
    pub process_name_pattern: String,
    pub window_title_pattern: String,
    pub category: ActivityCategory,
    pub label: String,
    pub enabled: bool,
    pub scope: ClassificationRuleScope,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassificationRuleRecord {
    pub id: i64,
    pub priority: i64,
    pub process_name_pattern: String,
    pub window_title_pattern: String,
    pub category: ActivityCategory,
    pub label: String,
    pub enabled: bool,
    pub scope: ClassificationRuleScope,
    pub source: String,
    pub hit_count: i64,
    pub last_used_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassificationResult {
    pub category: ActivityCategory,
    pub label: String,
    pub confidence: f64,
    pub source: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowSnapshot {
    pub process_name: String,
    pub window_title: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserVisit {
    pub browser: String,
    pub profile: String,
    pub url: String,
    pub title: String,
    pub visited_at: i64,
    pub last_visit_at: i64,
    pub source: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivityLogSource {
    Foreground,
    Browser,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityLogEntry {
    pub id: String,
    pub timestamp: i64,
    pub source: ActivityLogSource,
    pub origin: String,
    pub app_name: String,
    pub title: String,
    pub category: ActivityCategory,
    pub label: String,
    pub duration_ms: Option<i64>,
    pub browser: Option<String>,
    pub profile: Option<String>,
    pub url: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityLogQuery {
    pub date: String,
    pub source: Option<ActivityLogSource>,
    pub app: Option<String>,
    pub category: Option<ActivityCategory>,
    pub browser: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySample {
    pub id: i64,
    pub timestamp: i64,
    pub process_name: String,
    pub window_title: String,
    pub duration_ms: i64,
    pub category: ActivityCategory,
    pub label: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailySummary {
    pub date: String,
    pub total_tracked_ms: i64,
    pub productive_ms: i64,
    pub distraction_ms: i64,
    pub neutral_ms: i64,
    pub top_apps: Vec<TopApp>,
    pub ai_summary: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatisticsDaySummary {
    pub date: String,
    pub tracked_ms: i64,
    pub productive_ms: i64,
    pub distraction_ms: i64,
    pub neutral_ms: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatisticsSnapshot {
    pub range_days: i64,
    pub start_date: String,
    pub end_date: String,
    pub tracked_ms: i64,
    pub productive_ms: i64,
    pub distraction_ms: i64,
    pub neutral_ms: i64,
    pub active_days: i64,
    pub daily_breakdown: Vec<StatisticsDaySummary>,
    pub top_apps: Vec<TopApp>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopApp {
    pub process_name: String,
    pub duration_ms: i64,
    pub category: ActivityCategory,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MemoryStatus {
    pub enabled: bool,
    pub backend: String,
    pub total: usize,
    pub pinned: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySnapshot {
    pub memory_status: MemoryStatus,
    pub memory_records: Vec<MemoryRecord>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MemoryRecord {
    pub id: i64,
    #[serde(rename = "type")]
    pub memory_type: String,
    pub content: String,
    pub metadata: std::collections::HashMap<String, String>,
    pub pinned: bool,
    pub created_at: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrackingState {
    Productive,
    Distracted,
    Idle,
    Paused,
}

impl TrackingState {
    #[allow(dead_code)]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Productive => "productive",
            Self::Distracted => "distracted",
            Self::Idle => "idle",
            Self::Paused => "paused",
        }
    }
}
