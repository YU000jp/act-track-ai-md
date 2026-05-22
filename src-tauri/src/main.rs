#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod app_meta;
mod browser;
mod browser_native;
mod classifier;
mod db;
mod error;
mod gemini;
mod http;
mod markdown;
mod memory;
mod secrets;
mod settings;
mod startup;
mod summarizer;
mod tracker;
mod types;

fn main() {
    if let Err(error) = startup::run() {
        log::error!("error while running tauri application: {error}");
        std::process::exit(1);
    }
}
