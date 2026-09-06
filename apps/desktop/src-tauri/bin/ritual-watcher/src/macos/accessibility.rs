//! Accessibility API text capture, candidate scoring, and context dumps.

use super::{AxAttributeDump, AxCandidateDump, AxContextDump, AxNodeDump, FocusedTextInfo};
use core_foundation::base::{CFRelease, TCFType};
use core_foundation::string::{CFString, CFStringRef};
use core_foundation_sys::base::{CFGetTypeID, CFTypeRef};
use core_foundation_sys::string::CFStringGetTypeID;
use std::collections::HashSet;
use std::process::Command;
use std::ptr;

#[cfg(target_os = "macos")]
unsafe fn cf_string_from_create_rule(value: *const std::ffi::c_void) -> Option<String> {
    if value.is_null() {
        return None;
    }
    if CFGetTypeID(value as CFTypeRef) != CFStringGetTypeID() {
        CFRelease(value as *const _);
        return None;
    }
    let cf = CFString::wrap_under_create_rule(value as CFStringRef);
    let text = cf.to_string();
    let trimmed = text.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub(crate) fn normalize_ax_candidate_text(value: &str, max_len: usize) -> Option<String> {
    let normalized = value
        .replace('\u{a0}', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string();
    if normalized.is_empty() {
        return None;
    }
    let clipped: String = normalized.chars().take(max_len).collect();
    if clipped.trim().is_empty() {
        None
    } else {
        Some(clipped)
    }
}

fn preferred_ax_attributes(bundle_id: Option<&str>) -> &'static [&'static str] {
    let bundle = bundle_id.unwrap_or("").to_ascii_lowercase();
    if bundle.contains("cursor") || bundle.contains("code") || bundle.contains("codex") {
        &[
            "AXSelectedText",
            "AXValue",
            "AXDocument",
            "AXFilename",
            "AXTitle",
            "AXDescription",
            "AXLabel",
            "AXIdentifier",
        ]
    } else {
        &[
            "AXSelectedText",
            "AXValue",
            "AXTitle",
            "AXDescription",
            "AXLabel",
            "AXPlaceholderValue",
            "AXDocument",
            "AXFilename",
            "AXHelp",
            "AXIdentifier",
        ]
    }
}

fn nearby_ax_attributes() -> &'static [&'static str] {
    &[
        "AXValue",
        "AXTitle",
        "AXDescription",
        "AXLabel",
        "AXPlaceholderValue",
        "AXDocument",
        "AXFilename",
        "AXHelp",
        "AXIdentifier",
    ]
}

fn structural_child_attributes() -> &'static [&'static str] {
    &[
        "AXVisibleChildren",
        "AXSelectedChildren",
        "AXSelectedRows",
        "AXChildren",
        "AXRows",
        "AXContents",
        "AXTabs",
        "AXGroups",
        "AXTabGroup",
        "AXOutlineRows",
        "AXSplitters",
        "AXScrollAreas",
        "AXColumns",
        "AXLists",
    ]
}

fn ax_attribute_weight(attribute: &str) -> f64 {
    match attribute {
        "AXSelectedText" => 0.98,
        "AXValue" => 0.90,
        "AXDocument" | "AXFilename" => 0.82,
        "AXTitle" => 0.74,
        "AXDescription" => 0.68,
        "AXLabel" | "AXPlaceholderValue" => 0.64,
        "AXIdentifier" => 0.60,
        "AXHelp" => 0.58,
        _ => 0.45,
    }
}

fn ax_source_weight(source: &str) -> f64 {
    match source {
        "focused" => 1.0,
        "parent" => 0.88,
        "sibling" => 0.76,
        "window" => 0.72,
        "related_window" => 0.68,
        "visible_descendant" => 0.64,
        _ => 0.58,
    }
}

fn ax_text_richness_weight(text: &str) -> f64 {
    match text.len() {
        0..=24 => 0.72,
        25..=79 => 0.86,
        80..=239 => 0.96,
        240..=799 => 1.0,
        _ => 1.04,
    }
}

fn ax_text_thinness_score(
    bundle_id: Option<&str>,
    joined: &str,
    capture_component_count: usize,
    selected_text_present: bool,
    has_document_identity: bool,
    contextual_long_count: usize,
) -> f64 {
    let text = joined.trim().to_ascii_lowercase();
    if text.is_empty() {
        return 1.0;
    }

    let mut thinness = 0.0;
    if text.len() < 80 {
        thinness += 0.34;
    } else if text.len() < 180 {
        thinness += 0.18;
    }
    if !selected_text_present {
        thinness += 0.18;
    }
    if !has_document_identity {
        thinness += 0.14;
    }
    if contextual_long_count == 0 {
        thinness += 0.14;
    }
    if capture_component_count <= 1 {
        thinness += 0.12;
    }

    let generic_markers = [
        "accessibility links",
        "address and search bar",
        "all branches",
        "all authors",
        "all environments",
        "ask a follow-up question",
        "command palette",
        "create image",
        "favorites",
        "file explorer",
        "find in files",
        "go to file",
        "google chrome",
        "inbox",
        "new chat",
        "notifications",
        "output directory",
        "pinterest",
        "recents",
        "select date range",
        "window title observer",
    ];
    let generic_hits = generic_markers
        .iter()
        .filter(|marker| text.contains(**marker))
        .count();
    thinness += (generic_hits as f64 * 0.08).min(0.24);

    let bundle = bundle_id.unwrap_or("").to_ascii_lowercase();
    if (bundle.contains("cursor")
        || bundle.contains("code")
        || bundle.contains("codex")
        || bundle.contains("claude")
        || bundle.contains("ritual"))
        && !selected_text_present
        && !has_document_identity
        && text.len() < 260
    {
        thinness += 0.18;
    }

    if selected_text_present {
        thinness -= 0.2;
    }
    if has_document_identity {
        thinness -= 0.12;
    }
    thinness.clamp(0.0, 0.99)
}

pub(crate) fn candidate_score(attribute: &str, source: &str, text: &str) -> f64 {
    (ax_attribute_weight(attribute) * ax_source_weight(source) * ax_text_richness_weight(text))
        .clamp(0.0, 0.99)
}

fn tokenize_pathish(text: &str) -> Vec<String> {
    text.split(|c: char| {
        c.is_whitespace() || matches!(c, '|' | ',' | ';' | '(' | ')' | '[' | ']' | '{' | '}' | '"')
    })
    .filter_map(|token| {
        let cleaned = token
            .trim()
            .trim_matches(|c: char| c == ':' || c == '\'' || c == '`')
            .trim_start_matches("file://")
            .trim_end_matches('/');
        (!cleaned.is_empty()).then(|| cleaned.to_string())
    })
    .collect()
}

