use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, RwLock,
};
use std::thread;
use std::time::Duration;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::app_meta::PACKAGE_NAME;
use crate::db::{ActivityInsert, Datastores};
use crate::error::{AppError, AppResult};
use crate::markdown;
use crate::memory::MemoryStore;
use crate::secrets::{
    save_gemini_api_key, GeminiKeyStore, SystemGeminiKeyStore,
};
use crate::settings::{parse_classification_rules, AppSettings, ClassificationRule};
use crate::summarizer;
use crate::tracker;
use crate::types::{
    ActivityCategory, ActivitySample, ClassificationResult, DailySummary, MemoryRecord,
    MemorySnapshot, MemoryStatus, StatisticsSnapshot, TopApp, TrackingState, WindowSnapshot,
};

const TRACKING_ENABLED_SETTING_KEY: &str = "trackingEnabled";
const TRACKING_STATUS_EVENT: &str = "tracking-status";
const GEMINI_API_KEY_SETTINGS_EVENT: &str = "gemini-api-key-settings-requested";

#[derive(Clone)]
pub struct AppState {
    pub datastores: Arc<Mutex<Datastores>>,
    pub memory_store: Arc<Mutex<MemoryStore>>,
    pub tracking_enabled: Arc<AtomicBool>,
    pub classification_rules: Arc<RwLock<Vec<ClassificationRule>>>,
    pub runtime_settings: Arc<RwLock<AppSettings>>,
    pub gemini_api_key: Arc<RwLock<Option<String>>>,
    pub gemini_api_key_prompt_lock: Arc<AtomicBool>,
    pub self_process_name: String,
}

impl AppState {
    pub fn new(
        datastores: Datastores,
        memory_store: MemoryStore,
        self_process_name: String,
        tracking_enabled: bool,
        classification_rules: Vec<ClassificationRule>,
        runtime_settings: AppSettings,
        gemini_api_key: Option<String>,
    ) -> Self {
        Self {
            datastores: Arc::new(Mutex::new(datastores)),
            memory_store: Arc::new(Mutex::new(memory_store)),
            tracking_enabled: Arc::new(AtomicBool::new(tracking_enabled)),
            classification_rules: Arc::new(RwLock::new(classification_rules)),
            runtime_settings: Arc::new(RwLock::new(runtime_settings)),
            gemini_api_key: Arc::new(RwLock::new(gemini_api_key)),
            gemini_api_key_prompt_lock: Arc::new(AtomicBool::new(false)),
            self_process_name,
        }
    }

    pub fn update_classification_rules(&self, raw_rules: &str) {
        if let Ok(mut rules) = self.classification_rules.write() {
            *rules = parse_classification_rules(Some(raw_rules));
        }
    }

    pub fn settings_snapshot(&self) -> AppSettings {
        self.runtime_settings
            .read()
            .map(|settings| settings.clone())
            .unwrap_or_default()
    }

    pub fn update_settings_snapshot(&self, next_settings: AppSettings) {
        if let Ok(mut settings) = self.runtime_settings.write() {
            *settings = next_settings;
        }
    }

    pub fn update_setting_snapshot(&self, key: &str, value: &str) {
        if let Ok(mut settings) = self.runtime_settings.write() {
            apply_setting_to_snapshot(&mut settings, key, value);
        }
    }

    pub fn set_gemini_api_key(&self, value: Option<String>) {
        let configured = value.is_some();

        if let Ok(mut cached_key) = self.gemini_api_key.write() {
            *cached_key = value;
        }

        if let Ok(mut settings) = self.runtime_settings.write() {
            settings.gemini_api_key_configured = configured;
        }
    }

    pub fn active_api_key(&self) -> String {
        self.gemini_api_key
            .read()
            .map(|value| value.clone().unwrap_or_default())
            .unwrap_or_default()
    }

    fn try_lock_gemini_api_key_prompt(&self) -> bool {
        self.gemini_api_key_prompt_lock
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }

