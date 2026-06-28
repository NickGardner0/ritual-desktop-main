use std::env;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrivacyMode {
    LocalOnly,
    PrivateSync,
    CloudIntelligence,
}

impl PrivacyMode {
    pub fn current() -> Self {
        match env::var("RITUAL_PRIVACY_MODE")
            .unwrap_or_else(|_| "local_only".to_string())
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "private_sync" => PrivacyMode::PrivateSync,
            "cloud_intelligence" => PrivacyMode::CloudIntelligence,
            _ => PrivacyMode::LocalOnly,
        }
    }
}

pub fn cloud_consent_enabled(consent: &str) -> bool {
    env::var("RITUAL_CLOUD_CONSENTS")
        .unwrap_or_default()
        .split(',')
        .map(|item| item.trim().to_ascii_lowercase())
        .any(|item| item == consent)
}

pub fn plaintext_cloud_sync_allowed() -> Result<(), String> {
    match PrivacyMode::current() {
        PrivacyMode::CloudIntelligence if cloud_consent_enabled("plaintext_sync") => Ok(()),
        PrivacyMode::CloudIntelligence => {
            Err("plaintext_sync consent is required for legacy desktop cloud sync".to_string())
        }
        PrivacyMode::PrivateSync => {
            Err("Private Sync only permits encrypted envelope sync".to_string())
        }
        PrivacyMode::LocalOnly => {
            Err("Local Only mode blocks legacy plaintext desktop cloud sync".to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, OnceLock};

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    #[test]
    fn local_only_blocks_plaintext_sync() {
        let _guard = env_lock().lock().unwrap();
        env::remove_var("RITUAL_PRIVACY_MODE");
        env::remove_var("RITUAL_CLOUD_CONSENTS");
        assert!(plaintext_cloud_sync_allowed().is_err());
    }

    #[test]
    fn cloud_intelligence_requires_plaintext_sync_consent() {
        let _guard = env_lock().lock().unwrap();
        env::set_var("RITUAL_PRIVACY_MODE", "cloud_intelligence");
        env::set_var("RITUAL_CLOUD_CONSENTS", "analytics");
        assert!(plaintext_cloud_sync_allowed().is_err());
        env::set_var("RITUAL_CLOUD_CONSENTS", "analytics,plaintext_sync");
        assert!(plaintext_cloud_sync_allowed().is_ok());
        env::remove_var("RITUAL_PRIVACY_MODE");
        env::remove_var("RITUAL_CLOUD_CONSENTS");
    }
}
