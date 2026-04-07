#![cfg(target_os = "macos")]

use std::env;
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
                candidates.push(exe_dir.join(format!("../Resources/ritual-vision-helper-{triple}")));
                candidates.push(
                    exe_dir.join(format!("../Resources/binaries/ritual-vision-helper-{triple}"))
                );
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
) -> Option<VisionCaptureResult> {
    let helper_path = resolve_vision_helper_path()?;
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
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return None;
    }
    serde_json::from_str::<VisionCaptureResult>(trimmed).ok()
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