    fn unlock_gemini_api_key_prompt(&self) {
        self.gemini_api_key_prompt_lock.store(false, Ordering::Release);
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
#[serde(rename_all = "camelCase")]
pub struct StatisticsSnapshotInput {
    pub range_days: Option<i64>,
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

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardBootstrapSnapshot {
    pub today_summary: TodaySummary,
    pub top_apps: Vec<TopApp>,
    pub statistics_snapshot: StatisticsSnapshot,
    pub settings: AppSettings,
    pub tracking_status: TrackingStatus,
    pub daily_summary: Option<DailySummary>,
    pub memory_status: MemoryStatus,
    pub memory_records: Vec<MemoryRecord>,
}

pub fn create_app_state(
    datastores: Datastores,
    memory_store: MemoryStore,
    tracking_enabled: bool,
    classification_rules: Vec<ClassificationRule>,
    runtime_settings: AppSettings,
    gemini_api_key: Option<String>,
) -> anyhow::Result<AppState> {
    let self_process_name = std::env::current_exe()
        .ok()
        .and_then(|path| {
            path.file_name()
                .map(|name| name.to_string_lossy().to_lowercase())
        })
        .unwrap_or_else(|| PACKAGE_NAME.to_string());

    Ok(AppState::new(
        datastores,
        memory_store,
        self_process_name,
        tracking_enabled,
        classification_rules,
        runtime_settings,
        gemini_api_key,
    ))
}

fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        window.show().ok();
        window.set_focus().ok();
    }
}

fn fallback_unknown_classification() -> ClassificationResult {
    ClassificationResult {
        category: ActivityCategory::Unknown,
        label: "Uncategorized".to_string(),
        confidence: 0.0,
        source: "fallback".to_string(),
    }
}

fn prompt_for_gemini_api_key_settings(app: &AppHandle, state: &AppState) {
    if !state.try_lock_gemini_api_key_prompt() {
        return;
    }

    focus_main_window(app);

    if let Err(error) = app.emit(GEMINI_API_KEY_SETTINGS_EVENT, ()) {
        log::warn!("failed to emit Gemini API key settings event: {error}");
    }
}

fn save_gemini_api_key_and_release_prompt_lock(
    command: &'static str,
    state: &AppState,
    store: &dyn GeminiKeyStore,
    value: &str,
) -> AppResult<bool> {
    let saved = save_gemini_api_key(store, value).map_err(|error| {
        AppError::keyring_for(command, format!("save Gemini API key: {error}"))
    })?;

    if saved {
        state.unlock_gemini_api_key_prompt();
    }

    Ok(saved)
}

pub fn start_background_loop(app: AppHandle, state: Arc<AppState>) {
    thread::spawn(move || {
        let mut previous_sample: Option<PreviousSample> = None;
        let mut last_seen_day = current_day_string();
        let mut notifier = NotifierPolicy::default();

        loop {
            let now = Utc::now().timestamp_millis();
            let today = current_day_string();
            let day_changed = today != last_seen_day;
            let day_start = if day_changed {
                day_start_timestamp(&today)
            } else {
                now
            };

            let settings = state.settings_snapshot();
            let poll_ms = settings.poll_interval_ms.max(1) as u64;
            let tracking_enabled = state.tracking_enabled.load(Ordering::Relaxed);

            if tracking_enabled {
                let snapshot = tracker::get_foreground_window(Some(&state.self_process_name));
                if let Some(snapshot) = snapshot {
                    let idle_ms = tracker::get_idle_ms();
                    if tracker::is_idle(idle_ms, settings.idle_timeout_ms) {
                        if let Some(previous) = previous_sample.as_ref() {
                            let finalize_at = if day_changed { day_start } else { now };
                            let duration_ms = (finalize_at - previous.timestamp).max(0);
                            if let Err(error) = update_sample_duration(
                                &state,
                                previous.id,
                                duration_ms,
                                "failed to finalize idle activity duration",
                            ) {
                                log::warn!("failed to finalize idle activity duration: {error}");
                            }
                        }
                        previous_sample = None;
                    } else {
                        let api_key = state.active_api_key();
                        let classification = classify_snapshot(
                            &state,
                            &app,
                            &api_key,
                            &snapshot.process_name,
                            &snapshot.window_title,
                        );
                        let same_window = previous_sample
                            .as_ref()
                            .map(|previous| previous.matches_snapshot(&snapshot))
                            .unwrap_or(false);

                        if let Some(previous) = previous_sample.as_ref() {
                            let finalize_at = if day_changed { day_start } else { now };
                            let duration_ms = (finalize_at - previous.timestamp).max(0);
                            if let Err(error) = update_sample_duration(
                                &state,
                                previous.id,
                                duration_ms,
                                "failed to update activity duration",
                            ) {
                                log::warn!("failed to update activity duration: {error}");
                            }
                        }

                        let should_reuse_previous_sample = same_window && !day_changed;
                        if should_reuse_previous_sample {
                            // The open row was already refreshed above; keep it active.
                        } else {
                            let timestamp = if day_changed && same_window {
                                day_start
                            } else {
                                now
                            };

                            let id = match insert_activity_sample(
                                &state,
                                timestamp,
                                &snapshot,
                                &classification,
                            ) {
                                Ok(id) => id,
                                Err(error) => {
                                    log::error!("failed to insert activity sample: {error}");
                                    continue;
                                }
                            };

                            previous_sample = Some(PreviousSample {
                                id,
                                timestamp,
                                snapshot: snapshot.clone(),
                            });

                            if day_changed && same_window {
                                let duration_ms = (now - day_start).max(0);
                                if let Err(error) = update_sample_duration(
                                    &state,
                                    id,
                                    duration_ms,
                                    "failed to extend rollover activity duration",
                                ) {
                                    log::warn!("failed to extend rollover activity duration: {error}");
                                }
                            }
                        }

                        let state_after_sample =
                            if classification.category == ActivityCategory::Distraction {
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
                } else if day_changed {
                    if let Some(previous) = previous_sample.as_ref() {
                        let duration_ms = (day_start - previous.timestamp).max(0);
                        if let Err(error) = update_sample_duration(
                            &state,
                            previous.id,
                            duration_ms,
                            "failed to finalize rollover activity duration",
                        ) {
                            log::warn!("failed to finalize rollover activity duration: {error}");
                        }
                    }
                    previous_sample = None;
                }
            } else {
                previous_sample = None;
                notifier.reset();
            }

            if today != last_seen_day {
                let previous_day = previous_day_string(&today);
                if let Err(error) = run_daily_export(&state, &previous_day) {
                    log::warn!("daily export failed for {previous_day}: {error}");
                }
                last_seen_day = today;
            }

            thread::sleep(Duration::from_millis(poll_ms));
        }
    });
}

#[tauri::command]
pub fn get_today_summary(state: State<'_, Arc<AppState>>) -> AppResult<TodaySummary> {
    let today = current_day_string();
    let datastores = state.datastores.lock().map_err(|error| {
        lock_error(
            "get_today_summary",
            "lock datastores for today's summary",
            error,
        )
    })?;
    let (tracked_ms, productive_ms, distraction_ms, neutral_ms) =
        datastores.get_stats_for_day(&today).map_err(|error| {
            AppError::database_for(
                "get_today_summary",
                format!("read today's summary stats: {error}"),
            )
        })?;

    Ok(TodaySummary {
        tracked_ms,
        productive_ms,
        distraction_ms,
        neutral_ms,
    })
}

#[tauri::command]
pub fn get_top_apps(state: State<'_, Arc<AppState>>) -> AppResult<Vec<TopApp>> {
    let today = current_day_string();
    let datastores = state
        .datastores
        .lock()
        .map_err(|error| lock_error("get_top_apps", "lock datastores for top apps", error))?;
    let top_apps = datastores
        .get_top_apps_for_day(&today, 10)
        .map_err(|error| {
            AppError::database_for("get_top_apps", format!("read today's top apps: {error}"))
        })?;
    Ok(top_apps)
}

#[tauri::command]
pub fn get_statistics_snapshot(
    input: Option<StatisticsSnapshotInput>,
    state: State<'_, Arc<AppState>>,
) -> AppResult<StatisticsSnapshot> {
    let today = current_day_string();
    let range_days = input
        .and_then(|value| value.range_days)
        .unwrap_or(7)
        .clamp(1, 30);
    let datastores = state.datastores.lock().map_err(|error| {
        lock_error(
            "get_statistics_snapshot",
            "lock datastores for statistics snapshot",
            error,
        )
    })?;
    let snapshot = datastores
        .get_statistics_snapshot(&today, range_days, 10)
        .map_err(|error| {
            AppError::database_for(
                "get_statistics_snapshot",
                format!("read statistics snapshot for {today}: {error}"),
            )
        })?;
    Ok(snapshot)
}

#[tauri::command]
pub fn get_timeline(
    date: String,
    state: State<'_, Arc<AppState>>,
) -> AppResult<Vec<ActivitySample>> {
    let (start, end) = Datastores::get_day_bounds(&date);
    let datastores = state
        .datastores
        .lock()
        .map_err(|error| lock_error("get_timeline", "lock datastores for timeline", error))?;
    let activity = datastores.get_activity_range(start, end).map_err(|error| {
        AppError::database_for(
            "get_timeline",
            format!("read activity range for {date}: {error}"),
        )
    })?;
    Ok(activity)
}

#[tauri::command]
pub fn get_daily_summary(
    date: String,
    state: State<'_, Arc<AppState>>,
) -> AppResult<Option<DailySummary>> {
    let datastores = state.datastores.lock().map_err(|error| {
        lock_error(
            "get_daily_summary",
            "lock datastores for daily summary",
            error,
        )
    })?;
    let summary = datastores.get_daily_summary(&date).map_err(|error| {
        AppError::database_for(
            "get_daily_summary",
            format!("read daily summary for {date}: {error}"),
        )
    })?;
    Ok(summary)
}

#[tauri::command]
pub fn get_settings(state: State<'_, Arc<AppState>>) -> AppResult<AppSettings> {
    Ok(state.settings_snapshot())
}

#[tauri::command]
pub fn get_tracking_status(state: State<'_, Arc<AppState>>) -> AppResult<TrackingStatus> {
    let running = state.tracking_enabled.load(Ordering::Relaxed);
    Ok(TrackingStatus {
        running,
        state: tracking_state_from_running(running),
    })
}

#[tauri::command]
pub fn get_dashboard_bootstrap(state: State<'_, Arc<AppState>>) -> AppResult<DashboardBootstrapSnapshot> {
    let today = current_day_string();
    let settings = state.settings_snapshot();
    let tracking_status = {
        let running = state.tracking_enabled.load(Ordering::Relaxed);
        TrackingStatus {
            running,
            state: tracking_state_from_running(running),
        }
    };

    let (today_summary, top_apps, statistics_snapshot, daily_summary) = {
        let datastores = state.datastores.lock().map_err(|error| {
            lock_error(
                "get_dashboard_bootstrap",
                "lock datastores for dashboard bootstrap",
                error,
            )
        })?;

        let (tracked_ms, productive_ms, distraction_ms, neutral_ms) =
            datastores.get_stats_for_day(&today).map_err(|error| {
                AppError::database_for(
                    "get_dashboard_bootstrap",
                    format!("read today's summary stats: {error}"),
                )
            })?;
        let top_apps = datastores.get_top_apps_for_day(&today, 10).map_err(|error| {
            AppError::database_for(
                "get_dashboard_bootstrap",
                format!("read today's top apps: {error}"),
            )
        })?;
        let statistics_snapshot = datastores
            .get_statistics_snapshot(&today, 7, 10)
            .map_err(|error| {
                AppError::database_for(
                    "get_dashboard_bootstrap",
                    format!("read dashboard statistics snapshot: {error}"),
                )
            })?;
        let daily_summary = datastores.get_daily_summary(&today).map_err(|error| {
            AppError::database_for(
                "get_dashboard_bootstrap",
                format!("read daily summary for {today}: {error}"),
            )
        })?;

        (
            TodaySummary {
                tracked_ms,
                productive_ms,
                distraction_ms,
                neutral_ms,
            },
            top_apps,
            statistics_snapshot,
            daily_summary,
        )
    };

    let (memory_status, memory_records) = {
        let memory_store = state.memory_store.lock().map_err(|error| {
            lock_error(
                "get_dashboard_bootstrap",
                "lock memory store for dashboard bootstrap",
                error,
            )
        })?;
        memory_store.get_snapshot(10)
    };

    Ok(DashboardBootstrapSnapshot {
        today_summary,
        top_apps,
        statistics_snapshot,
        settings,
        tracking_status,
        daily_summary,
        memory_status,
        memory_records,
    })
}

#[tauri::command]
pub fn set_setting(
    input: SettingInput,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> AppResult<()> {
    apply_setting_change(&app, &state, &input.key, &input.value)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SettingsUpdateInput {
    pub settings: SettingsUpdate,
    #[serde(rename = "geminiApiKey")]
    pub gemini_api_key: Option<String>,
}

#[tauri::command]
pub fn set_settings(
    input: SettingsUpdateInput,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> AppResult<()> {
    persist_settings(&state, &input.settings)?;

    let mut updated_settings = state.settings_snapshot();
    updated_settings.poll_interval_ms = input.settings.poll_interval_ms;
    updated_settings.idle_timeout_ms = input.settings.idle_timeout_ms;
    updated_settings.notification_cooldown_ms = input.settings.notification_cooldown_ms;
    updated_settings.grace_period_ms = input.settings.grace_period_ms;
    updated_settings.markdown_export_path = input.settings.markdown_export_path.clone();
    updated_settings.notifications_enabled = input.settings.notifications_enabled;
    updated_settings.auto_start = input.settings.auto_start;
    updated_settings.classification_rules_json = input.settings.classification_rules_json.clone();
    updated_settings.summary_language = input.settings.summary_language.clone();
    updated_settings.summary_tone = input.settings.summary_tone.clone();
    updated_settings.markdown_privacy_mode = input.settings.markdown_privacy_mode;
    updated_settings.start_in_background = input.settings.start_in_background;

    state.update_classification_rules(&input.settings.classification_rules_json);
    state.update_settings_snapshot(updated_settings);

    if let Some(gemini_api_key) = input
        .gemini_api_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let saved = save_gemini_api_key_and_release_prompt_lock(
            "set_settings",
            state.as_ref(),
            &SystemGeminiKeyStore,
            gemini_api_key,
        )?;
        if saved {
            state.set_gemini_api_key(Some(gemini_api_key.to_string()));
        }
    }

    apply_autostart(&app, input.settings.auto_start)?;

    Ok(())
}

#[tauri::command]
pub fn get_setting(key: String, state: State<'_, Arc<AppState>>) -> AppResult<Option<String>> {
    if key == "geminiApiKey" {
        return Ok(None);
    }

    if let Some(value) = cached_setting_value(&state, &key) {
        return Ok(Some(value));
    }

    let datastores = state
        .datastores
        .lock()
        .map_err(|error| lock_error("get_setting", "lock datastores for setting read", error))?;
    let setting = datastores.get_setting(&key).map_err(|error| {
        AppError::settings_for("get_setting", format!("read setting {key}: {error}"))
    })?;
    Ok(setting)
}

#[tauri::command]
pub fn generate_summary_now(
    state: State<'_, Arc<AppState>>,
) -> AppResult<summarizer::SummaryGenerationReport> {
    let today = current_day_string();
    let settings = state.settings_snapshot();
    let mut datastores = state.datastores.lock().map_err(|error| {
        lock_error(
            "generate_summary_now",
            "lock datastores for summary generation",
            error,
        )
    })?;
    let memory_store = state.memory_store.lock().map_err(|error| {
        lock_error(
            "generate_summary_now",
            "lock memory store for summary generation",
            error,
        )
    })?;
    let report = summarizer::generate_daily_summary(
        "generate_summary_now",
        &mut datastores,
        &state.active_api_key(),
        Some(&memory_store),
        &today,
        &settings.summary_language,
        &settings.summary_tone,
    )?;
    if let Some(error) = &report.ai_summary_error {
        log::warn!("daily summary generated without AI output: {error}");
    }
    if let Err(error) = markdown::export_day(
        &datastores,
        &today,
        &settings.markdown_export_path,
        settings.markdown_privacy_mode,
    ) {
        log::warn!("markdown export failed for {today}: {error}");
    }
    Ok(report)
}

#[tauri::command]
pub fn save_summary_feedback(
    input: SaveSummaryFeedbackInput,
    state: State<'_, Arc<AppState>>,
) -> AppResult<()> {
    let mut datastores = state.datastores.lock().map_err(|error| {
        lock_error(
            "save_summary_feedback",
            "lock datastores for summary feedback",
            error,
        )
    })?;
    let memory_store = state.memory_store.lock().map_err(|error| {
        lock_error(
            "save_summary_feedback",
            "lock memory store for summary feedback",
            error,
        )
    })?;
    summarizer::save_summary_feedback(
        "save_summary_feedback",
        &mut datastores,
        Some(&memory_store),
        &input.date,
        &input.edited_summary,
        input.original_summary.as_deref(),
    )?;
    Ok(())
}

#[tauri::command]
pub fn get_memory_status(state: State<'_, Arc<AppState>>) -> AppResult<MemoryStatus> {
    let memory_store = state
        .memory_store
        .lock()
        .map_err(|error| lock_error("get_memory_status", "lock memory store for status", error))?;
    Ok(memory_store.get_status())
}

#[tauri::command]
pub fn get_memory_snapshot(
    limit: Option<usize>,
    state: State<'_, Arc<AppState>>,
) -> AppResult<MemorySnapshot> {
    let memory_store = state.memory_store.lock().map_err(|error| {
        lock_error(
            "get_memory_snapshot",
            "lock memory store for snapshot",
            error,
        )
    })?;
    let (memory_status, memory_records) = memory_store.get_snapshot(limit.unwrap_or(10));
    Ok(MemorySnapshot {
        memory_status,
        memory_records,
    })
}

#[tauri::command]
pub fn list_memories(
    limit: Option<usize>,
    state: State<'_, Arc<AppState>>,
) -> AppResult<Vec<MemoryRecord>> {
    let memory_store = state
        .memory_store
        .lock()
        .map_err(|error| lock_error("list_memories", "lock memory store for recall", error))?;
    Ok(memory_store.recall(limit.unwrap_or(20)))
}

#[tauri::command]
pub fn forget_memory(id: i64, state: State<'_, Arc<AppState>>) -> AppResult<()> {
    let memory_store = state
        .memory_store
        .lock()
        .map_err(|error| lock_error("forget_memory", "lock memory store for forget", error))?;
    memory_store.forget(id);
    Ok(())
}

#[tauri::command]
pub fn pin_memory(input: PinMemoryInput, state: State<'_, Arc<AppState>>) -> AppResult<()> {
    let memory_store = state
        .memory_store
        .lock()
        .map_err(|error| lock_error("pin_memory", "lock memory store for pin", error))?;
    memory_store.pin(input.id, input.pinned);
    Ok(())
}

#[tauri::command]
pub fn toggle_tracking(app: AppHandle, state: State<'_, Arc<AppState>>) -> AppResult<bool> {
    let current = state.tracking_enabled.load(Ordering::Relaxed);
    let enabled = !current;
    set_tracking_enabled(&app, &state, enabled)
}

fn run_daily_export(state: &Arc<AppState>, date: &str) -> AppResult<()> {
    let settings = state.settings_snapshot();
    let mut datastores = state
        .datastores
        .lock()
        .map_err(|error| lock_error("daily_export", "lock datastores for daily export", error))?;
    let memory_store = state
        .memory_store
        .lock()
        .map_err(|error| lock_error("daily_export", "lock memory store for daily export", error))?;
    let report = summarizer::generate_daily_summary(
        "daily_export",
        &mut datastores,
        &state.active_api_key(),
        Some(&memory_store),
        date,
        &settings.summary_language,
        &settings.summary_tone,
    )?;
    if let Some(error) = &report.ai_summary_error {
        log::warn!("daily export completed without AI output for {date}: {error}");
    }
    if let Err(error) = markdown::export_day(
        &datastores,
        date,
        &settings.markdown_export_path,
        settings.markdown_privacy_mode,
    ) {
        log::warn!("markdown export failed for {date}: {error}");
    }
    Ok(())
}

fn current_day_string() -> String {
    Utc::now().date_naive().format("%Y-%m-%d").to_string()
}

fn previous_day_string(today: &str) -> String {
    let date = chrono::NaiveDate::parse_from_str(today, "%Y-%m-%d")
        .unwrap_or_else(|_| Utc::now().date_naive());
    (date - chrono::Days::new(1)).format("%Y-%m-%d").to_string()
}

fn apply_autostart(app: &AppHandle, enabled: bool) -> AppResult<()> {
    use tauri_plugin_autostart::ManagerExt;

    let manager = app.autolaunch();
    if enabled {
        manager.enable().map_err(|error| {
            AppError::settings_for("set_settings", format!("enable autostart: {error}"))
        })?;
    } else {
        manager.disable().map_err(|error| {
            AppError::settings_for("set_settings", format!("disable autostart: {error}"))
        })?;
    }
    Ok(())
}

pub fn load_tracking_enabled(datastores: &Datastores) -> AppResult<bool> {
    let value = datastores
        .get_setting(TRACKING_ENABLED_SETTING_KEY)
        .map_err(|error| {
            AppError::settings_for(
                "load_tracking_enabled",
                format!("read tracking enabled: {error}"),
            )
        })?;
    Ok(parse_bool_setting(value.as_deref(), true))
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
) -> AppResult<bool> {
    set_tracking_enabled_inner(app, &**state, enabled)
}

pub(crate) fn set_tracking_enabled_on_state(
    app: &AppHandle,
    state: &AppState,
    enabled: bool,
) -> AppResult<bool> {
    set_tracking_enabled_inner(app, state, enabled)
}

fn set_tracking_enabled_inner(app: &AppHandle, state: &AppState, enabled: bool) -> AppResult<bool> {
    {
        let datastores = state.datastores.lock().map_err(|error| {
            lock_error(
                "toggle_tracking",
                "lock datastores for tracking toggle",
                error,
            )
        })?;
        datastores.set_setting(
            TRACKING_ENABLED_SETTING_KEY,
            if enabled { "true" } else { "false" },
        )?;
    }

    state.tracking_enabled.store(enabled, Ordering::Relaxed);
    emit_tracking_status(app, enabled);
    Ok(enabled)
}

fn persist_settings(state: &State<'_, Arc<AppState>>, settings: &SettingsUpdate) -> AppResult<()> {
    let datastores = state
        .datastores
        .lock()
        .map_err(|error| lock_error("set_settings", "lock datastores for settings save", error))?;
    datastores.set_setting("pollIntervalMs", &settings.poll_interval_ms.to_string())?;
    datastores.set_setting("idleTimeoutMs", &settings.idle_timeout_ms.to_string())?;
    datastores.set_setting(
        "notificationCooldownMs",
        &settings.notification_cooldown_ms.to_string(),
    )?;
    datastores.set_setting("gracePeriodMs", &settings.grace_period_ms.to_string())?;
    datastores.set_setting("markdownExportPath", &settings.markdown_export_path)?;
    datastores.set_setting(
        "notificationsEnabled",
        if settings.notifications_enabled {
            "true"
        } else {
            "false"
        },
    )?;
    datastores.set_setting(
        "autoStart",
        if settings.auto_start { "true" } else { "false" },
    )?;
    datastores.set_setting(
        "classificationRulesJson",
        &settings.classification_rules_json,
    )?;
    datastores.set_setting("summaryLanguage", &settings.summary_language)?;
    datastores.set_setting("summaryTone", &settings.summary_tone)?;
    datastores.set_setting(
        "markdownPrivacyMode",
        if settings.markdown_privacy_mode {
            "true"
        } else {
            "false"
        },
    )?;
    datastores.set_setting(
        "startInBackground",
        if settings.start_in_background {
            "true"
        } else {
            "false"
        },
    )?;
    Ok(())
}

fn apply_setting_change(
    app: &AppHandle,
    state: &State<'_, Arc<AppState>>,
    key: &str,
    value: &str,
) -> AppResult<()> {
    if key == "geminiApiKey" {
        let saved = save_gemini_api_key_and_release_prompt_lock(
            "set_setting",
            state.as_ref(),
            &SystemGeminiKeyStore,
            value,
        )?;
        if saved {
            state.set_gemini_api_key(Some(value.trim().to_string()));
        }
        return Ok(());
    }

    if key == TRACKING_ENABLED_SETTING_KEY {
        let enabled = parse_bool_setting(Some(value), true);
        let _ = set_tracking_enabled(app, state, enabled)?;
        return Ok(());
    }

    {
        let datastores = state.datastores.lock().map_err(|error| {
            lock_error("set_setting", "lock datastores for setting update", error)
        })?;
        datastores.set_setting(key, value)?;
    }

    state.update_setting_snapshot(key, value);

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
    app: &AppHandle,
    api_key: &str,
    process_name: &str,
    window_title: &str,
) -> ClassificationResult {
    let truncated_title = window_title.chars().take(200).collect::<String>();

    // Keep the database lock out of the Gemini request path.
    if let Some(rule) =
        state.classification_rules.read().ok().and_then(|rules| {
            crate::classifier::find_matching_rule(&rules, process_name, window_title)
        })
    {
        return ClassificationResult {
            category: rule.category,
            label: rule.label,
            confidence: 1.0,
            source: "rule".to_string(),
        };
    }

    match state.datastores.lock() {
        Ok(datastores) => {
            if let Some(cached) =
                datastores.get_cached_classification(process_name, &truncated_title)
            {
                return ClassificationResult {
                    category: cached.category,
                    label: cached.label,
                    confidence: cached.confidence,
                    source: "cache".to_string(),
                };
            }
        }
        Err(error) => {
            log::warn!("failed to lock datastores for classification cache lookup: {error}");
        }
    }

    if api_key.trim().is_empty() {
        prompt_for_gemini_api_key_settings(app, state);
        return fallback_unknown_classification();
    }

    match crate::gemini::classify_with_gemini(api_key, process_name, window_title) {
        Ok(result) => {
            match state.datastores.lock() {
                Ok(datastores) => {
                    datastores.upsert_cached_classification(
                        process_name,
                        &truncated_title,
                        result.category,
                        &result.label,
                        result.confidence,
                    );
                }
                Err(error) => {
                    log::warn!(
                        "failed to lock datastores for cached classification write: {error}"
                    );
                }
            }
            result
        }
        Err(error) => {
            log::warn!("Gemini classification failed for {process_name}: {error}");
            fallback_unknown_classification()
        }
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

fn cached_setting_value(state: &State<'_, Arc<AppState>>, key: &str) -> Option<String> {
    let settings = state.settings_snapshot();
    match key {
        "pollIntervalMs" => Some(settings.poll_interval_ms.to_string()),
        "idleTimeoutMs" => Some(settings.idle_timeout_ms.to_string()),
        "notificationCooldownMs" => Some(settings.notification_cooldown_ms.to_string()),
        "gracePeriodMs" => Some(settings.grace_period_ms.to_string()),
        "markdownExportPath" => Some(settings.markdown_export_path),
        "notificationsEnabled" => Some(settings.notifications_enabled.to_string()),
        "autoStart" => Some(settings.auto_start.to_string()),
        "classificationRulesJson" => Some(settings.classification_rules_json),
        "summaryLanguage" => Some(settings.summary_language),
        "summaryTone" => Some(settings.summary_tone),
        "markdownPrivacyMode" => Some(settings.markdown_privacy_mode.to_string()),
        "startInBackground" => Some(settings.start_in_background.to_string()),
        "trackingEnabled" => Some(
            state
                .tracking_enabled
                .load(Ordering::Relaxed)
                .to_string(),
        ),
        _ => None,
    }
}

fn apply_setting_to_snapshot(settings: &mut AppSettings, key: &str, value: &str) {
    match key {
        "pollIntervalMs" => {
            if let Ok(parsed) = value.parse::<i64>() {
                settings.poll_interval_ms = parsed.max(1);
            }
        }
        "idleTimeoutMs" => {
            if let Ok(parsed) = value.parse::<i64>() {
                settings.idle_timeout_ms = parsed.max(1);
            }
        }
        "notificationCooldownMs" => {
            if let Ok(parsed) = value.parse::<i64>() {
                settings.notification_cooldown_ms = parsed.max(0);
            }
        }
        "gracePeriodMs" => {
            if let Ok(parsed) = value.parse::<i64>() {
                settings.grace_period_ms = parsed.max(0);
            }
        }
        "markdownExportPath" => {
            settings.markdown_export_path = value.to_string();
        }
        "notificationsEnabled" => {
            settings.notifications_enabled = value == "true";
        }
        "autoStart" => {
            settings.auto_start = value == "true";
        }
        "classificationRulesJson" => {
            settings.classification_rules_json = value.to_string();
        }
        "summaryLanguage" => {
            settings.summary_language = value.to_string();
        }
        "summaryTone" => {
            settings.summary_tone = value.to_string();
        }
        "markdownPrivacyMode" => {
            settings.markdown_privacy_mode = value == "true";
        }
        "startInBackground" => {
            settings.start_in_background = value == "true";
        }
        _ => {}
    }
}

fn lock_error(
    command: &'static str,
    context: &'static str,
    error: impl std::fmt::Display,
) -> AppError {
    AppError::database_for(command, format!("{context}: {error}"))
}

struct PreviousSample {
    id: i64,
    timestamp: i64,
    snapshot: WindowSnapshot,
}

impl PreviousSample {
    fn matches_snapshot(&self, snapshot: &WindowSnapshot) -> bool {
        self.snapshot.process_name == snapshot.process_name
            && self.snapshot.window_title == snapshot.window_title
    }
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
            .body(&format!(
                "{process_name} terlalu lama. Waktunya balik kerja!"
            ))
            .show();

        self.last_notified_at = Some(now);

        let _ = state;
    }
}

fn insert_activity_sample(
    state: &Arc<AppState>,
    timestamp: i64,
    snapshot: &WindowSnapshot,
    classification: &ClassificationResult,
) -> AppResult<i64> {
    let datastores = state.datastores.lock().map_err(|error| {
        lock_error(
            "insert_activity_sample",
            "lock datastores for activity insert",
            error,
        )
    })?;
    datastores
        .insert_activity_sample(ActivityInsert {
            timestamp,
            process_name: snapshot.process_name.clone(),
            window_title: snapshot.window_title.clone(),
            category: classification.category,
            label: classification.label.clone(),
        })
        .map_err(|error| AppError::database_for("insert_activity_sample", format!("insert activity sample: {error}")))
}

fn update_sample_duration(
    state: &Arc<AppState>,
    sample_id: i64,
    duration_ms: i64,
    command: &'static str,
) -> AppResult<()> {
    let datastores = state.datastores.lock().map_err(|error| {
        lock_error(
            command,
            "lock datastores for activity duration update",
            error,
        )
    })?;
    datastores
        .set_activity_duration(sample_id, duration_ms)
        .map_err(|error| AppError::database_for(command, format!("update activity duration: {error}")))
}

fn day_start_timestamp(date: &str) -> i64 {
    chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .unwrap_or_else(|_| Utc::now().date_naive())
        .and_hms_opt(0, 0, 0)
        .expect("valid midnight")
        .and_utc()
        .timestamp_millis()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::Mutex;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[derive(Default)]
    struct MemoryGeminiKeyStore {
        value: Mutex<Option<String>>,
    }

    impl GeminiKeyStore for MemoryGeminiKeyStore {
        fn read(&self) -> anyhow::Result<Option<String>> {
            Ok(self.value.lock().expect("store lock").clone())
        }

        fn write(&self, value: &str) -> anyhow::Result<()> {
            *self.value.lock().expect("store lock") = Some(value.to_string());
            Ok(())
        }
    }

    fn create_test_state() -> (AppState, PathBuf) {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let base_dir = std::env::temp_dir().join(format!("act-track-ai-md-app-test-{unique}"));
        std::fs::create_dir_all(&base_dir).expect("create temp dir");
        let cache_path = base_dir.join("cache.db");
        let activity_path = base_dir.join("activity.db");
        let datastores = Datastores::open(&cache_path, &activity_path).expect("open datastores");
        let memory_store = MemoryStore::open(&base_dir.join("memory.db")).expect("open memory store");
        let settings = AppSettings::default();

        (
            create_app_state(
                datastores,
                memory_store,
                false,
                Vec::new(),
                settings,
                None,
            )
            .expect("create app state"),
            base_dir,
        )
    }

    #[test]
    fn gemini_api_key_prompt_lock_is_single_shot_until_released() {
        let (state, temp_dir) = create_test_state();

        assert!(state.try_lock_gemini_api_key_prompt());
        assert!(!state.try_lock_gemini_api_key_prompt());

        state.unlock_gemini_api_key_prompt();

        assert!(state.try_lock_gemini_api_key_prompt());

        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn saving_gemini_api_key_releases_prompt_lock() {
        let (state, temp_dir) = create_test_state();
        let store = MemoryGeminiKeyStore::default();

        assert!(state.try_lock_gemini_api_key_prompt());
        let saved = save_gemini_api_key_and_release_prompt_lock(
            "set_setting",
            &state,
            &store,
            "new-secret",
        )
            .expect("save key");

        assert!(saved);
        assert!(state.try_lock_gemini_api_key_prompt());
        assert_eq!(store.read().expect("read store"), Some("new-secret".to_string()));

        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn blank_gemini_api_key_does_not_release_prompt_lock() {
        let (state, temp_dir) = create_test_state();
        let store = MemoryGeminiKeyStore::default();

        assert!(state.try_lock_gemini_api_key_prompt());
        let saved = save_gemini_api_key_and_release_prompt_lock(
            "set_setting",
            &state,
            &store,
            "   ",
        )
            .expect("save key");

        assert!(!saved);
        assert!(!state.try_lock_gemini_api_key_prompt());
        assert_eq!(store.read().expect("read store"), None);

        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn cached_settings_snapshot_updates_without_db_reads() {
        let (state, temp_dir) = create_test_state();

        state.update_setting_snapshot("pollIntervalMs", "4500");
        state.update_setting_snapshot("markdownPrivacyMode", "true");
        state.update_setting_snapshot("summaryLanguage", "English");

        let settings = state.settings_snapshot();
        assert_eq!(settings.poll_interval_ms, 4_500);
        assert!(settings.markdown_privacy_mode);
        assert_eq!(settings.summary_language, "English");

        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn cached_gemini_key_updates_runtime_state() {
        let (state, temp_dir) = create_test_state();

        state.set_gemini_api_key(Some("cached-secret".to_string()));

        assert!(state.settings_snapshot().gemini_api_key_configured);
        assert_eq!(state.active_api_key(), "cached-secret");

        let _ = std::fs::remove_dir_all(temp_dir);
    }
}
