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
use crate::error::{AppError, AppResult};
use crate::markdown;
use crate::memory::MemoryStore;
use crate::secrets::{
    gemini_api_key_configured, load_gemini_api_key, save_gemini_api_key, SystemGeminiKeyStore,
};
use crate::settings::{parse_classification_rules, AppSettings, ClassificationRule};
use crate::summarizer;
use crate::tracker;
use crate::types::{
    ActivityCategory, ActivitySample, ClassificationResult, DailySummary, MemoryRecord,
    MemoryStatus, StatisticsSnapshot, TopApp, TrackingState, WindowSnapshot,
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

pub fn create_app_state(
    datastores: Datastores,
    memory_store: MemoryStore,
    tracking_enabled: bool,
    classification_rules: Vec<ClassificationRule>,
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
    ))
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

            let settings = {
                match state.datastores.lock() {
                    Ok(datastores) => load_app_settings(|key| datastores.get_setting(key), false)
                        .unwrap_or_else(|error| {
                            log::warn!("failed to load background settings: {error}");
                            AppSettings::default()
                        }),
                    Err(error) => {
                        log::error!("failed to lock datastores for background settings: {error}");
                        thread::sleep(Duration::from_millis(1000));
                        continue;
                    }
                }
            };
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
                        let api_key = active_api_key();
                        let classification = classify_snapshot(
                            &state,
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
    let datastores = state
        .datastores
        .lock()
        .map_err(|error| lock_error("get_settings", "lock datastores for settings", error))?;
    let configured = gemini_api_key_configured(&SystemGeminiKeyStore).map_err(|error| {
        AppError::keyring_for(
            "get_settings",
            format!("read Gemini API key status: {error}"),
        )
    })?;
    let settings =
        load_app_settings(|key| datastores.get_setting(key), configured).map_err(|error| {
            AppError::settings_for("get_settings", format!("load app settings: {error}"))
        })?;
    Ok(settings)
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

    state.update_classification_rules(&input.settings.classification_rules_json);
    apply_autostart(&app, input.settings.auto_start)?;

    if let Some(gemini_api_key) = input
        .gemini_api_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        save_gemini_api_key(&SystemGeminiKeyStore, gemini_api_key).map_err(|error| {
            AppError::keyring_for("set_settings", format!("save Gemini API key: {error}"))
        })?;
    }

    Ok(())
}

#[tauri::command]
pub fn get_setting(key: String, state: State<'_, Arc<AppState>>) -> AppResult<Option<String>> {
    if key == "geminiApiKey" {
        return Ok(None);
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
    let api_key = active_api_key();
    let report = summarizer::generate_daily_summary(
        "generate_summary_now",
        &mut datastores,
        &api_key,
        Some(&memory_store),
        &today,
    )?;
    if let Some(error) = &report.ai_summary_error {
        log::warn!("daily summary generated without AI output: {error}");
    }
    if let Err(error) = markdown::export_day(&datastores, &today) {
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
    let mut datastores = state
        .datastores
        .lock()
        .map_err(|error| lock_error("daily_export", "lock datastores for daily export", error))?;
    let memory_store = state
        .memory_store
        .lock()
        .map_err(|error| lock_error("daily_export", "lock memory store for daily export", error))?;
    let api_key = active_api_key();
    let report = summarizer::generate_daily_summary(
        "daily_export",
        &mut datastores,
        &api_key,
        Some(&memory_store),
        date,
    )?;
    if let Some(error) = &report.ai_summary_error {
        log::warn!("daily export completed without AI output for {date}: {error}");
    }
    if let Err(error) = markdown::export_day(&datastores, date) {
        log::warn!("markdown export failed for {date}: {error}");
    }
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
        save_gemini_api_key(&SystemGeminiKeyStore, value).map_err(|error| {
            AppError::keyring_for("set_setting", format!("save Gemini API key: {error}"))
        })?;
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
            ClassificationResult {
                category: ActivityCategory::Unknown,
                label: "Uncategorized".to_string(),
                confidence: 0.0,
                source: "fallback".to_string(),
            }
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
pub use crate::settings::load_app_settings;
