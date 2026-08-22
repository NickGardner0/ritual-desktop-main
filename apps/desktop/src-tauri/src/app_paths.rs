use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum DesktopChannel {
    Production,
    Qa,
    Development,
}

impl DesktopChannel {
    fn directory_name(self) -> &'static str {
        match self {
            Self::Production => ".ritual",
            Self::Qa => ".ritual-qa",
            Self::Development => ".ritual-dev",
        }
    }
}

pub(crate) fn channel_from_values(
    ritual_channel: Option<&str>,
    ritual_env: Option<&str>,
    debug_build: bool,
) -> DesktopChannel {
    let value = ritual_channel
        .filter(|value| !value.trim().is_empty())
        .or_else(|| ritual_env.filter(|value| !value.trim().is_empty()))
        .map(|value| value.trim().to_ascii_lowercase());
    match value.as_deref() {
        Some("production" | "prod") => DesktopChannel::Production,
        Some("qa" | "quality" | "staging" | "stage") => DesktopChannel::Qa,
        Some("development" | "dev" | "local" | "debug") => DesktopChannel::Development,
        Some(_) => DesktopChannel::Development,
        None if debug_build => DesktopChannel::Development,
        None => DesktopChannel::Production,
    }
}

pub(crate) fn configured_channel() -> DesktopChannel {
    channel_from_values(
        std::env::var("RITUAL_CHANNEL").ok().as_deref(),
        std::env::var("RITUAL_ENV")
            .ok()
            .as_deref()
            .or(option_env!("RITUAL_ENV")),
        cfg!(debug_assertions),
    )
}

pub(crate) fn data_dir_for_channel(home: &Path, channel: DesktopChannel) -> PathBuf {
    home.join(channel.directory_name())
}

pub(crate) fn data_dir() -> PathBuf {
    if let Some(explicit) = std::env::var("RITUAL_DATA_DIR")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        return PathBuf::from(explicit);
    }
    dirs::home_dir()
        .map(|home| data_dir_for_channel(&home, configured_channel()))
        .unwrap_or_else(|| PathBuf::from(configured_channel().directory_name()))
}

pub(crate) fn auxiliary_data_dir() -> PathBuf {
    let data_dir = data_dir();
    if std::env::var("RITUAL_DATA_DIR")
        .ok()
        .is_some_and(|value| !value.trim().is_empty())
    {
        return data_dir;
    }
    if configured_channel() == DesktopChannel::Production {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Library")
            .join("Application Support")
            .join("Ritual")
    } else {
        data_dir
    }
}

#[cfg(test)]
mod tests {
    use super::{channel_from_values, data_dir_for_channel, DesktopChannel};
    use std::path::Path;

    #[test]
    fn channel_mapping_is_explicit_and_fail_closed_to_development() {
        assert_eq!(
            channel_from_values(Some("production"), Some("development"), true),
            DesktopChannel::Production
        );
        assert_eq!(
            channel_from_values(None, Some("staging"), false),
            DesktopChannel::Qa
        );
        assert_eq!(
            channel_from_values(Some("unknown"), None, false),
            DesktopChannel::Development
        );
        assert_eq!(
            channel_from_values(None, None, false),
            DesktopChannel::Production
        );
    }

    #[test]
    fn channel_data_roots_do_not_overlap() {
        let home = Path::new("/Users/test");
        assert_eq!(
            data_dir_for_channel(home, DesktopChannel::Production),
            home.join(".ritual")
        );
        assert_eq!(
            data_dir_for_channel(home, DesktopChannel::Qa),
            home.join(".ritual-qa")
        );
        assert_eq!(
            data_dir_for_channel(home, DesktopChannel::Development),
            home.join(".ritual-dev")
        );
    }
}
