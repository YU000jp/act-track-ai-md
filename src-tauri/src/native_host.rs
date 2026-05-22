mod browser_native;

use anyhow::Context;
use browser_native::{
    append_native_browser_visit, normalize_native_browser_visit, read_native_message,
    write_native_message,
};

fn main() {
    if let Err(error) = run_native_host() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn run_native_host() -> anyhow::Result<()> {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut reader = stdin.lock();
    let mut writer = stdout.lock();

    while let Some(message) = read_native_message(&mut reader)? {
        let response = handle_native_message(message)?;
        write_native_message(&mut writer, &response)?;
    }

    Ok(())
}

fn handle_native_message(message: serde_json::Value) -> anyhow::Result<serde_json::Value> {
    let input = match serde_json::from_value::<browser_native::NativeBrowserVisitInput>(message) {
        Ok(input) => input,
        Err(error) => {
            return Ok(serde_json::json!({
                "ok": false,
                "error": format!("invalid message: {error}")
            }));
        }
    };

    let record = normalize_native_browser_visit(input);
    append_native_browser_visit(&record).context("append native browser visit")?;

    Ok(serde_json::json!({
        "ok": true,
        "eventId": record.event_id
    }))
}
