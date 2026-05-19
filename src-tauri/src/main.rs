#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod app_meta;
mod classifier;
mod db;
mod error;
mod gemini;
mod http;
mod markdown;
mod memory;
mod secrets;
mod settings;
mod summarizer;
mod tracker;
mod types;

use std::sync::Arc;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::Manager;
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_log::{Target, TargetKind};

use app::{
    create_app_state, emit_tracking_status, forget_memory, generate_summary_now,
    get_dashboard_bootstrap, get_daily_summary, get_memory_snapshot, get_memory_status,
    get_setting, get_settings, get_statistics_snapshot, get_timeline, get_today_summary,
    get_top_apps, get_tracking_status, list_memories, load_tracking_enabled, pin_memory,
    save_summary_feedback, set_setting, set_settings, set_tracking_enabled_on_state,
    toggle_tracking,
};
use app_meta::PACKAGE_NAME;
use db::Datastores;
use memory::MemoryStore;
use secrets::{
    gemini_api_key_configured, load_gemini_api_key, migrate_legacy_gemini_api_key,
    SystemGeminiKeyStore,
};
use settings::parse_classification_rules;

fn main() {
    let run_result = tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .target(Target::new(TargetKind::Webview))
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(Vec::<&str>::new()),
        ))
        .invoke_handler(tauri::generate_handler![
            get_today_summary,
            get_top_apps,
            get_statistics_snapshot,
            get_timeline,
            get_daily_summary,
            get_settings,
            get_tracking_status,
            get_dashboard_bootstrap,
            get_memory_snapshot,
            set_setting,
            get_setting,
            generate_summary_now,
            save_summary_feedback,
            get_memory_status,
            list_memories,
            forget_memory,
            pin_memory,
            toggle_tracking,
            set_settings
        ])
        .setup(|app| {
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

            let gemini_api_key =
                load_gemini_api_key(&SystemGeminiKeyStore).ok().flatten();
            let settings = {
                let configured = gemini_api_key_configured(&SystemGeminiKeyStore).unwrap_or(false);
                settings::load_app_settings(|key| datastores.get_setting(key), configured)?
            };
            let classification_rules =
                parse_classification_rules(Some(settings.classification_rules_json.as_str()));
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
            app::start_background_loop(app_handle.clone(), state.clone());

            let dashboard_item =
                MenuItem::with_id(app, "dashboard", "Open Dashboard", true, None::<&str>)?;
            let toggle_tracking_item = MenuItem::with_id(
                app,
                "toggle-tracking",
                "Toggle Tracking",
                true,
                None::<&str>,
            )?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let state_for_menu = state.clone();
            let menu =
                Menu::with_items(app, &[&dashboard_item, &toggle_tracking_item, &quit_item])?;

            let tray_icon = tauri::image::Image::from_bytes(include_bytes!(
                "../../src/frontend/assets/icon.png"
            ))
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
                        let _ =
                            set_tracking_enabled_on_state(app, state_for_menu.as_ref(), !current);
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!());

    if let Err(error) = run_result {
        log::error!("error while running tauri application: {error}");
        std::process::exit(1);
    }
}
