use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, RwLock,
};
use std::thread;
use std::time::Duration;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::app_meta::PACKAGE_NAME;
use crate::db::{ActivityInsert, Datastores};
use crate::markdown;
use crate::memory::MemoryStore;
use crate::secrets::{gemini_api_key_configured, load_gemini_api_key, save_gemini_api_key, SystemGeminiKeyStore};
use crate::settings::{parse_classification_rules, AppSettings, ClassificationRule};
use crate::summarizer;
use crate::tracker;
use crate::types::{
    ActivityCategory, ActivitySample, DailySummary, MemoryRecord, MemoryStatus, TopApp, TrackingState,
    ClassificationResult,
};

const TRACKING_ENABLED_SETTING_KEY: &str = "trackingEnabled";
const TRACKING_STATUS_EVENT: &str = "tracking-status";

#[derive(Clone)]
pub struct AppState {
    pub datastores: Arc<Mutex<Datastores>>,
    pub memory_store: Arc<Mutex<MemoryStore>>,
    pub tracking_enabled: Arc<AtomicBool>,
    pub classification_rules: Arc<RwLock<Vec<ClassificationRule>>>,
    pub self_process_name: String,
}

impl AppState {
    pub fn new(
        datastores: Datastores,
        memory_store: MemoryStore,
        self_process_name: String,
        tracking_enabled: bool,
        classification_rules: Vec<ClassificationRule>,
    ) -> Self {
        Self {
            datastores: Arc::new(Mutex::new(datastores)),
            memory_store: Arc::new(Mutex::new(memory_store)),
            tracking_enabled: Arc::new(AtomicBool::new(tracking_enabled)),
            classification_rules: Arc::new(RwLock::new(classification_rules)),
            self_process_name,
        }
    }