pub(crate) fn basename_from_pathish(text: &str) -> Option<String> {
    tokenize_pathish(text).into_iter().find_map(|token| {
        let normalized = token.replace('\\', "/");
        let basename = normalized.rsplit('/').next().unwrap_or(&normalized).trim();
        let lower = basename.to_ascii_lowercase();
        (lower.contains('.') && lower.chars().any(|c| c.is_ascii_alphabetic())).then_some(lower)
    })
}

fn window_document_hint(window_title: Option<&str>) -> Option<String> {
    window_title.and_then(|title| {
        let primary = title
            .split(" — ")
            .next()
            .or_else(|| title.split(" - ").next())
            .unwrap_or(title);
        basename_from_pathish(primary).or_else(|| basename_from_pathish(title))
    })
}

pub(crate) fn candidate_document_hint(
    window_title: Option<&str>,
    candidates: &[(String, &'static str, f64, &'static str)],
) -> Option<String> {
    candidates
        .iter()
        .find(|(_, attr, _, _)| matches!(*attr, "AXDocument" | "AXFilename"))
        .and_then(|(text, _, _, _)| basename_from_pathish(text))
        .or_else(|| window_document_hint(window_title))
}

pub(crate) fn is_editor_like_window_title(window_title: Option<&str>) -> bool {
    let title = window_title.unwrap_or("").to_ascii_lowercase();
    if title.is_empty() {
        return false;
    }
    let editor_markers = [
        ".rs",
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".py",
        ".go",
        ".swift",
        ".java",
        ".kt",
        ".md",
        " — ",
        " - ",
        "src/",
        "apps/",
        "crates/",
        "package.json",
        "cargo.toml",
    ];
    editor_markers.iter().any(|marker| title.contains(marker))
}

fn is_editor_style_context(bundle_id: Option<&str>, window_title: Option<&str>) -> bool {
    let bundle = bundle_id.unwrap_or("").to_ascii_lowercase();
    bundle.contains("cursor")
        || bundle.contains("code")
        || bundle.contains("codex")
        || bundle.contains("zed")
        || bundle.contains("sublime")
        || bundle.contains("xcode")
        || is_editor_like_window_title(window_title)
}

fn is_terminal_style_context(bundle_id: Option<&str>, window_title: Option<&str>) -> bool {
    let bundle = bundle_id.unwrap_or("").to_ascii_lowercase();
    bundle.contains("terminal")
        || bundle.contains("iterm")
        || bundle.contains("warp")
        || window_title
            .unwrap_or("")
            .to_ascii_lowercase()
            .contains("terminal")
}

pub(crate) fn is_browser_context(bundle_id: Option<&str>, _window_title: Option<&str>) -> bool {
    let bundle = bundle_id.unwrap_or("").to_ascii_lowercase();
    bundle.contains("safari")
        || bundle.contains("chrome")
        || bundle.contains("firefox")
        || bundle.contains("brave")
        || bundle.contains("arc")
        || bundle.contains("edge")
        || bundle.contains("opera")
        || bundle.contains("orion")
        || bundle.contains("vivaldi")
}

fn is_task_manager_context(bundle_id: Option<&str>, window_title: Option<&str>) -> bool {
    let bundle = bundle_id.unwrap_or("").to_ascii_lowercase();
    bundle.contains("things")
        || bundle.contains("todoist")
        || bundle.contains("notion")
        || window_title
            .unwrap_or("")
            .to_ascii_lowercase()
            .contains("things")
}

pub(crate) fn is_high_risk_desktop_shell(bundle_id: Option<&str>) -> bool {
    let bundle = bundle_id.unwrap_or("").to_ascii_lowercase();
    bundle == "com.ritual.desktop"
        || bundle.contains("claude")
        || bundle.contains("codex")
        || bundle.contains("cursor")
        || bundle.contains("discord")
        || bundle.contains("figma")
        || bundle.contains("linear")
        || bundle.contains("notion")
        || bundle.contains("obsidian")
        || bundle.contains("slack")
        || bundle.contains("todesktop")
}

pub(crate) fn looks_like_tiny_fragment(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return true;
    }
    if trimmed.len() <= 4 {
        return true;
    }
    let word_count = trimmed.split_whitespace().count();
    let has_path_or_command_markers = trimmed.contains('/')
        || trimmed.contains('.')
        || trimmed.contains("::")
        || trimmed.contains("->")
        || trimmed.contains("--")
        || trimmed.contains('(')
        || trimmed.contains('=');
    if trimmed.len() < 18 && word_count <= 3 && !has_path_or_command_markers {
        return true;
    }
    false
}

pub(crate) fn matches_document_hint(text: &str, document_hint: Option<&str>) -> bool {
    let Some(document_hint) = document_hint else {
        return false;
    };
    let lowered = text.to_ascii_lowercase();
    lowered.contains(document_hint)
        || basename_from_pathish(text)
            .map(|basename| basename == document_hint)
            .unwrap_or(false)
}

pub(crate) fn looks_like_sidebar_listing(text: &str) -> bool {
    let tokens = tokenize_pathish(text);
    if tokens.len() < 3 {
        return false;
    }
    let listing_like = tokens
        .iter()
        .filter(|token| {
            let lower = token.to_ascii_lowercase();
            lower.starts_with('.')
                || lower.contains('/')
                || lower.ends_with(".ts")
                || lower.ends_with(".tsx")
                || lower.ends_with(".js")
                || lower.ends_with(".jsx")
                || lower.ends_with(".rs")
                || lower.ends_with(".py")
                || lower.ends_with(".md")
        })
        .count();
    listing_like >= 3
}

fn looks_like_generic_terminal_tab_label(text: &str) -> bool {
    let lowered = text.to_ascii_lowercase();
    if lowered.contains("terminal tabs") {
        return true;
    }
    let tokens = lowered.split_whitespace().collect::<Vec<_>>();
    tokens.len() >= 4
        && tokens
            .iter()
            .all(|token| *token == "terminal" || token.parse::<u32>().is_ok())
}

pub(crate) fn is_known_window_chrome_noise(
    text: &str,
    attribute: &str,
    source: &str,
    window_title: Option<&str>,
) -> bool {
    let lowered = text.to_ascii_lowercase();
    if lowered.is_empty() {
        return true;
    }
    if lowered.contains("this button also has an action to zoom the window") {
        return true;
    }
    // Common browser chrome noise
    if matches!(
        lowered.as_str(),
        "back"
            | "forward"
            | "reload"
            | "share"
            | "extensions"
            | "downloads"
            | "new tab"
            | "close tab"
            | "bookmark this tab"
            | "show all tabs"
            | "address and search bar"
            | "search or enter website name"
    ) {
        return true;
    }
    if attribute == "AXHelp" && matches!(source, "window" | "sibling" | "visible_descendant") {
        return true;
    }
    if looks_like_generic_terminal_tab_label(text) {
        return true;
    }
    if let Some(title) = window_title {
        if lowered == title.to_ascii_lowercase() {
            return true;
        }
    }
    false
}

