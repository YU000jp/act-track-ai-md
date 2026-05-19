use anyhow::Context;

use crate::db::Datastores;

const GEMINI_KEY_SERVICE: &str = "act-track-ai-md";
const GEMINI_KEY_ACCOUNT: &str = "gemini-api-key";

pub trait GeminiKeyStore {
    fn read(&self) -> anyhow::Result<Option<String>>;
    fn write(&self, value: &str) -> anyhow::Result<()>;
}

pub struct SystemGeminiKeyStore;

impl GeminiKeyStore for SystemGeminiKeyStore {
    fn read(&self) -> anyhow::Result<Option<String>> {
        let entry = keyring::Entry::new(GEMINI_KEY_SERVICE, GEMINI_KEY_ACCOUNT)
            .context("create Gemini API key entry")?;

        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(anyhow::anyhow!(error).context("read Gemini API key")),
        }
    }

    fn write(&self, value: &str) -> anyhow::Result<()> {
        let entry = keyring::Entry::new(GEMINI_KEY_SERVICE, GEMINI_KEY_ACCOUNT)
            .context("create Gemini API key entry")?;
        entry
            .set_password(value)
            .map_err(|error| anyhow::anyhow!("store Gemini API key: {error}"))?;
        Ok(())
    }
}

pub fn gemini_api_key_configured(store: &dyn GeminiKeyStore) -> anyhow::Result<bool> {
    Ok(store.read()?.is_some())
}

pub fn load_gemini_api_key(store: &dyn GeminiKeyStore) -> anyhow::Result<Option<String>> {
    store.read()
}

pub fn save_gemini_api_key(store: &dyn GeminiKeyStore, value: &str) -> anyhow::Result<bool> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(false);
    }

    store.write(value)?;
    Ok(true)
}

pub fn migrate_legacy_gemini_api_key(
    datastores: &Datastores,
    store: &dyn GeminiKeyStore,
) -> anyhow::Result<()> {
    let legacy_value = datastores
        .get_setting("geminiApiKey")
        .context("read legacy Gemini API key")?
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    if let Some(value) = legacy_value {
        if store.read()?.is_none() {
            store.write(&value)?;
        }
        datastores.delete_setting("geminiApiKey")?;
    } else {
        datastores.delete_setting("geminiApiKey")?;
    }

    Ok(())
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

    fn create_test_datastores() -> (Datastores, PathBuf) {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let base_dir = std::env::temp_dir().join(format!("act-track-ai-md-secrets-test-{unique}"));
        std::fs::create_dir_all(&base_dir).expect("create temp dir");
        let cache_path = base_dir.join("cache.db");
        let activity_path = base_dir.join("activity.db");
        let stores = Datastores::open(&cache_path, &activity_path).expect("open datastores");
        (stores, base_dir)
    }

    #[test]
    fn migration_moves_legacy_key_into_secure_store_and_clears_sqlite() {
        let (datastores, temp_dir) = create_test_datastores();
        datastores
            .set_setting("geminiApiKey", "legacy-key")
            .expect("seed legacy key");
        let store = MemoryGeminiKeyStore::default();

        migrate_legacy_gemini_api_key(&datastores, &store).expect("migrate");

        assert_eq!(
            store.read().expect("read store"),
            Some("legacy-key".to_string())
        );
        assert_eq!(
            datastores
                .get_setting("geminiApiKey")
                .expect("read legacy key"),
            None
        );

        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn blank_secret_input_does_not_overwrite_existing_key() {
        let store = MemoryGeminiKeyStore::default();
        store.write("existing-key").expect("seed key");

        let changed = save_gemini_api_key(&store, "   ").expect("save");

        assert!(!changed);
        assert_eq!(
            store.read().expect("read store"),
            Some("existing-key".to_string())
        );
    }
}
