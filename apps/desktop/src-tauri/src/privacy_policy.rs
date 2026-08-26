use chrono::DateTime;
#[cfg(test)]
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use tauri::{AppHandle, Manager, Runtime};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PrivacyMode {
    LocalOnly,
    PrivateSync,
    CloudIntelligence,
}

impl PrivacyMode {
    pub fn as_header_value(self) -> &'static str {
        match self {
            Self::LocalOnly => "local_only",
            Self::PrivateSync => "private_sync",
            Self::CloudIntelligence => "cloud_intelligence",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CloudConsent {
    Analytics,
    Search,
    Ai,
    Voice,
    Vision,
    ProviderSync,
    CrashDiagnostics,
    ProductTelemetry,
    Sms,
    PlaintextSync,
}

impl CloudConsent {
    pub fn as_header_value(self) -> &'static str {
        match self {
            Self::Analytics => "analytics",
            Self::Search => "search",
            Self::Ai => "ai",
            Self::Voice => "voice",
            Self::Vision => "vision",
            Self::ProviderSync => "provider_sync",
            Self::CrashDiagnostics => "crash_diagnostics",
            Self::ProductTelemetry => "product_telemetry",
            Self::Sms => "sms",
            Self::PlaintextSync => "plaintext_sync",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPrivacyStateInput {
    pub mode: PrivacyMode,
    #[serde(default)]
    pub consents: BTreeMap<CloudConsent, bool>,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPrivacyState {
    pub mode: PrivacyMode,
    pub consents: BTreeSet<CloudConsent>,
    pub updated_at: String,
}

impl Default for DesktopPrivacyState {
    fn default() -> Self {
        Self {
            mode: PrivacyMode::LocalOnly,
            consents: BTreeSet::new(),
            updated_at: "1970-01-01T00:00:00.000Z".to_string(),
        }
    }
}

impl TryFrom<DesktopPrivacyStateInput> for DesktopPrivacyState {
    type Error = String;

    fn try_from(value: DesktopPrivacyStateInput) -> Result<Self, Self::Error> {
        DateTime::parse_from_rfc3339(value.updated_at.trim())
            .map_err(|_| "updatedAt must be an RFC 3339 timestamp".to_string())?;
        Ok(Self {
            mode: value.mode,
            consents: value
                .consents
                .into_iter()
                .filter_map(|(consent, enabled)| enabled.then_some(consent))
                .collect(),
            updated_at: value.updated_at.trim().to_string(),
        })
    }
}

impl DesktopPrivacyState {
    pub fn consent_enabled(&self, consent: CloudConsent) -> bool {
        self.consents.contains(&consent)
    }

    pub fn cloud_consents_header(&self) -> String {
        self.consents
            .iter()
            .map(|consent| consent.as_header_value())
            .collect::<Vec<_>>()
            .join(",")
    }
}

pub fn read_privacy_state<R: Runtime>(app: &AppHandle<R>) -> DesktopPrivacyState {
    app.state::<crate::desktop_runtime::DesktopShellState>()
        .privacy_state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

pub fn plaintext_cloud_sync_allowed(state: &DesktopPrivacyState) -> Result<(), String> {
    match state.mode {
        PrivacyMode::CloudIntelligence if state.consent_enabled(CloudConsent::PlaintextSync) => {
            Ok(())
        }
        PrivacyMode::CloudIntelligence => {
            Err("plaintext_sync consent is required for desktop rollup sync".to_string())
        }
        PrivacyMode::PrivateSync => {
            Err("Private Sync only permits encrypted envelope sync".to_string())
        }
        PrivacyMode::LocalOnly => Err("Local Only mode blocks cloud rollup sync".to_string()),
    }
}

pub fn plaintext_cloud_sync_allowed_for_app<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    plaintext_cloud_sync_allowed(&read_privacy_state(app))
}

#[cfg(test)]
fn default_updated_at_now() -> String {
    Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_only_blocks_plaintext_sync() {
        assert!(plaintext_cloud_sync_allowed(&DesktopPrivacyState::default()).is_err());
    }

    #[test]
    fn private_sync_never_allows_plaintext_uploader() {
        let mut state = DesktopPrivacyState {
            mode: PrivacyMode::PrivateSync,
            updated_at: default_updated_at_now(),
            ..DesktopPrivacyState::default()
        };
        state.consents.insert(CloudConsent::PlaintextSync);
        assert!(plaintext_cloud_sync_allowed(&state).is_err());
    }

    #[test]
    fn cloud_intelligence_requires_plaintext_sync_consent() {
        let mut state = DesktopPrivacyState {
            mode: PrivacyMode::CloudIntelligence,
            updated_at: default_updated_at_now(),
            ..DesktopPrivacyState::default()
        };
        assert!(plaintext_cloud_sync_allowed(&state).is_err());
        state.consents.insert(CloudConsent::PlaintextSync);
        assert!(plaintext_cloud_sync_allowed(&state).is_ok());
    }

    #[test]
    fn privacy_input_rejects_invalid_timestamp() {
        let input = DesktopPrivacyStateInput {
            mode: PrivacyMode::LocalOnly,
            consents: BTreeMap::new(),
            updated_at: "not-a-date".to_string(),
        };
        assert!(DesktopPrivacyState::try_from(input).is_err());
    }
}