fn candidate_filter_reason(
    text: &str,
    attribute: &str,
    source: &str,
    window_title: Option<&str>,
    document_hint: Option<&str>,
) -> Option<&'static str> {
    if is_known_window_chrome_noise(text, attribute, source, window_title) {
        Some("window_chrome_noise")
    } else if looks_like_sidebar_listing(text) && !matches_document_hint(text, document_hint) {
        Some("sidebar_listing_non_active_document")
    } else {
        None
    }
}

fn related_editor_process_pids(parent_pid: i32, bundle_id: Option<&str>) -> Vec<i32> {
    if !is_editor_style_context(bundle_id, None) {
        return Vec::new();
    }

    let output = match Command::new("ps")
        .args(["-axo", "pid=,ppid=,command="])
        .output()
    {
        Ok(output) if output.status.success() => output,
        _ => return Vec::new(),
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut descendants = Vec::new();
    let mut frontier = vec![parent_pid];

    while let Some(target_ppid) = frontier.pop() {
        for line in stdout.lines() {
            let mut parts = line.trim().split_whitespace();
            let Some(pid_str) = parts.next() else {
                continue;
            };
            let Some(ppid_str) = parts.next() else {
                continue;
            };
            let pid = match pid_str.parse::<i32>() {
                Ok(value) => value,
                Err(_) => continue,
            };
            let ppid = match ppid_str.parse::<i32>() {
                Ok(value) => value,
                Err(_) => continue,
            };
            if ppid != target_ppid || pid == parent_pid || descendants.contains(&pid) {
                continue;
            }
            let command = line.to_ascii_lowercase();
            let looks_relevant = command.contains("helper")
                || command.contains("renderer")
                || command.contains("extension-host")
                || command.contains("pty-host");
            if !looks_relevant {
                continue;
            }
            descendants.push(pid);
            frontier.push(pid);
        }
    }

    descendants
}

pub(crate) fn candidate_priority(
    bundle_id: Option<&str>,
    window_title: Option<&str>,
    document_hint: Option<&str>,
    text: &str,
    attribute: &str,
    source: &str,
    base_score: f64,
) -> f64 {
    let mut priority = base_score;
    let is_editor = is_editor_style_context(bundle_id, window_title);
    let is_terminal = is_terminal_style_context(bundle_id, window_title);
    let is_task_manager = is_task_manager_context(bundle_id, window_title);
    let tiny_fragment = looks_like_tiny_fragment(text);
    let is_contextual_source = matches!(
        source,
        "sibling" | "window" | "related_window" | "visible_descendant"
    );
    let is_fileish_attr = matches!(attribute, "AXDocument" | "AXFilename" | "AXTitle");
    let matches_document = matches_document_hint(text, document_hint);
    let sidebar_listing = looks_like_sidebar_listing(text);

    if is_editor && tiny_fragment && source == "focused" {
        priority -= 0.18;
    }
    if is_known_window_chrome_noise(text, attribute, source, window_title) {
        priority -= 0.45;
    }
    if is_editor && !tiny_fragment && is_contextual_source {
        priority += 0.08;
    }
    if is_editor && matches_document && is_fileish_attr {
        priority += 0.14;
    }
    if is_editor && matches_document && is_contextual_source {
        priority += 0.10;
    }
    if is_editor && text.len() >= 48 && is_contextual_source {
        priority += 0.08;
    }
    if is_editor && text.len() >= 80 && is_fileish_attr {
        priority += 0.04;
    }
    if is_editor && sidebar_listing && !matches_document {
        priority -= 0.16;
    }
    if is_editor && is_fileish_attr && !matches_document && is_contextual_source {
        priority -= 0.08;
    }
    if text.len() >= 120 && is_contextual_source {
        priority += 0.04;
    }
    if is_terminal && matches!(attribute, "AXValue" | "AXSelectedText") && source == "focused" {
        priority += 0.14;
    }
    if is_terminal && text.lines().count() >= 2 {
        priority += 0.05;
    }
    if is_task_manager && matches!(attribute, "AXSelectedText" | "AXTitle" | "AXLabel") {
        priority += 0.12;
    }
    if is_task_manager && source == "parent" && text.len() >= 30 {
        priority += 0.05;
    }
    // Browser content: boost longer text from page content areas
    let is_browser = is_browser_context(bundle_id, window_title);
    if is_browser && text.len() >= 80 && is_contextual_source {
        priority += 0.10;
    }
    if is_browser && matches!(attribute, "AXValue" | "AXSelectedText") && text.len() >= 40 {
        priority += 0.08;
    }
    priority.clamp(0.0, 1.2)
}

pub(crate) fn candidate_document_path(
    candidates: &[(String, &'static str, f64, &'static str)],
) -> Option<String> {
    candidates.iter().find_map(|(text, attr, _, _)| {
        if !matches!(*attr, "AXDocument" | "AXFilename") {
            return None;
        }
        tokenize_pathish(text).into_iter().find_map(|token| {
            let normalized = token.replace('\\', "/");
            if normalized.contains('/') {
                normalize_ax_candidate_text(&normalized, 1024)
            } else {
                None
            }
        })
    })
}

pub(crate) fn candidate_is_redundant(existing: &[String], candidate: &str) -> bool {
    let candidate_key = candidate.to_ascii_lowercase();
    existing.iter().any(|value| {
        let existing_key = value.to_ascii_lowercase();
        existing_key == candidate_key
            || existing_key.contains(&candidate_key)
            || (candidate_key.contains(&existing_key)
                && candidate_key.len().saturating_sub(existing_key.len()) < 32)
    })
}

pub(crate) fn finalize_accessibility_text(
    bundle_id: Option<&str>,
    window_title: Option<&str>,
    candidates: Vec<(String, &'static str, f64, &'static str)>,
) -> FocusedTextInfo {
    if candidates.is_empty() {
        return FocusedTextInfo {
            text: None,
            is_sensitive: false,
            strategy: "metadata_fallback".to_string(),
            quality_score: 0.0,
            capture_components: vec!["metadata_fallback".to_string()],
            ax_richness_score: 0.0,
            ax_thinness_score: 1.0,
            selected_text_present: false,
            document_path: None,
            ax_source: Some("metadata".to_string()),
        };
    }

    let document_hint = candidate_document_hint(window_title, &candidates);
    let document_path = candidate_document_path(&candidates);
    let mut ranked = candidates;
    ranked.sort_by(|a, b| {
        candidate_priority(
            bundle_id,
            window_title,
            document_hint.as_deref(),
            &b.0,
            b.1,
            b.3,
            b.2,
        )
        .partial_cmp(&candidate_priority(
            bundle_id,
            window_title,
            document_hint.as_deref(),
            &a.0,
            a.1,
            a.3,
            a.2,
        ))
        .unwrap_or(std::cmp::Ordering::Equal)
        .then_with(|| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal))
        .then_with(|| b.0.len().cmp(&a.0.len()))
    });

    let mut seen = HashSet::new();
    let mut parts = Vec::new();
    let mut capture_components = Vec::new();
    let mut best_score = 0.0;
    let mut best_attr = "AXValue";
    let mut best_source = "focused";
    let mut source_kinds = HashSet::new();
    let mut attr_kinds = HashSet::new();
    let is_editor = is_editor_style_context(bundle_id, window_title);
    let is_terminal = is_terminal_style_context(bundle_id, window_title);
    let is_task_manager = is_task_manager_context(bundle_id, window_title);
    let mut focused_short = false;
    let mut contextual_long_count = 0usize;
    let mut selected_text_present = false;
    let mut document_identity: Option<String> = None;
    let mut selected_text: Option<String> = None;
    let mut focused_node_text: Option<String> = None;
    let mut nearby_texts: Vec<String> = Vec::new();

    for (text, attr, score, source) in &ranked {
        if candidate_filter_reason(text, attr, source, window_title, document_hint.as_deref())
            .is_some()
        {
            continue;
        }
        let priority = candidate_priority(
            bundle_id,
            window_title,
            document_hint.as_deref(),
            text,
            attr,
            source,
            *score,
        );
        if *source == "focused" && looks_like_tiny_fragment(text) {
            focused_short = true;
        }
        if matches!(*source, "sibling" | "window" | "visible_descendant") && text.len() >= 48 {
            contextual_long_count += 1;
        }
        if priority > best_score {
            best_score = priority;
            best_attr = *attr;
            best_source = *source;
        }
        source_kinds.insert(*source);
        attr_kinds.insert(*attr);

        if matches!(*attr, "AXDocument" | "AXFilename") && document_identity.is_none() {
            document_identity = normalize_ax_candidate_text(text, 320);
        }
        if *attr == "AXSelectedText" && selected_text.is_none() {
            selected_text_present = true;
            selected_text = normalize_ax_candidate_text(text, 1_500);
        }
        if *source == "focused"
            && !matches!(*attr, "AXDocument" | "AXFilename")
            && focused_node_text.is_none()
        {
            focused_node_text = normalize_ax_candidate_text(text, 1_500);
        }
        if matches!(
            *source,
            "parent" | "sibling" | "window" | "visible_descendant" | "related_window"
        ) && nearby_texts.len() < 3
        {
            if let Some(value) = normalize_ax_candidate_text(text, 1_200) {
                nearby_texts.push(value);
            }
        }
    }

    fn push_component(
        parts: &mut Vec<String>,
        seen: &mut HashSet<String>,
        capture_components: &mut Vec<String>,
        component: &str,
        text: Option<String>,
    ) {
        if let Some(value) = text {
            if !candidate_is_redundant(parts, &value) && seen.insert(value.to_lowercase()) {
                parts.push(value);
                capture_components.push(component.to_string());
            }
        }
    }

    let window_title_part = window_title.and_then(|value| normalize_ax_candidate_text(value, 180));

    push_component(
        &mut parts,
        &mut seen,
        &mut capture_components,
        "document_identity",
        document_identity.clone(),
    );
    push_component(
        &mut parts,
        &mut seen,
        &mut capture_components,
        "selected_text",
        selected_text.clone(),
    );
    push_component(
        &mut parts,
        &mut seen,
        &mut capture_components,
        "focused_node_text",
        focused_node_text.clone(),
    );
    for value in nearby_texts {
        push_component(
            &mut parts,
            &mut seen,
            &mut capture_components,
            "nearby_structural_text",
            Some(value),
        );
        if parts.len() >= 5 {
            break;
        }
    }
    push_component(
        &mut parts,
        &mut seen,
        &mut capture_components,
        "window_title",
        window_title_part.clone(),
    );
    if parts.is_empty() {
        push_component(
            &mut parts,
            &mut seen,
            &mut capture_components,
            "metadata_fallback",
            window_title_part,
        );
    }

    let joined = parts.join(" | ");
    let strategy = format!(
        "{}_{}",
        best_source.to_ascii_lowercase(),
        best_attr.trim_start_matches("AX").to_ascii_lowercase()
    );

    let bundle = bundle_id.unwrap_or("").to_ascii_lowercase();
    let mut quality = best_score;
    if source_kinds.len() >= 2 {
        quality += 0.05;
    }
    if source_kinds.len() >= 3 {
        quality += 0.04;
    }
    if attr_kinds.len() >= 3 {
        quality += 0.03;
    }
    if joined.len() > 200 {
        quality += 0.04;
    }
    if joined.len() > 600 {
        quality += 0.05;
    }
    if is_editor && focused_short && contextual_long_count > 0 {
        quality += 0.07;
    }
    if is_editor && contextual_long_count >= 2 {
        quality += 0.05;
    }
    if is_terminal && joined.len() >= 80 {
        quality += 0.04;
    }
    if is_task_manager && selected_text_present {
        quality += 0.05;
    }
    if is_editor
        && document_hint
            .as_deref()
            .map(|hint| joined.to_ascii_lowercase().contains(hint))
            .unwrap_or(false)
    {
        quality += 0.05;
    }
    if bundle.contains("cursor") || bundle.contains("code") || bundle.contains("codex") {
        // Only apply quality floor for editors when we have genuine AX content
        // (selected text, document identity, or rich text from the editor body).
        // When the capture is thin (just metadata/window title), let the quality
        // reflect the actual capture so the vision fallback can supplement it.
        let has_genuine_content = selected_text_present
            || document_identity.is_some()
            || document_path.is_some()
            || contextual_long_count >= 2;
        if has_genuine_content {
            quality = quality.max(if joined.len() >= 80 { 0.86 } else { 0.82 });
        }
        // Even without genuine content, editor captures with basic metadata
        // should have a modest floor so we don't completely discard them
        else if joined.len() >= 40 {
            quality = quality.max(0.55);
        }
    }
    if joined.len() < 40 {
        quality = quality.min(0.72);
    }

    let mut ax_richness = best_score;
    ax_richness += (source_kinds.len() as f64).min(4.0) * 0.05;
    ax_richness += (attr_kinds.len() as f64).min(5.0) * 0.04;
    if selected_text_present {
        ax_richness += 0.10;
    }
    if document_identity.is_some() || document_path.is_some() {
        ax_richness += 0.08;
    }
    if joined.len() >= 240 {
        ax_richness += 0.08;
    }
    if joined.len() >= 800 {
        ax_richness += 0.05;
    }
    // For Cursor/Code/Codex with thin captures (no selected text, no document
    // identity, short text), cap richness score so vision fallback can run.
    // This is critical: Electron-based editors often have poor AX coverage,
    // and the vision fallback is the only way to capture actual code content.
    if (bundle.contains("cursor") || bundle.contains("code") || bundle.contains("codex"))
        && !selected_text_present
        && document_identity.is_none()
        && document_path.is_none()
        && joined.len() < 200
    {
        ax_richness = ax_richness.min(0.45);
    }

    let ax_thinness = ax_text_thinness_score(
        bundle_id,
        &joined,
        capture_components.len(),
        selected_text_present,
        document_identity.is_some() || document_path.is_some(),
        contextual_long_count,
    );

    FocusedTextInfo {
        text: normalize_ax_candidate_text(&joined, 12_000),
        is_sensitive: false,
        strategy,
        quality_score: quality.clamp(0.0, 0.98),
        capture_components,
        ax_richness_score: ax_richness.clamp(0.0, 0.99),
        ax_thinness_score: ax_thinness,
        selected_text_present,
        document_path,
        ax_source: Some(best_source.to_string()),
    }
}
/// Check if accessibility permissions are granted
#[cfg(target_os = "macos")]
pub fn check_accessibility_permission() -> bool {
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
    }

    unsafe { AXIsProcessTrusted() }
}

