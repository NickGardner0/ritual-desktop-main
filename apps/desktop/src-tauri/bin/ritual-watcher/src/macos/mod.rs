//! macOS-specific window tracking implementation
//!
//! Uses NSWorkspace for active app detection and Accessibility API for window titles.
//! Inspired by ActivityWatch's aw-watcher-window implementation.

#![allow(dead_code)]
#![allow(non_upper_case_globals)]

mod accessibility;
mod window_title;
mod workspace;

pub use accessibility::dump_accessibility_context;

use serde::Serialize;
use std::env;

pub(crate) fn env_flag_enabled(name: &str) -> bool {
    matches!(
        env::var(name).ok().as_deref(),
        Some("1") | Some("true") | Some("TRUE") | Some("yes") | Some("YES")
    )
}

/// Information about the currently active window
#[derive(Debug, Clone)]
pub struct ActiveWindowInfo {
    /// Bundle identifier (e.g., "com.apple.Safari")
    pub bundle_id: String,
    /// Application name (e.g., "Safari")
    pub app_name: String,
    /// Window title (if accessible)
    pub window_title: Option<String>,
    /// Process ID
    pub pid: Option<i32>,
    /// Best-effort frontmost window bounds in global screen coordinates.
    pub bounds: Option<ActiveWindowBounds>,
}

