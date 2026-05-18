use serde::Serialize;
use thiserror::Error;

#[derive(Clone, Debug, Error, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AppError {
    #[error("{message}")]
    Database {
        #[serde(skip_serializing_if = "Option::is_none")]
        command: Option<String>,
        message: String,
    },
    #[error("{message}")]
    Keyring {
        #[serde(skip_serializing_if = "Option::is_none")]
        command: Option<String>,
        message: String,
    },
    #[error("{message}")]
    Http {
        #[serde(skip_serializing_if = "Option::is_none")]
        command: Option<String>,
        message: String,
    },
    #[error("{message}")]
    Settings {
        #[serde(skip_serializing_if = "Option::is_none")]
        command: Option<String>,
        message: String,
    },
    #[error("{message}")]
    Validation {
        #[serde(skip_serializing_if = "Option::is_none")]
        command: Option<String>,
        message: String,
    },
    #[error("{message}")]
    ExternalApi {
        #[serde(skip_serializing_if = "Option::is_none")]
        command: Option<String>,
        message: String,
    },
    #[error("{message}")]
    Internal {
        #[serde(skip_serializing_if = "Option::is_none")]
        command: Option<String>,
        message: String,
    },
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    pub fn database(message: impl Into<String>) -> Self {
        Self::database_parts(None, message.into())
    }

    pub fn database_for(command: impl Into<String>, message: impl Into<String>) -> Self {
        Self::database_parts(Some(command.into()), message.into())
    }

    pub fn keyring(message: impl Into<String>) -> Self {
        Self::keyring_parts(None, message.into())
    }

    pub fn keyring_for(command: impl Into<String>, message: impl Into<String>) -> Self {
        Self::keyring_parts(Some(command.into()), message.into())
    }

    pub fn http(message: impl Into<String>) -> Self {
        Self::http_parts(None, message.into())
    }

    pub fn settings_for(command: impl Into<String>, message: impl Into<String>) -> Self {
        Self::settings_parts(Some(command.into()), message.into())
    }

    pub fn validation(message: impl Into<String>) -> Self {
        Self::validation_parts(None, message.into())
    }

    pub fn external_api_for(command: impl Into<String>, message: impl Into<String>) -> Self {
        Self::external_api_parts(Some(command.into()), message.into())
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::internal_parts(None, message.into())
    }

    fn database_parts(command: Option<String>, message: String) -> Self {
        Self::Database { command, message }
    }

    fn keyring_parts(command: Option<String>, message: String) -> Self {
        Self::Keyring { command, message }
    }

    fn http_parts(command: Option<String>, message: String) -> Self {
        Self::Http { command, message }
    }

    fn settings_parts(command: Option<String>, message: String) -> Self {
        Self::Settings { command, message }
    }

    fn validation_parts(command: Option<String>, message: String) -> Self {
        Self::Validation { command, message }
    }

    fn external_api_parts(command: Option<String>, message: String) -> Self {
        Self::ExternalApi { command, message }
    }

    fn internal_parts(command: Option<String>, message: String) -> Self {
        Self::Internal { command, message }
    }
}

impl From<anyhow::Error> for AppError {
    fn from(error: anyhow::Error) -> Self {
        Self::internal(error.to_string())
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(error: rusqlite::Error) -> Self {
        Self::database(error.to_string())
    }
}

impl From<keyring::Error> for AppError {
    fn from(error: keyring::Error) -> Self {
        Self::keyring(error.to_string())
    }
}

impl From<reqwest::Error> for AppError {
    fn from(error: reqwest::Error) -> Self {
        Self::http(error.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(error: serde_json::Error) -> Self {
        Self::validation(error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_as_tagged_payload() {
        let error = AppError::database("lock poisoned");
        let json = serde_json::to_value(&error).expect("serialize");

        assert_eq!(json["kind"], "database");
        assert_eq!(json["message"], "lock poisoned");
        assert!(json.get("command").is_none());
    }

    #[test]
    fn serializes_command_context_when_present() {
        let error = AppError::settings_for("set_settings", "save failed");
        let json = serde_json::to_value(&error).expect("serialize");

        assert_eq!(json["kind"], "settings");
        assert_eq!(json["command"], "set_settings");
        assert_eq!(json["message"], "save failed");
    }

    #[test]
    fn display_uses_message_only() {
        let error = AppError::external_api_for("generate_summary_now", "request failed");
        assert_eq!(error.to_string(), "request failed");
    }
}