/// Get best-effort visible/focused text for the frontmost app. Returns metadata
/// only when AX permissions are unavailable or the focused element is secure.
#[cfg(target_os = "macos")]
pub fn get_focused_text_info(
    pid: i32,
    bundle_id: Option<&str>,
    window_title: Option<&str>,
) -> FocusedTextInfo {
    // Accessibility API types
    #[repr(C)]
    struct __AXUIElement(std::ffi::c_void);
    type AXUIElementRef = *mut __AXUIElement;
    type AXError = i32;

    const K_AX_ERROR_SUCCESS: AXError = 0;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
        fn AXUIElementCopyAttributeValue(
            element: AXUIElementRef,
            attribute: CFStringRef,
            value: *mut *const std::ffi::c_void,
        ) -> AXError;
        fn AXIsProcessTrusted() -> bool;
    }

    use core_foundation_sys::array::{CFArrayGetCount, CFArrayGetTypeID, CFArrayGetValueAtIndex};
    use core_foundation_sys::base::{CFGetTypeID, CFRetain, CFTypeRef};

    unsafe fn copy_string_attr(element: AXUIElementRef, attribute: &str) -> Option<String> {
        let attr = CFString::new(attribute);
        let mut value: *const std::ffi::c_void = ptr::null();
        let result = AXUIElementCopyAttributeValue(element, attr.as_concrete_TypeRef(), &mut value);
        if result != K_AX_ERROR_SUCCESS || value.is_null() {
            return None;
        }
        cf_string_from_create_rule(value)
    }

    unsafe fn copy_element_attr(
        element: AXUIElementRef,
        attribute: &str,
    ) -> Option<AXUIElementRef> {
        let attr = CFString::new(attribute);
        let mut value: *const std::ffi::c_void = ptr::null();
        let result = AXUIElementCopyAttributeValue(element, attr.as_concrete_TypeRef(), &mut value);
        if result != K_AX_ERROR_SUCCESS || value.is_null() {
            None
        } else {
            Some(value as AXUIElementRef)
        }
    }

    unsafe fn copy_related_elements(
        element: AXUIElementRef,
        attribute: &str,
        max_items: usize,
    ) -> Vec<AXUIElementRef> {
        let attr = CFString::new(attribute);
        let mut value: *const std::ffi::c_void = ptr::null();
        let result = AXUIElementCopyAttributeValue(element, attr.as_concrete_TypeRef(), &mut value);
        if result != K_AX_ERROR_SUCCESS || value.is_null() {
            return Vec::new();
        }

        let type_id = CFGetTypeID(value as CFTypeRef);
        if type_id == CFArrayGetTypeID() {
            let count = CFArrayGetCount(value as _);
            let mut elements = Vec::new();
            for index in 0..count.min(max_items as isize) {
                let item = CFArrayGetValueAtIndex(value as _, index) as AXUIElementRef;
                if item.is_null() {
                    continue;
                }
                CFRetain(item as *const _);
                elements.push(item);
            }
            CFRelease(value as *const _);
            elements
        } else {
            let single = value as AXUIElementRef;
            if single.is_null() {
                Vec::new()
            } else {
                vec![single]
            }
        }
    }

    unsafe fn element_looks_sensitive(element: AXUIElementRef) -> bool {
        let role = copy_string_attr(element, "AXRole").unwrap_or_default();
        let subrole = copy_string_attr(element, "AXSubrole").unwrap_or_default();
        let role_desc = copy_string_attr(element, "AXRoleDescription").unwrap_or_default();
        let lowered = format!("{} {} {}", role, subrole, role_desc).to_lowercase();
        lowered.contains("secure") || lowered.contains("password")
    }

    unsafe fn collect_candidates(
        element: AXUIElementRef,
        source: &'static str,
        attributes: &'static [&'static str],
        output: &mut Vec<(String, &'static str, f64, &'static str)>,
    ) {
        for attr in attributes {
            if let Some(value) = copy_string_attr(element, attr)
                .and_then(|raw| normalize_ax_candidate_text(&raw, 6_000))
            {
                output.push((
                    value.clone(),
                    attr,
                    candidate_score(attr, source, &value),
                    source,
                ));
            }
        }
    }

    unsafe fn collect_visible_descendants(
        element: AXUIElementRef,
        output: &mut Vec<(String, &'static str, f64, &'static str)>,
        visited: &mut HashSet<usize>,
        node_budget: &mut usize,
        depth_remaining: usize,
        max_children: usize,
    ) {
        if element.is_null() || *node_budget == 0 || !visited.insert(element as usize) {
            return;
        }
        *node_budget = node_budget.saturating_sub(1);

        collect_candidates(
            element,
            "visible_descendant",
            nearby_ax_attributes(),
            output,
        );

        if depth_remaining == 0 || *node_budget == 0 {
            return;
        }

        for attr in structural_child_attributes() {
            let children = copy_related_elements(element, attr, max_children);
            if children.is_empty() {
                continue;
            }
            for child in children {
                if !element_looks_sensitive(child) {
                    collect_visible_descendants(
                        child,
                        output,
                        visited,
                        node_budget,
                        depth_remaining.saturating_sub(1),
                        max_children,
                    );
                }
                CFRelease(child as *const _);
                if *node_budget == 0 {
                    break;
                }
            }
            if *node_budget == 0 {
                break;
            }
        }
    }

    unsafe fn collect_related_process_candidates(
        parent_pid: i32,
        bundle_id: Option<&str>,
        output: &mut Vec<(String, &'static str, f64, &'static str)>,
        max_depth: usize,
        max_children: usize,
    ) {
        for related_pid in related_editor_process_pids(parent_pid, bundle_id) {
            let app_element = AXUIElementCreateApplication(related_pid);
            if app_element.is_null() {
                continue;
            }
            let window = copy_element_attr(app_element, "AXFocusedWindow")
                .or_else(|| copy_element_attr(app_element, "AXMainWindow"));
            CFRelease(app_element as *const _);
            let Some(window_element) = window else {
                continue;
            };
            collect_candidates(
                window_element,
                "related_window",
                nearby_ax_attributes(),
                output,
            );
            let mut visited = HashSet::new();
            let mut node_budget = 20usize;
            collect_visible_descendants(
                window_element,
                output,
                &mut visited,
                &mut node_budget,
                max_depth.max(2),
                max_children,
            );
            CFRelease(window_element as *const _);
        }
    }

    unsafe {
        if !AXIsProcessTrusted() {
            return FocusedTextInfo::default();
        }

        let app_element = AXUIElementCreateApplication(pid);
        if app_element.is_null() {
            return FocusedTextInfo::default();
        }

        let focused_attr = CFString::new("AXFocusedUIElement");
        let mut focused_value: *const std::ffi::c_void = ptr::null();
        let result = AXUIElementCopyAttributeValue(
            app_element,
            focused_attr.as_concrete_TypeRef(),
            &mut focused_value,
        );
        let focused_window = copy_element_attr(app_element, "AXFocusedWindow");
        CFRelease(app_element as *const _);

        let focused = if result == K_AX_ERROR_SUCCESS && !focused_value.is_null() {
            Some(focused_value as AXUIElementRef)
        } else {
            None
        };

        if focused.is_none() && focused_window.is_none() {
            return FocusedTextInfo::default();
        }

        let mut ancestors = Vec::new();
        if let Some(focused_element) = focused {
            if element_looks_sensitive(focused_element) {
                CFRelease(focused_element as *const _);
                return FocusedTextInfo {
                    text: None,
                    is_sensitive: true,
                    strategy: "secure_field".to_string(),
                    quality_score: 0.0,
                    capture_components: vec!["secure_field".to_string()],
                    ax_richness_score: 0.0,
                    ax_thinness_score: 1.0,
                    selected_text_present: false,
                    document_path: None,
                    ax_source: Some("focused".to_string()),
                };
            }

            let mut parent = copy_element_attr(focused_element, "AXParent");
            for _ in 0..2 {
                let Some(parent_element) = parent else {
                    break;
                };
                if element_looks_sensitive(parent_element) {
                    CFRelease(parent_element as *const _);
                    if let Some(window_element) = focused_window {
                        CFRelease(window_element as *const _);
                    }
                    CFRelease(focused_element as *const _);
                    return FocusedTextInfo {
                        text: None,
                        is_sensitive: true,
                        strategy: "secure_parent".to_string(),
                        quality_score: 0.0,
                        capture_components: vec!["secure_parent".to_string()],
                        ax_richness_score: 0.0,
                        ax_thinness_score: 1.0,
                        selected_text_present: false,
                        document_path: None,
                        ax_source: Some("parent".to_string()),
                    };
                }
                ancestors.push(parent_element);
                parent = copy_element_attr(parent_element, "AXParent");
            }
        }

        let mut candidates = Vec::new();
        if let Some(focused_element) = focused {
            collect_candidates(
                focused_element,
                "focused",
                preferred_ax_attributes(bundle_id),
                &mut candidates,
            );
        }
        for ancestor in &ancestors {
            collect_candidates(*ancestor, "parent", nearby_ax_attributes(), &mut candidates);
        }
        let high_risk_shell = is_high_risk_desktop_shell(bundle_id);

        if focused.is_some() && !high_risk_shell {
            if let Some(first_parent) = ancestors.first().copied() {
                for attr in structural_child_attributes() {
                    let siblings = copy_related_elements(first_parent, attr, 12);
                    if siblings.is_empty() {
                        continue;
                    }
                    for sibling in siblings {
                        if Some(sibling) != focused && !element_looks_sensitive(sibling) {
                            collect_candidates(
                                sibling,
                                "sibling",
                                nearby_ax_attributes(),
                                &mut candidates,
                            );
                        }
                        CFRelease(sibling as *const _);
                    }
                    break;
                }
            }
        }
        if let Some(window_element) = focused_window {
            collect_candidates(
                window_element,
                "window",
                nearby_ax_attributes(),
                &mut candidates,
            );
            if !high_risk_shell {
                let mut visited = HashSet::new();
                let is_editor = is_editor_style_context(bundle_id, window_title);
                let is_browser = is_browser_context(bundle_id, window_title);
                let bundle = bundle_id.unwrap_or("").to_ascii_lowercase();
                let is_electron_editor = is_editor
                    && (bundle.contains("cursor")
                        || bundle.contains("code")
                        || bundle.contains("codex"));
                // Browsers have deeply nested DOMs — need higher budgets to reach page content
                let mut node_budget = if is_electron_editor {
                    60
                } else if is_browser {
                    50
                } else if is_editor {
                    40
                } else {
                    24
                };
                collect_visible_descendants(
                    window_element,
                    &mut candidates,
                    &mut visited,
                    &mut node_budget,
                    if is_electron_editor {
                        5
                    } else if is_browser {
                        4
                    } else if is_editor {
                        3
                    } else {
                        2
                    },
                    if is_electron_editor {
                        24
                    } else if is_browser {
                        20
                    } else if is_editor {
                        16
                    } else {
                        14
                    },
                );
            }
            CFRelease(window_element as *const _);
        }

        let document_hint = candidate_document_hint(window_title, &candidates);
        let weak_editor_capture = is_editor_style_context(bundle_id, window_title)
            && !candidates.iter().any(|(text, attr, _, source)| {
                candidate_filter_reason(text, attr, source, window_title, document_hint.as_deref())
                    .is_none()
                    && (matches_document_hint(text, document_hint.as_deref())
                        || text.len() >= 120
                        || matches!(*attr, "AXDocument" | "AXFilename"))
            });
        if weak_editor_capture && !high_risk_shell {
            // For Cursor/Code/Codex, use deeper traversal since Electron-based
            // editors have deeply nested AX trees where code content hides
            let bundle = bundle_id.unwrap_or("").to_ascii_lowercase();
            let (depth, children) =
                if bundle.contains("cursor") || bundle.contains("code") || bundle.contains("codex")
                {
                    (4, 20) // Deeper + wider traversal for Electron editors
                } else {
                    (2, 10)
                };
            collect_related_process_candidates(pid, bundle_id, &mut candidates, depth, children);
        }

        for ancestor in ancestors {
            CFRelease(ancestor as *const _);
        }
        if let Some(focused_element) = focused {
            CFRelease(focused_element as *const _);
        }

        finalize_accessibility_text(bundle_id, window_title, candidates)
    }
}