#[derive(Debug, Clone, Copy)]
pub struct ActiveWindowBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Best-effort accessibility text for the focused UI element.
#[derive(Debug, Clone, Default)]
pub struct FocusedTextInfo {
    pub text: Option<String>,
    pub is_sensitive: bool,
    pub strategy: String,
    pub quality_score: f64,
    pub capture_components: Vec<String>,
    pub ax_richness_score: f64,
    pub ax_thinness_score: f64,
    pub selected_text_present: bool,
    pub document_path: Option<String>,
    pub ax_source: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AxAttributeDump {
    pub attribute: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AxNodeDump {
    pub source: String,
    pub role: Option<String>,
    pub subrole: Option<String>,
    pub role_description: Option<String>,
    pub title: Option<String>,
    pub text_attributes: Vec<AxAttributeDump>,
    pub children: Vec<AxNodeDump>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AxContextDump {
    pub pid: i32,
    pub bundle_id: Option<String>,
    pub window_title: Option<String>,
    pub document_hint: Option<String>,
    pub focused: Option<AxNodeDump>,
    pub parents: Vec<AxNodeDump>,
    pub siblings: Vec<AxNodeDump>,
    pub window: Option<AxNodeDump>,
    pub candidates: Vec<AxCandidateDump>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AxCandidateDump {
    pub text: String,
    pub attribute: String,
    pub source: String,
    pub base_score: f64,
    pub priority_score: f64,
    pub document_match: bool,
    pub filtered_reason: Option<String>,
}

/// Get information about the currently active window
pub fn get_active_window_info() -> Result<Option<ActiveWindowInfo>, String> {
    #[cfg(target_os = "macos")]
    {
        workspace::get_active_window_info_macos()
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("This platform is not supported".to_string())
    }
}

#[cfg(target_os = "macos")]
pub fn get_focused_text_info(
    pid: i32,
    bundle_id: Option<&str>,
    window_title: Option<&str>,
) -> FocusedTextInfo {
    accessibility::get_focused_text_info(pid, bundle_id, window_title)
}

#[cfg(not(target_os = "macos"))]
pub fn check_accessibility_permission() -> bool {
    false
}

#[cfg(not(target_os = "macos"))]
pub fn get_focused_text_info(
    _pid: i32,
    _bundle_id: Option<&str>,
    _window_title: Option<&str>,
) -> FocusedTextInfo {
    FocusedTextInfo::default()
}

#[cfg(not(target_os = "macos"))]
pub fn dump_accessibility_context(
    _pid: i32,
    _bundle_id: Option<&str>,
    _window_title: Option<&str>,
    _max_depth: usize,
    _max_children: usize,
) -> Result<AxContextDump, String> {
    Err("Accessibility dump is only supported on macOS".to_string())
}

#[cfg(not(target_os = "macos"))]
pub fn prompt_accessibility_permission() {}

#[cfg(test)]
mod tests {
    use super::accessibility::{
        basename_from_pathish, candidate_document_hint, candidate_document_path,
        candidate_is_redundant, candidate_priority, candidate_score, finalize_accessibility_text,
        is_editor_like_window_title, is_known_window_chrome_noise, looks_like_sidebar_listing,
        looks_like_tiny_fragment, matches_document_hint, normalize_ax_candidate_text,
    };

    #[test]
    fn normalize_ax_candidate_text_compacts_whitespace() {
        assert_eq!(
            normalize_ax_candidate_text("  hello\n   world  ", 100).as_deref(),
            Some("hello world")
        );
    }

    #[test]
    fn finalize_accessibility_text_prefers_richer_candidates() {
        let info = finalize_accessibility_text(
            Some("com.todesktop.230313mzl4w4u92"),
            Some("project_time_service.py"),
            vec![
                (
                    "apps/backend/services/project_time_service.py".to_string(),
                    "AXDocument",
                    0.82,
                    "window",
                ),
                (
                    "Implement context renderer and claim cards".to_string(),
                    "AXSelectedText",
                    0.98,
                    "focused",
                ),
            ],
        );

        assert!(info.text.unwrap_or_default().contains("claim cards"));
        assert!(info.quality_score >= 0.84);
    }

    #[test]
    fn candidate_is_redundant_filters_substrings() {
        let existing = vec![
            "home-client.tsx ritual-desktop-main projectTimeAttribution orchestrator.ts".to_string(),
        ];
        assert!(candidate_is_redundant(
            &existing,
            "projectTimeAttribution orchestrator.ts"
        ));
        assert!(!candidate_is_redundant(
            &existing,
            "Things Today Ritual launch day planning list"
        ));
    }

    #[test]
    fn candidate_score_rewards_richer_focused_content() {
        let focused = candidate_score(
            "AXSelectedText",
            "focused",
            "Implement context-aware window traversal and dedupe",
        );
        let sibling = candidate_score("AXTitle", "sibling", "Implement");

        assert!(focused > sibling);
        assert!(focused > 0.8);
    }

    #[test]
    fn tiny_fragment_detection_flags_short_editor_inputs() {
        assert!(looks_like_tiny_fragment("c"));
        assert!(looks_like_tiny_fragment("run test"));
        assert!(!looks_like_tiny_fragment("python start.py"));
        assert!(!looks_like_tiny_fragment(
            "home-client.tsx ritual-desktop-main search context capture"
        ));
    }

    #[test]
    fn editor_like_window_title_detects_code_windows() {
        assert!(is_editor_like_window_title(Some(
            "home-client.tsx — ritual-desktop-main"
        )));
        assert!(!is_editor_like_window_title(Some("Today")));
    }

    #[test]
    fn editor_priority_prefers_richer_neighbor_context() {
        let focused = candidate_priority(
            Some("com.todesktop.230313mzl4w4u92"),
            Some("home-client.tsx — ritual-desktop-main"),
            Some("home-client.tsx"),
            "npm run d",
            "AXValue",
            "focused",
            0.90,
        );
        let sibling = candidate_priority(
            Some("com.todesktop.230313mzl4w4u92"),
            Some("home-client.tsx — ritual-desktop-main"),
            Some("home-client.tsx"),
            "home-client.tsx ritual-desktop-main projectTimeAttribution orchestrator.ts",
            "AXTitle",
            "sibling",
            0.64,
        );

        assert!(sibling > focused);
    }

    #[test]
    fn document_hint_prefers_ax_document_basename() {
        let hint = candidate_document_hint(
            Some("page.tsx — ritual-desktop-main"),
            &[(
                "file:///Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/app/page.tsx"
                    .to_string(),
                "AXDocument",
                0.82,
                "window",
            )],
        );
        assert_eq!(hint.as_deref(), Some("page.tsx"));
        assert_eq!(
            basename_from_pathish(
                "file:///Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/app/page.tsx"
            )
            .as_deref(),
            Some("page.tsx")
        );
    }

    #[test]
    fn noise_and_sidebar_helpers_catch_cursor_window_chrome() {
        assert!(is_known_window_chrome_noise(
            "this button also has an action to zoom the window",
            "AXHelp",
            "window",
            Some("page.tsx — ritual-desktop-main")
        ));
        assert!(is_known_window_chrome_noise(
            "Terminal 1 Terminal 1 Terminal 2 Terminal 2 Terminal tabs",
            "AXTitle",
            "visible_descendant",
            Some("page.tsx — ritual-desktop-main")
        ));
        assert!(looks_like_sidebar_listing(
            ".pytest_cache .trigger .cursor .github"
        ));
        assert!(matches_document_hint(
            "file:///Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/app/page.tsx",
            Some("page.tsx")
        ));
    }

    #[test]
    fn finalize_accessibility_text_boosts_multi_source_window_context() {
        let info = finalize_accessibility_text(
            Some("com.apple.Terminal"),
            Some("zsh"),
            vec![
                (
                    "cargo test -p ritual-watcher".to_string(),
                    "AXValue",
                    0.9,
                    "focused",
                ),
                (
                    "apps/desktop/src-tauri/bin/ritual-watcher/src/macos.rs".to_string(),
                    "AXTitle",
                    0.73,
                    "sibling",
                ),
                (
                    "Implement generic AX traversal for visible descendants".to_string(),
                    "AXDescription",
                    0.68,
                    "visible_descendant",
                ),
            ],
        );

        let text = info.text.unwrap_or_default();
        assert!(text.contains("cargo test -p ritual-watcher"));
        assert!(text.contains("visible descendants"));
        assert!(info.quality_score >= 0.8);
    }

    #[test]
    fn finalize_accessibility_text_prefers_context_over_tiny_editor_fragment() {
        let info = finalize_accessibility_text(
            Some("com.todesktop.230313mzl4w4u92"),
            Some("home-client.tsx — ritual-desktop-main"),
            vec![
                ("npm run d".to_string(), "AXValue", 0.90, "focused"),
                (
                    "home-client.tsx ritual-desktop-main projectTimeAttribution orchestrator.ts"
                        .to_string(),
                    "AXTitle",
                    0.64,
                    "sibling",
                ),
                (
                    "Implement context-aware window traversal and visible descendant ranking"
                        .to_string(),
                    "AXDescription",
                    0.66,
                    "visible_descendant",
                ),
            ],
        );

        let text = info.text.unwrap_or_default();
        assert!(text.contains("projectTimeAttribution"));
        assert!(text.contains("visible descendant ranking"));
        assert!(info.quality_score >= 0.86);
    }

    #[test]
    fn finalize_accessibility_text_filters_window_chrome_noise_and_prefers_document_context() {
        let info = finalize_accessibility_text(
            Some("com.todesktop.230313mzl4w4u92"),
            Some("page.tsx — ritual-desktop-main"),
            vec![
                (
                    "file:///Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/app/(dashboard)/dashboard/page.tsx"
                        .to_string(),
                    "AXDocument",
                    0.82,
                    "window",
                ),
                (
                    "this button also has an action to zoom the window".to_string(),
                    "AXHelp",
                    0.58,
                    "visible_descendant",
                ),
                (
                    ".pytest_cache .trigger .cursor .github".to_string(),
                    "AXTitle",
                    0.74,
                    "visible_descendant",
                ),
                (
                    "page.tsx ritual-desktop-main projectTimeAttribution orchestrator".to_string(),
                    "AXTitle",
                    0.68,
                    "visible_descendant",
                ),
            ],
        );

        let text = info.text.unwrap_or_default().to_ascii_lowercase();
        assert!(text.contains("page.tsx"));
        assert!(text.contains("projecttimeattribution"));
        assert!(!text.contains("zoom the window"));
        assert!(info.quality_score >= 0.86);
    }

    #[test]
    fn candidate_document_path_prefers_full_ax_path() {
        let path = candidate_document_path(&[(
            "file:///Users/nickgardner/Desktop/ritual-desktop-main/apps/backend/services/project_time_service.py"
                .to_string(),
            "AXDocument",
            0.82,
            "window",
        )]);
        assert_eq!(
            path.as_deref(),
            Some("/Users/nickgardner/Desktop/ritual-desktop-main/apps/backend/services/project_time_service.py")
        );
    }

    #[test]
    fn finalize_accessibility_text_tracks_selected_text_and_document_path() {
        let info = finalize_accessibility_text(
            Some("com.todesktop.230313mzl4w4u92"),
            Some("project_time_service.py — ritual-desktop-main"),
            vec![
                (
                    "file:///Users/nickgardner/Desktop/ritual-desktop-main/apps/backend/services/project_time_service.py"
                        .to_string(),
                    "AXDocument",
                    0.82,
                    "window",
                ),
                (
                    "selected query expansion branch".to_string(),
                    "AXSelectedText",
                    0.98,
                    "focused",
                ),
                (
                    "surrounding retrieval heuristics for context snapshots".to_string(),
                    "AXValue",
                    0.90,
                    "focused",
                ),
            ],
        );

        assert!(info.selected_text_present);
        assert!(matches!(
            info.ax_source.as_deref(),
            Some("focused" | "window")
        ));
        assert_eq!(
            info.document_path.as_deref(),
            Some("/Users/nickgardner/Desktop/ritual-desktop-main/apps/backend/services/project_time_service.py")
        );
        assert_eq!(
            info.capture_components.first().map(|value| value.as_str()),
            Some("document_identity")
        );
    }
}
