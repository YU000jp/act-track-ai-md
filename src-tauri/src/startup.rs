use std::sync::Arc;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::Manager;
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_log::{Target, TargetKind};

use crate::app::{
    create_app_state, emit_tracking_status, load_tracking_enabled, set_tracking_enabled_on_state,
    start_background_loop, start_browser_history_loop, start_browser_native_inbox_loop,
    with_dashboard_commands,
};
use crate::app_meta::PACKAGE_NAME;
use crate::db::Datastores;
use crate::memory::MemoryStore;
use crate::secrets::{
    gemini_api_key_configured, load_gemini_api_key, migrate_legacy_gemini_api_key,
    SystemGeminiKeyStore,
};
use crate::settings::{parse_classification_rules, serialize_classification_rules};

pub fn run() -> anyhow::Result<()> {
    let builder = with_dashboard_commands(
        tauri::Builder::default()
            .plugin(
                tauri_plugin_log::Builder::new()
                    .target(Target::new(TargetKind::Webview))
                    .build(),
            )
            .plugin(tauri_plugin_notification::init())
            .plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                Some(Vec::<&str>::new()),
            )),
    );

    builder
        .setup(|app| setup_app(app).map_err(|error| -> Box<dyn std::error::Error> { error.into() }))
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())?;

    Ok(())
}

fn setup_app(app: &mut tauri::App) -> anyhow::Result<()> {
    let project_dirs = directories::ProjectDirs::from("com", "irdan", PACKAGE_NAME)
        .ok_or_else(|| anyhow::anyhow!("unable to resolve project directories"))?;
    let data_dir = project_dirs.data_local_dir();
    let datastores = Datastores::open(
        &data_dir.join("act-track-cache.db"),
        &data_dir.join("act-track-activity.db"),
    )?;
    let memory_store = MemoryStore::open(&data_dir.join("act-track-memory.db"))?;
    memory_store.initialize();
    let tracking_enabled = load_tracking_enabled(&datastores)?;

    if let Err(error) = migrate_legacy_gemini_api_key(&datastores, &SystemGeminiKeyStore) {
        log::warn!("failed to migrate Gemini API key: {error}");
    }

    let gemini_api_key = load_gemini_api_key(&SystemGeminiKeyStore).ok().flatten();
    let mut settings = {
        let configured = gemini_api_key_configured(&SystemGeminiKeyStore).unwrap_or(false);
        crate::settings::load_app_settings(|key| datastores.get_setting(key), configured)?
    };
    let parsed_rules =
        parse_classification_rules(Some(settings.classification_rules_json.as_str()));
    let mut classification_rules = {
        let current_rules = datastores.get_classification_rules()?;
        if current_rules.is_empty() && !parsed_rules.is_empty() {
            datastores.replace_classification_rules_from_drafts(&parsed_rules, "json")?
        } else {
            current_rules
        }
    };
    if !classification_rules.is_empty()
        && classification_rules.iter().all(|rule| rule.priority == 0)
    {
        datastores.resequence_classification_rule_priorities(&classification_rules)?;
        classification_rules = datastores.get_classification_rules()?;
    }
    settings.classification_rules_json = serialize_classification_rules(
        &classification_rules
            .iter()
            .map(|rule| crate::settings::ClassificationRule {
                process_name_pattern: rule.process_name_pattern.clone(),
                window_title_pattern: rule.window_title_pattern.clone(),
                category: rule.category,
                label: rule.label.clone(),
                enabled: rule.enabled,
                scope: rule.scope,
            })
            .collect::<Vec<_>>(),
    );
    datastores.set_setting(
        "classificationRulesJson",
        &settings.classification_rules_json,
    )?;

    let state = Arc::new(create_app_state(
        datastores,
        memory_store,
        tracking_enabled,
        classification_rules,
        settings.clone(),
        gemini_api_key,
    )?);
    app.manage(state.clone());
    emit_tracking_status(
        &app.handle(),
        state
            .tracking_enabled
            .load(std::sync::atomic::Ordering::Relaxed),
    );

    if settings.auto_start {
        let _ = app.handle().autolaunch().enable();
    }

    let window = app
        .get_webview_window("main")
        .ok_or_else(|| anyhow::anyhow!("main window is missing"))?;
    let start_hidden = settings.auto_start && settings.start_in_background;
    if start_hidden {
        let _ = window.hide();
    } else {
        let _ = window.show();
        let _ = window.set_focus();
    }

    let app_handle = app.handle().clone();
    start_background_loop(app_handle.clone(), state.clone());
    start_browser_history_loop(app_handle.clone(), state.clone());
    start_browser_native_inbox_loop(app_handle.clone(), state.clone());

    build_tray(app, state)?;

    Ok(())
}

fn build_tray(app: &mut tauri::App, state: Arc<crate::app::AppState>) -> anyhow::Result<()> {
    let dashboard_item = MenuItem::with_id(app, "dashboard", "Open Dashboard", true, None::<&str>)?;
    let toggle_tracking_item = MenuItem::with_id(
        app,
        "toggle-tracking",
        "Toggle Tracking",
        true,
        None::<&str>,
    )?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let state_for_menu = state.clone();
    let menu = Menu::with_items(app, &[&dashboard_item, &toggle_tracking_item, &quit_item])?;

    let tray_icon =
        tauri::image::Image::from_bytes(include_bytes!("../../src/frontend/assets/icon.png"))
            .map_err(|error| anyhow::anyhow!(error))?;

    TrayIconBuilder::new()
        .icon(tray_icon)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "dashboard" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "toggle-tracking" => {
                let current = state_for_menu
                    .tracking_enabled
                    .load(std::sync::atomic::Ordering::Relaxed);
                let _ = set_tracking_enabled_on_state(app, state_for_menu.as_ref(), !current);
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
}
