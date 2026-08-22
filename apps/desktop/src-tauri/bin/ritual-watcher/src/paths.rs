use std::path::PathBuf;

pub(crate) fn data_dir() -> PathBuf {
    data_dir_from_values(
        std::env::var("RITUAL_DATA_DIR").ok().as_deref(),
        std::env::var("HOME").ok().as_deref(),
    )
}

fn data_dir_from_values(explicit: Option<&str>, home: Option<&str>) -> PathBuf {
    explicit
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            home.map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("/tmp"))
                .join(".ritual")
        })
}

pub(crate) fn auxiliary_data_dir() -> PathBuf {
    let data_dir = data_dir();
    if data_dir.file_name().and_then(|value| value.to_str()) == Some(".ritual") {
        std::env::var("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("/tmp"))
            .join("Library")
            .join("Application Support")
            .join("Ritual")
    } else {
        data_dir
    }
}

#[cfg(test)]
mod tests {
    use super::data_dir_from_values;

    #[test]
    fn explicit_channel_data_root_is_authoritative() {
        assert_eq!(
            data_dir_from_values(Some("/tmp/ritual-watcher-qa"), Some("/Users/test")),
            std::path::PathBuf::from("/tmp/ritual-watcher-qa")
        );
        assert_eq!(
            data_dir_from_values(None, Some("/Users/test")),
            std::path::PathBuf::from("/Users/test/.ritual")
        );
    }
}
