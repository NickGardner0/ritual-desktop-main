#![cfg(target_os = "macos")]

use std::env;
use std::fmt;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
pub struct VisionCaptureBBox {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct VisionCaptureElement {
    pub text: String,
    pub confidence: Option<f64>,
    pub bbox: VisionCaptureBBox,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisionCaptureResult {
    pub schema_version: u32,
    pub engine: String,
    pub visible_text_raw: String,
    pub overall_confidence: Option<f64>,
    #[serde(default)]
    pub elements: Vec<VisionCaptureElement>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VisionUiElementRecord {
    pub text: String,
    pub confidence: Option<f64>,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone)]
pub struct VisionHelperError {
    message: String,
}

impl VisionHelperError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl fmt::Display for VisionHelperError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

fn truncate_log_value(value: &str, max_chars: usize) -> String {
    let trimmed = value.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    let mut truncated = trimmed.chars().take(max_chars).collect::<String>();
    truncated.push('…');
    truncated
}

fn runtime_target_triple() -> Option<String> {
    let arch = match env::consts::ARCH {
        "aarch64" => "aarch64",
        "x86_64" => "x86_64",
        other => other,
    };
    let os = match env::consts::OS {
        "macos" => "apple-darwin",
        _ => return None,
    };
    Some(format!("{arch}-{os}"))
}

pub fn resolve_vision_helper_path() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    let target = runtime_target_triple();

    if let Ok(exe_path) = env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            if let Some(ref triple) = target {
                candidates.push(exe_dir.join(format!("ritual-vision-helper-{triple}")));
                candidates
                    .push(exe_dir.join(format!("../Resources/ritual-vision-helper-{triple}")));
                candidates.push(exe_dir.join(format!(
                    "../Resources/binaries/ritual-vision-helper-{triple}"
                )));
            }
            candidates.push(exe_dir.join("ritual-vision-helper"));
            candidates.push(exe_dir.join("../Resources/ritual-vision-helper"));
            candidates.push(exe_dir.join("../Resources/binaries/ritual-vision-helper"));
        }
    }

    if let Some(ref triple) = target {
        candidates.push(PathBuf::from("binaries").join(format!("ritual-vision-helper-{triple}")));
        candidates.push(
            PathBuf::from("apps/desktop/src-tauri/binaries")
                .join(format!("ritual-vision-helper-{triple}")),
        );
    }
    candidates.push(PathBuf::from("target/release/ritual-vision-helper"));
    candidates.push(PathBuf::from("target/debug/ritual-vision-helper"));
    candidates.push(PathBuf::from(
        "apps/desktop/src-tauri/target/release/ritual-vision-helper",
    ));
    candidates.push(PathBuf::from(
        "apps/desktop/src-tauri/target/debug/ritual-vision-helper",
    ));

    candidates.into_iter().find(|path| path.exists())
}

pub fn run_vision_helper(
    screenshot_path: &Path,
    app_bundle_id: &str,
    app_name: &str,
    window_title: Option<&str>,
) -> Result<VisionCaptureResult, VisionHelperError> {
    let helper_path = resolve_vision_helper_path().ok_or_else(|| {
        VisionHelperError::new("could not resolve bundled ritual-vision-helper binary")
    })?;
    let mut command = Command::new(helper_path);
    command
        .arg("--input")
        .arg(screenshot_path)
        .arg("--app-bundle-id")
        .arg(app_bundle_id)
        .arg("--app-name")
        .arg(app_name)
        .arg("--max-elements")
        .arg("128");
    if let Some(title) = window_title.filter(|value| !value.trim().is_empty()) {
        command.arg("--window-title").arg(title);
    }
    let output = command.output().map_err(|err| {
        VisionHelperError::new(format!("failed to launch ritual-vision-helper: {err}"))
    })?;
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    if !output.status.success() {
        return Err(VisionHelperError::new(format!(
            "ritual-vision-helper exited with status {} (stderr: {}; stdout: {})",
            output.status,
            truncate_log_value(&stderr, 240),
            truncate_log_value(&stdout, 240)
        )));
    }
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Err(VisionHelperError::new(format!(
            "ritual-vision-helper returned empty stdout (stderr: {})",
            truncate_log_value(&stderr, 240)
        )));
    }
    serde_json::from_str::<VisionCaptureResult>(trimmed).map_err(|err| {
        VisionHelperError::new(format!(
            "ritual-vision-helper returned invalid JSON: {} (stdout: {}; stderr: {})",
            err,
            truncate_log_value(trimmed, 320),
            truncate_log_value(&stderr, 240)
        ))
    })
}

pub fn elements_to_ui_elements_json(elements: &[VisionCaptureElement]) -> Option<String> {
    let records = elements
        .iter()
        .filter_map(|element| {
            let text = element.text.trim();
            if text.is_empty() {
                return None;
            }
            Some(VisionUiElementRecord {
                text: text.to_string(),
                confidence: element.confidence,
                x: element.bbox.x,
                y: element.bbox.y,
                width: element.bbox.width,
                height: element.bbox.height,
            })
        })
        .collect::<Vec<_>>();
    serde_json::to_string(&serde_json::json!({
        "engine": "apple_vision",
        "ocr_elements": records,
    }))
    .ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_ui_elements_json() {
        let elements = vec![VisionCaptureElement {
            text: "Fix Clerk auth config".to_string(),
            confidence: Some(0.93),
            bbox: VisionCaptureBBox {
                x: 0.1,
                y: 0.2,
                width: 0.3,
                height: 0.05,
            },
        }];
        let json = elements_to_ui_elements_json(&elements).expect("json");
        assert!(json.contains("ocr_elements"));
        assert!(json.contains("Fix Clerk auth config"));
    }
}