    pub fn update_classification_rules(&self, raw_rules: &str) {
        if let Ok(mut rules) = self.classification_rules.write() {
            *rules = parse_classification_rules(Some(raw_rules));
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TodaySummary {
    #[serde(rename = "trackedMs")]
    pub tracked_ms: i64,
    #[serde(rename = "productiveMs")]
    pub productive_ms: i64,
    #[serde(rename = "distractionMs")]
    pub distraction_ms: i64,
    #[serde(rename = "neutralMs")]
    pub neutral_ms: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SettingInput {
    pub key: String,
    pub value: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsUpdate {
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
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SaveSummaryFeedbackInput {
    pub date: String,
    #[serde(rename = "editedSummary")]
    pub edited_summary: String,
    #[serde(rename = "originalSummary")]
    pub original_summary: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PinMemoryInput {
    pub id: i64,
    pub pinned: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TrackingStatus {
    pub running: bool,
    pub state: TrackingState,
}

pub fn create_app_state(
    datastores: Datastores,
    memory_store: MemoryStore,
    tracking_enabled: bool,
    classification_rules: Vec<ClassificationRule>,
) -> anyhow::Result<AppState> {
    let self_process_name = std::env::current_exe()
        .ok()
        .and_then(|path| path.file_name().map(|name| name.to_string_lossy().to_lowercase()))
        .unwrap_or_else(|| PACKAGE_NAME.to_string());

    Ok(AppState::new(
        datastores,
        memory_store,
        self_process_name,
        tracking_enabled,
        classification_rules,
    ))
}

pub fn start_background_loop(app: AppHandle, state: Arc<AppState>) {
    thread::spawn(move || {
        let mut previous_sample: Option<PreviousSample> = None;
        let mut last_seen_day = current_day_string();
        let mut notifier = NotifierPolicy::default();

        loop {
            let settings = {
                let datastores = state.datastores.lock().expect("datastores lock");
                load_app_settings(|key| datastores.get_setting(key), false)
            };
            let poll_ms = settings.poll_interval_ms.max(1) as u64;
            let tracking_enabled = state.tracking_enabled.load(Ordering::Relaxed);

            if tracking_enabled {
                let snapshot = tracker::get_foreground_window(Some(&state.self_process_name));
                if let Some(snapshot) = snapshot {
                    let idle_ms = tracker::get_idle_ms();
                    if !tracker::is_idle(idle_ms, settings.idle_timeout_ms) {
                        let timestamp = Utc::now().timestamp_millis();
                        let api_key = active_api_key();
                        let classification = classify_snapshot(&state, &api_key, &snapshot.process_name, &snapshot.window_title);

                        if let Some(previous) = previous_sample.as_mut() {
                            if previous.process_name != snapshot.process_name
                                || previous.window_title != snapshot.window_title
                            {
                                let duration_ms = (timestamp - previous.timestamp).max(0);
                                if let Ok(datastores) = state.datastores.lock() {
                                    datastores.set_activity_duration(previous.id, duration_ms);
                                }
                            }
                        }

                        let id = {
                            let datastores = state.datastores.lock().expect("datastores lock");
                            datastores.insert_activity_sample(ActivityInsert {
                                timestamp,
                                process_name: snapshot.process_name.clone(),
                                window_title: snapshot.window_title.clone(),
                                category: classification.category,
                                label: classification.label.clone(),
                            })
                        };

                        previous_sample = Some(PreviousSample {
                            id,
                            timestamp,
                            process_name: snapshot.process_name.clone(),
                            window_title: snapshot.window_title.clone(),
                        });

                        let state_after_sample = if classification.category == ActivityCategory::Distraction {
                            TrackingState::Distracted
                        } else if classification.category == ActivityCategory::Unknown {
                            TrackingState::Idle
                        } else {
                            TrackingState::Productive
                        };

                        notifier.on_sample(
                            &app,
                            &settings,
                            &classification.category,
                            &snapshot.process_name,
                            &snapshot.window_title,
                            state_after_sample,
                        );
                    }
                }
            } else {
                previous_sample = None;
                notifier.reset();
            }

            let today = current_day_string();
            if today != last_seen_day {
                let previous_day = previous_day_string(&today);
                let _ = run_daily_export(&state, &previous_day);
                last_seen_day = today;
            }

            thread::sleep(Duration::from_millis(poll_ms));
        }
    });
}

#[tauri::command]
pub fn get_today_summary(state: State<'_, Arc<AppState>>) -> Result<TodaySummary, String> {
    let today = current_day_string();
    let datastores = state.datastores.lock().map_err(|error| error.to_string())?;
    let (tracked_ms, productive_ms, distraction_ms, neutral_ms) = datastores.get_stats_for_day(&today);

    Ok(TodaySummary {
        tracked_ms,
        productive_ms,
        distraction_ms,
        neutral_ms,
    })
}

#[tauri::command]
pub fn get_top_apps(state: State<'_, Arc<AppState>>) -> Result<Vec<TopApp>, String> {
    let today = current_day_string();
    let datastores = state.datastores.lock().map_err(|error| error.to_string())?;
    Ok(datastores.get_top_apps_for_day(&today, 10))
}

#[tauri::command]
pub fn get_timeline(date: String, state: State<'_, Arc<AppState>>) -> Result<Vec<ActivitySample>, String> {
    let (start, end) = Datastores::get_day_bounds(&date);
    let datastores = state.datastores.lock().map_err(|error| error.to_string())?;
    Ok(datastores.get_activity_range(start, end))
}

#[tauri::command]
pub fn get_daily_summary(date: String, state: State<'_, Arc<AppState>>) -> Result<Option<DailySummary>, String> {
    let datastores = state.datastores.lock().map_err(|error| error.to_string())?;
    Ok(datastores.get_daily_summary(&date))
}

#[tauri::command]
pub fn get_settings(state: State<'_, Arc<AppState>>) -> Result<AppSettings, String> {
    let datastores = state.datastores.lock().map_err(|error| error.to_string())?;
    let configured = gemini_api_key_configured(&SystemGeminiKeyStore).unwrap_or(false);
    Ok(load_app_settings(|key| datastores.get_setting(key), configured))
}

#[tauri::command]
pub fn get_tracking_status(state: State<'_, Arc<AppState>>) -> Result<TrackingStatus, String> {
    let running = state.tracking_enabled.load(Ordering::Relaxed);
    Ok(TrackingStatus {
        running,
        state: tracking_state_from_running(running),
    })
}

#[tauri::command]
pub fn set_setting(input: SettingInput, app: AppHandle, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    apply_setting_change(&app, &state, &input.key, &input.value)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SettingsUpdateInput {
    pub settings: SettingsUpdate,
    #[serde(rename = "geminiApiKey")]
    pub gemini_api_key: Option<String>,
}

#[tauri::command]
pub fn set_settings(input: SettingsUpdateInput, app: AppHandle, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    persist_settings(&state, &input.settings).map_err(|error| error.to_string())?;

    state.update_classification_rules(&input.settings.classification_rules_json);
    apply_autostart(&app, input.settings.auto_start)?;

    if let Some(gemini_api_key) = input.gemini_api_key.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        save_gemini_api_key(&SystemGeminiKeyStore, gemini_api_key).map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn get_setting(key: String, state: State<'_, Arc<AppState>>) -> Result<Option<String>, String> {
    if key == "geminiApiKey" {
        return Ok(None);
    }

    let datastores = state.datastores.lock().map_err(|error| error.to_string())?;
    Ok(datastores.get_setting(&key))
}

#[tauri::command]
pub fn generate_summary_now(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let today = current_day_string();
    let mut datastores = state.datastores.lock().map_err(|error| error.to_string())?;
    let memory_store = state.memory_store.lock().map_err(|error| error.to_string())?;
    let api_key = active_api_key();
    let summary = summarizer::generate_daily_summary(&mut datastores, &api_key, Some(&memory_store), &today)?;
    let _ = markdown::export_day(&datastores, &today);
    let _ = summary;
    Ok(())
}

#[tauri::command]
pub fn save_summary_feedback(input: SaveSummaryFeedbackInput, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let mut datastores = state.datastores.lock().map_err(|error| error.to_string())?;
    let memory_store = state.memory_store.lock().map_err(|error| error.to_string())?;
    summarizer::save_summary_feedback(
        &mut datastores,
        Some(&memory_store),
        &input.date,
        &input.edited_summary,
        input.original_summary.as_deref(),
    );
    Ok(())
}

#[tauri::command]
pub fn get_memory_status(state: State<'_, Arc<AppState>>) -> Result<MemoryStatus, String> {
    let memory_store = state.memory_store.lock().map_err(|error| error.to_string())?;
    Ok(memory_store.get_status())
}

#[tauri::command]
pub fn list_memories(limit: Option<usize>, state: State<'_, Arc<AppState>>) -> Result<Vec<MemoryRecord>, String> {
    let memory_store = state.memory_store.lock().map_err(|error| error.to_string())?;
    Ok(memory_store.recall(limit.unwrap_or(20)))
}

#[tauri::command]
pub fn forget_memory(id: i64, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let memory_store = state.memory_store.lock().map_err(|error| error.to_string())?;
    memory_store.forget(id);
    Ok(())
}

#[tauri::command]
pub fn pin_memory(input: PinMemoryInput, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let memory_store = state.memory_store.lock().map_err(|error| error.to_string())?;
    memory_store.pin(input.id, input.pinned);
    Ok(())
}

#[tauri::command]
pub fn toggle_tracking(app: AppHandle, state: State<'_, Arc<AppState>>) -> Result<bool, String> {
    let current = state.tracking_enabled.load(Ordering::Relaxed);
    let enabled = !current;
    set_tracking_enabled(&app, &state, enabled)
}

fn run_daily_export(state: &Arc<AppState>, date: &str) -> Result<(), String> {
    let mut datastores = state.datastores.lock().map_err(|error| error.to_string())?;
    let memory_store = state.memory_store.lock().map_err(|error| error.to_string())?;
    let api_key = active_api_key();
    let _ = summarizer::generate_daily_summary(&mut datastores, &api_key, Some(&memory_store), date)?;
    let _ = markdown::export_day(&datastores, date);
    Ok(())
}

fn active_api_key() -> String {
    load_gemini_api_key(&SystemGeminiKeyStore)
        .ok()
        .flatten()
        .unwrap_or_default()
}

fn current_day_string() -> String {
    Utc::now().date_naive().format("%Y-%m-%d").to_string()
}

fn previous_day_string(today: &str) -> String {
    let date = chrono::NaiveDate::parse_from_str(today, "%Y-%m-%d").unwrap_or_else(|_| Utc::now().date_naive());
    (date - chrono::Days::new(1)).format("%Y-%m-%d").to_string()
}

fn apply_autostart(app: &AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;

    let manager = app.autolaunch();
    if enabled {
        manager.enable().map_err(|error| error.to_string())?;
    } else {
        manager.disable().map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn load_tracking_enabled(datastores: &Datastores) -> bool {
    parse_bool_setting(datastores.get_setting(TRACKING_ENABLED_SETTING_KEY).as_deref(), true)
}

pub fn emit_tracking_status(app: &AppHandle, running: bool) {
    let _ = app.emit(
        TRACKING_STATUS_EVENT,
        TrackingStatus {
            running,
            state: tracking_state_from_running(running),
        },
    );
}

pub(crate) fn set_tracking_enabled(
    app: &AppHandle,
    state: &State<'_, Arc<AppState>>,
    enabled: bool,
) -> Result<bool, String> {
    set_tracking_enabled_inner(app, &**state, enabled)
}

pub(crate) fn set_tracking_enabled_on_state(
    app: &AppHandle,
    state: &AppState,
    enabled: bool,
) -> Result<bool, String> {
    set_tracking_enabled_inner(app, state, enabled)
}

fn set_tracking_enabled_inner(
    app: &AppHandle,
    state: &AppState,
    enabled: bool,
) -> Result<bool, String> {
    {
        let datastores = state.datastores.lock().map_err(|error| error.to_string())?;
        datastores.set_setting(TRACKING_ENABLED_SETTING_KEY, if enabled { "true" } else { "false" });
    }

    state.tracking_enabled.store(enabled, Ordering::Relaxed);
    emit_tracking_status(app, enabled);
    Ok(enabled)
}

fn persist_settings(state: &State<'_, Arc<AppState>>, settings: &SettingsUpdate) -> Result<(), anyhow::Error> {
    let datastores = state.datastores.lock().map_err(|error| anyhow::anyhow!(error.to_string()))?;
    datastores.set_setting("pollIntervalMs", &settings.poll_interval_ms.to_string());
    datastores.set_setting("idleTimeoutMs", &settings.idle_timeout_ms.to_string());
    datastores.set_setting("notificationCooldownMs", &settings.notification_cooldown_ms.to_string());
    datastores.set_setting("gracePeriodMs", &settings.grace_period_ms.to_string());
    datastores.set_setting("markdownExportPath", &settings.markdown_export_path);
    datastores.set_setting(
        "notificationsEnabled",
        if settings.notifications_enabled { "true" } else { "false" },
    );
    datastores.set_setting("autoStart", if settings.auto_start { "true" } else { "false" });
    datastores.set_setting("classificationRulesJson", &settings.classification_rules_json);
    datastores.set_setting("summaryLanguage", &settings.summary_language);
    datastores.set_setting("summaryTone", &settings.summary_tone);
    datastores.set_setting(
        "markdownPrivacyMode",
        if settings.markdown_privacy_mode { "true" } else { "false" },
    );
    datastores.set_setting(
        "startInBackground",
        if settings.start_in_background { "true" } else { "false" },
    );
    Ok(())
}

fn apply_setting_change(app: &AppHandle, state: &State<'_, Arc<AppState>>, key: &str, value: &str) -> Result<(), String> {
    if key == "geminiApiKey" {
        save_gemini_api_key(&SystemGeminiKeyStore, value).map_err(|error| error.to_string())?;
        return Ok(());
    }

    if key == TRACKING_ENABLED_SETTING_KEY {
        let enabled = parse_bool_setting(Some(value), true);
        let _ = set_tracking_enabled(app, state, enabled)?;
        return Ok(());
    }

    {
        let datastores = state.datastores.lock().map_err(|error| error.to_string())?;
        datastores.set_setting(key, value);
    }

    if key == "classificationRulesJson" {
        state.update_classification_rules(value);
    } else if key == "autoStart" {
        apply_autostart(app, value == "true")?;
    }

    Ok(())
}

fn tracking_state_from_running(running: bool) -> TrackingState {
    if running {
        TrackingState::Idle
    } else {
        TrackingState::Paused
    }
}

fn classify_snapshot(
    state: &AppState,
    api_key: &str,
    process_name: &str,
    window_title: &str,
) -> ClassificationResult {
    let truncated_title = window_title.chars().take(200).collect::<String>();

    // Keep the database lock out of the Gemini request path.
    if let Some(rule) = state
        .classification_rules
        .read()
        .ok()
        .and_then(|rules| crate::classifier::find_matching_rule(&rules, process_name, window_title))
    {
        return ClassificationResult {
            category: rule.category,
            label: rule.label,
            confidence: 1.0,
            source: "rule".to_string(),
        };
    }

    if let Ok(datastores) = state.datastores.lock() {
        if let Some(cached) = datastores.get_cached_classification(process_name, &truncated_title) {
            return ClassificationResult {
                category: cached.category,
                label: cached.label,
                confidence: cached.confidence,
                source: "cache".to_string(),
            };
        }
    }

    match crate::gemini::classify_with_gemini(api_key, process_name, window_title) {
        Ok(result) => {
            if let Ok(datastores) = state.datastores.lock() {
                datastores.upsert_cached_classification(
                    process_name,
                    &truncated_title,
                    result.category,
                    &result.label,
                    result.confidence,
                );
            }
            result
        }
        Err(_) => ClassificationResult {
            category: ActivityCategory::Unknown,
            label: "Uncategorized".to_string(),
            confidence: 0.0,
            source: "fallback".to_string(),
        },
    }
}

fn parse_bool_setting(value: Option<&str>, fallback: bool) -> bool {
    match value {
        Some("true") => true,
        Some("false") => false,
        Some(_) => fallback,
        None => fallback,
    }
}

struct PreviousSample {
    id: i64,
    timestamp: i64,
    process_name: String,
    window_title: String,
}

#[derive(Default)]
struct NotifierPolicy {
    distraction_started_at: Option<i64>,
    last_notified_at: Option<i64>,
}

impl NotifierPolicy {
    fn reset(&mut self) {
        *self = Self::default();
    }

    fn on_sample(
        &mut self,
        app: &AppHandle,
        settings: &AppSettings,
        category: &ActivityCategory,
        process_name: &str,
        _window_title: &str,
        state: TrackingState,
    ) {
        if !settings.notifications_enabled {
            return;
        }

        if category != &ActivityCategory::Distraction {
            self.distraction_started_at = None;
            return;
        }

        let now = Utc::now().timestamp_millis();
        if self.distraction_started_at.is_none() {
            self.distraction_started_at = Some(now);
        }
        let started_at = self.distraction_started_at.unwrap_or(now);
        let elapsed = now - started_at;
        if elapsed < settings.grace_period_ms {
            return;
        }

        if let Some(last_notified_at) = self.last_notified_at {
            if now - last_notified_at < settings.notification_cooldown_ms {
                return;
            }
        }

        use tauri_plugin_notification::NotificationExt;
        let _ = app
            .notification()
            .builder()
            .title("Kembali Fokus!")
            .body(&format!("{process_name} terlalu lama. Waktunya balik kerja!"))
            .show();

        self.last_notified_at = Some(now);

        let _ = state;
    }
}
pub use crate::settings::load_app_settings;