#[cfg(target_os = "macos")]
pub fn dump_accessibility_context(
    pid: i32,
    bundle_id: Option<&str>,
    window_title: Option<&str>,
    max_depth: usize,
    max_children: usize,
) -> Result<AxContextDump, String> {
    #[repr(C)]
    struct __AXUIElement(std::ffi::c_void);
    type AXUIElementRef = *mut __AXUIElement;
    type AXError = i32;

    const K_AX_ERROR_SUCCESS: AXError = 0;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
        fn AXUIElementCopyAttributeValue(
            element: AXUIElementRef,
            attribute: CFStringRef,
            value: *mut *const std::ffi::c_void,
        ) -> AXError;
        fn AXIsProcessTrusted() -> bool;
    }

    use core_foundation_sys::array::{CFArrayGetCount, CFArrayGetTypeID, CFArrayGetValueAtIndex};
    use core_foundation_sys::base::{CFGetTypeID, CFRetain, CFTypeRef};

    unsafe fn copy_string_attr(element: AXUIElementRef, attribute: &str) -> Option<String> {
        let attr = CFString::new(attribute);
        let mut value: *const std::ffi::c_void = ptr::null();
        let result = AXUIElementCopyAttributeValue(element, attr.as_concrete_TypeRef(), &mut value);
        if result != K_AX_ERROR_SUCCESS || value.is_null() {
            return None;
        }
        cf_string_from_create_rule(value)
            .and_then(|text| normalize_ax_candidate_text(&text, 4_000))
    }

    unsafe fn copy_element_attr(
        element: AXUIElementRef,
        attribute: &str,
    ) -> Option<AXUIElementRef> {
        let attr = CFString::new(attribute);
        let mut value: *const std::ffi::c_void = ptr::null();
        let result = AXUIElementCopyAttributeValue(element, attr.as_concrete_TypeRef(), &mut value);
        if result != K_AX_ERROR_SUCCESS || value.is_null() {
            None
        } else {
            Some(value as AXUIElementRef)
        }
    }

    unsafe fn copy_related_elements(
        element: AXUIElementRef,
        attribute: &str,
        max_items: usize,
    ) -> Vec<AXUIElementRef> {
        let attr = CFString::new(attribute);
        let mut value: *const std::ffi::c_void = ptr::null();
        let result = AXUIElementCopyAttributeValue(element, attr.as_concrete_TypeRef(), &mut value);
        if result != K_AX_ERROR_SUCCESS || value.is_null() {
            return Vec::new();
        }

        let type_id = CFGetTypeID(value as CFTypeRef);
        if type_id == CFArrayGetTypeID() {
            let count = CFArrayGetCount(value as _);
            let mut elements = Vec::new();
            for index in 0..count.min(max_items as isize) {
                let item = CFArrayGetValueAtIndex(value as _, index) as AXUIElementRef;
                if item.is_null() {
                    continue;
                }
                CFRetain(item as *const _);
                elements.push(item);
            }
            CFRelease(value as *const _);
            elements
        } else {
            let single = value as AXUIElementRef;
            if single.is_null() {
                Vec::new()
            } else {
                vec![single]
            }
        }
    }

    unsafe fn dump_node(
        element: AXUIElementRef,
        source: &str,
        depth_remaining: usize,
        max_children: usize,
        visited: &mut HashSet<usize>,
    ) -> AxNodeDump {
        if element.is_null() || !visited.insert(element as usize) {
            return AxNodeDump {
                source: source.to_string(),
                role: None,
                subrole: None,
                role_description: None,
                title: None,
                text_attributes: Vec::new(),
                children: Vec::new(),
            };
        }

        let role = copy_string_attr(element, "AXRole");
        let subrole = copy_string_attr(element, "AXSubrole");
        let role_description = copy_string_attr(element, "AXRoleDescription");
        let title = copy_string_attr(element, "AXTitle");
        let text_attributes = [
            "AXValue",
            "AXSelectedText",
            "AXDescription",
            "AXLabel",
            "AXPlaceholderValue",
            "AXDocument",
            "AXFilename",
            "AXHelp",
            "AXIdentifier",
        ]
        .iter()
        .filter_map(|attr| {
            copy_string_attr(element, attr).map(|value| AxAttributeDump {
                attribute: (*attr).to_string(),
                value,
            })
        })
        .collect::<Vec<_>>();

        let mut children = Vec::new();
        if depth_remaining > 0 {
            let mut emitted = 0usize;
            for attr in structural_child_attributes() {
                let related = copy_related_elements(element, attr, max_children);
                if related.is_empty() {
                    continue;
                }
                for child in related {
                    children.push(dump_node(
                        child,
                        &format!("{}:{}", source, attr),
                        depth_remaining.saturating_sub(1),
                        max_children,
                        visited,
                    ));
                    CFRelease(child as *const _);
                    emitted += 1;
                    if emitted >= max_children {
                        break;
                    }
                }
                if emitted >= max_children {
                    break;
                }
            }
        }

        AxNodeDump {
            source: source.to_string(),
            role,
            subrole,
            role_description,
            title,
            text_attributes,
            children,
        }
    }

    unsafe fn collect_candidates(
        element: AXUIElementRef,
        source: &'static str,
        attributes: &'static [&'static str],
        output: &mut Vec<(String, &'static str, f64, &'static str)>,
    ) {
        for attr in attributes {
            if let Some(value) = copy_string_attr(element, attr)
                .and_then(|raw| normalize_ax_candidate_text(&raw, 6_000))
            {
                output.push((
                    value.clone(),
                    attr,
                    candidate_score(attr, source, &value),
                    source,
                ));
            }
        }
    }

    unsafe fn collect_visible_descendants(
        element: AXUIElementRef,
        output: &mut Vec<(String, &'static str, f64, &'static str)>,
        visited: &mut HashSet<usize>,
        node_budget: &mut usize,
        depth_remaining: usize,
        max_children: usize,
    ) {
        if element.is_null() || *node_budget == 0 || !visited.insert(element as usize) {
            return;
        }
        *node_budget = node_budget.saturating_sub(1);

        collect_candidates(
            element,
            "visible_descendant",
            nearby_ax_attributes(),
            output,
        );

        if depth_remaining == 0 || *node_budget == 0 {
            return;
        }

        for attr in structural_child_attributes() {
            let children = copy_related_elements(element, attr, max_children);
            if children.is_empty() {
                continue;
            }
            for child in children {
                collect_visible_descendants(
                    child,
                    output,
                    visited,
                    node_budget,
                    depth_remaining.saturating_sub(1),
                    max_children,
                );
                CFRelease(child as *const _);
                if *node_budget == 0 {
                    break;
                }
            }
            if *node_budget == 0 {
                break;
            }
        }
    }

    unsafe fn collect_related_process_candidates(
        parent_pid: i32,
        bundle_id: Option<&str>,
        output: &mut Vec<(String, &'static str, f64, &'static str)>,
        max_depth: usize,
        max_children: usize,
    ) {
        for related_pid in related_editor_process_pids(parent_pid, bundle_id) {
            let app_element = AXUIElementCreateApplication(related_pid);
            if app_element.is_null() {
                continue;
            }
            let window = copy_element_attr(app_element, "AXFocusedWindow")
                .or_else(|| copy_element_attr(app_element, "AXMainWindow"));
            CFRelease(app_element as *const _);
            let Some(window_element) = window else {
                continue;
            };
            collect_candidates(
                window_element,
                "related_window",
                nearby_ax_attributes(),
                output,
            );
            let mut visited = HashSet::new();
            let mut node_budget = 20usize;
            collect_visible_descendants(
                window_element,
                output,
                &mut visited,
                &mut node_budget,
                max_depth.max(2),
                max_children,
            );
            CFRelease(window_element as *const _);
        }
    }

    unsafe {
        if !AXIsProcessTrusted() {
            return Err("Accessibility permission not granted".to_string());
        }

        let app_element = AXUIElementCreateApplication(pid);
        if app_element.is_null() {
            return Err(format!("Failed to create AX app element for pid {}", pid));
        }

        let focused = copy_element_attr(app_element, "AXFocusedUIElement");
        let focused_window = copy_element_attr(app_element, "AXFocusedWindow");
        CFRelease(app_element as *const _);

        let mut visited = HashSet::new();
        let focused_dump = focused
            .map(|element| dump_node(element, "focused", max_depth, max_children, &mut visited));

        let mut parent_dumps = Vec::new();
        if let Some(focused_element) = focused {
            let mut parent = copy_element_attr(focused_element, "AXParent");
            let mut depth = 0usize;
            while let Some(parent_element) = parent {
                parent_dumps.push(dump_node(
                    parent_element,
                    &format!("parent:{}", depth),
                    1,
                    max_children.min(6),
                    &mut visited,
                ));
                depth += 1;
                if depth >= 3 {
                    CFRelease(parent_element as *const _);
                    break;
                }
                parent = copy_element_attr(parent_element, "AXParent");
                CFRelease(parent_element as *const _);
            }
        }

        let mut sibling_dumps = Vec::new();
        if let Some(focused_element) = focused {
            if let Some(parent_element) = copy_element_attr(focused_element, "AXParent") {
                'outer: for attr in structural_child_attributes() {
                    let siblings = copy_related_elements(parent_element, attr, max_children);
                    if siblings.is_empty() {
                        continue;
                    }
                    for sibling in siblings {
                        if sibling != focused_element {
                            sibling_dumps.push(dump_node(
                                sibling,
                                &format!("sibling:{}", attr),
                                1,
                                max_children.min(4),
                                &mut visited,
                            ));
                        }
                        CFRelease(sibling as *const _);
                        if sibling_dumps.len() >= max_children {
                            break 'outer;
                        }
                    }
                }
                CFRelease(parent_element as *const _);
            }
        }

        let window_dump = focused_window.map(|element| {
            dump_node(
                element,
                "window",
                max_depth.max(2),
                max_children,
                &mut visited,
            )
        });

        let mut raw_candidates = Vec::new();
        if let Some(focused_element) = focused {
            collect_candidates(
                focused_element,
                "focused",
                preferred_ax_attributes(bundle_id),
                &mut raw_candidates,
            );
            let mut parent = copy_element_attr(focused_element, "AXParent");
            for _ in 0..2 {
                let Some(parent_element) = parent else {
                    break;
                };
                collect_candidates(
                    parent_element,
                    "parent",
                    nearby_ax_attributes(),
                    &mut raw_candidates,
                );
                parent = copy_element_attr(parent_element, "AXParent");
                CFRelease(parent_element as *const _);
            }
            if let Some(parent_element) = copy_element_attr(focused_element, "AXParent") {
                'sibling_search: for attr in structural_child_attributes() {
                    let siblings = copy_related_elements(parent_element, attr, max_children);
                    if siblings.is_empty() {
                        continue;
                    }
                    for sibling in siblings {
                        if sibling != focused_element {
                            collect_candidates(
                                sibling,
                                "sibling",
                                nearby_ax_attributes(),
                                &mut raw_candidates,
                            );
                        }
                        CFRelease(sibling as *const _);
                    }
                    break 'sibling_search;
                }
                CFRelease(parent_element as *const _);
            }
            CFRelease(focused_element as *const _);
        }

        if let Some(window_element) = focused_window {
            collect_candidates(
                window_element,
                "window",
                nearby_ax_attributes(),
                &mut raw_candidates,
            );
            let mut candidate_visited = HashSet::new();
            let is_editor = is_editor_style_context(bundle_id, window_title);
            let mut node_budget = if is_editor { 40 } else { 24 };
            collect_visible_descendants(
                window_element,
                &mut raw_candidates,
                &mut candidate_visited,
                &mut node_budget,
                if is_editor {
                    max_depth.max(3)
                } else {
                    max_depth.max(2)
                },
                max_children,
            );
        }

        let document_hint = candidate_document_hint(window_title, &raw_candidates);
        let weak_editor_capture = is_editor_style_context(bundle_id, window_title)
            && !raw_candidates.iter().any(|(text, attr, _, source)| {
                candidate_filter_reason(text, attr, source, window_title, document_hint.as_deref())
                    .is_none()
                    && (matches_document_hint(text, document_hint.as_deref())
                        || text.len() >= 120
                        || matches!(*attr, "AXDocument" | "AXFilename"))
            });
        if weak_editor_capture {
            collect_related_process_candidates(
                pid,
                bundle_id,
                &mut raw_candidates,
                max_depth,
                max_children,
            );
        }

        let document_hint = candidate_document_hint(window_title, &raw_candidates);
        let mut candidates = raw_candidates
            .into_iter()
            .map(|(text, attr, base_score, source)| AxCandidateDump {
                priority_score: candidate_priority(
                    bundle_id,
                    window_title,
                    document_hint.as_deref(),
                    &text,
                    attr,
                    source,
                    base_score,
                ),
                document_match: matches_document_hint(&text, document_hint.as_deref()),
                filtered_reason: candidate_filter_reason(
                    &text,
                    attr,
                    source,
                    window_title,
                    document_hint.as_deref(),
                )
                .map(|value| value.to_string()),
                text,
                attribute: attr.to_string(),
                source: source.to_string(),
                base_score,
            })
            .collect::<Vec<_>>();
        candidates.sort_by(|a, b| {
            b.priority_score
                .partial_cmp(&a.priority_score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| b.text.len().cmp(&a.text.len()))
        });

        let dump = AxContextDump {
            pid,
            bundle_id: bundle_id.map(|value| value.to_string()),
            window_title: window_title.map(|value| value.to_string()),
            document_hint,
            focused: focused_dump,
            parents: parent_dumps,
            siblings: sibling_dumps,
            window: window_dump,
            candidates,
        };

        if let Some(focused_element) = focused {
            CFRelease(focused_element as *const _);
        }
        if let Some(window_element) = focused_window {
            CFRelease(window_element as *const _);
        }

        Ok(dump)
    }
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

/// Prompt user to grant accessibility permissions
#[cfg(target_os = "macos")]
pub fn prompt_accessibility_permission() {
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::CFDictionary;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrustedWithOptions(options: *const std::ffi::c_void) -> bool;
    }

    unsafe {
        let key = CFString::new("AXTrustedCheckOptionPrompt");
        let value = CFBoolean::true_value();

        let options = CFDictionary::from_CFType_pairs(&[(key.as_CFType(), value.as_CFType())]);

        AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef() as *const _);
    }
}
