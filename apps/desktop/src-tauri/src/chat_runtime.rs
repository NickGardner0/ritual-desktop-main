use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use tracing::{info, warn};

const CHAT_RUNTIME_PORT: u16 = 8787;
static CHAT_RUNTIME_CHILD: Mutex<Option<Child>> = Mutex::new(None);

fn find_node() -> Option<PathBuf> {
    for candidate in [
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
    ] {
        let path = PathBuf::from(candidate);
        if path.exists() {
            return Some(path);
        }
    }
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in path_var.split(':') {
            let candidate = PathBuf::from(dir).join("node");
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    None
}

fn sidecar_script_candidates(resource_dir: Option<PathBuf>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest_dir.join("../../../packages/chat-runtime/dist/sidecar.js"));
    if let Some(dir) = resource_dir {
        candidates.push(dir.join("chat-runtime/sidecar.js"));
        candidates.push(dir.join("resources/chat-runtime/sidecar.js"));
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("../../../packages/chat-runtime/dist/sidecar.js"));
        candidates.push(cwd.join("../../packages/chat-runtime/dist/sidecar.js"));
        candidates.push(cwd.join("../packages/chat-runtime/dist/sidecar.js"));
        candidates.push(cwd.join("packages/chat-runtime/dist/sidecar.js"));
    }
    candidates
}

fn package_dir_for_script(script: &Path) -> PathBuf {
    script
        .parent()
        .and_then(|dir| {
            if dir.file_name().is_some_and(|name| name == "dist") {
                dir.parent()
            } else {
                Some(dir)
            }
        })
        .unwrap_or(script)
        .to_path_buf()
}

/// Chat lives in a Node sidecar, not in the webview. Spawn is non-blocking so
/// first paint never waits on `/health`. The SPA probes `127.0.0.1:8787` after
/// `createRoot` and falls back to hosted chat if Node is missing.
pub fn start_chat_runtime_sidecar(resource_dir: Option<PathBuf>) {
    let Some(node) = find_node() else {
        warn!("Node.js not found; chat will fall back to the hosted stream");
        return;
    };
    let script = sidecar_script_candidates(resource_dir)
        .into_iter()
        .find(|path| path.exists());
    let Some(script) = script else {
        warn!("chat-runtime sidecar.js not found; chat will fall back to the hosted stream");
        return;
    };

    let package_dir = package_dir_for_script(&script);
    let mut command = Command::new(node);
    command
        .arg(&script)
        .current_dir(&package_dir)
        .env("RITUAL_CHAT_RUNTIME_PORT", CHAT_RUNTIME_PORT.to_string())
        .env("RITUAL_CHAT_RUNTIME_HOST", "127.0.0.1")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    match command.spawn() {
        Ok(child) => {
            info!(path = %script.display(), port = CHAT_RUNTIME_PORT, "Started ritual chat-runtime sidecar");
            if let Ok(mut slot) = CHAT_RUNTIME_CHILD.lock() {
                *slot = Some(child);
            }
        }
        Err(error) => {
            warn!(error = %error, "Failed to start ritual chat-runtime sidecar");
        }
    }
}

pub fn stop_chat_runtime_sidecar() {
    if let Ok(mut slot) = CHAT_RUNTIME_CHILD.lock() {
        if let Some(mut child) = slot.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
