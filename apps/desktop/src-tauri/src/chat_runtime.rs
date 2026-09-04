use std::fs::OpenOptions;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use tracing::{info, warn};

const CHAT_RUNTIME_PORT: u16 = 8787;
static CHAT_RUNTIME_CHILD: Mutex<Option<Child>> = Mutex::new(None);

fn bundled_agent_candidates(resource_dir: Option<&Path>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("ritual-agent"));
            candidates.push(dir.join("../Resources/ritual-agent"));
            candidates.push(dir.join("../Resources/binaries/ritual-agent"));
        }
    }
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if let Ok(triple) = crate::sidecar_integrity::current_target_triple() {
        candidates.push(
            manifest_dir
                .join("binaries")
                .join(format!("ritual-agent-{triple}")),
        );
    }
    if let Some(dir) = resource_dir {
        candidates.push(dir.join("ritual-agent"));
        candidates.push(dir.join("binaries/ritual-agent"));
    }
    candidates
}

fn host_node_candidates() -> Vec<PathBuf> {
    let mut candidates = vec![
        PathBuf::from("/opt/homebrew/bin/node"),
        PathBuf::from("/usr/local/bin/node"),
        PathBuf::from("/usr/bin/node"),
        PathBuf::from("/opt/homebrew/bin/bun"),
        PathBuf::from("/usr/local/bin/bun"),
    ];
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in path_var.split(':') {
            candidates.push(PathBuf::from(dir).join("node"));
            candidates.push(PathBuf::from(dir).join("bun"));
        }
    }
    candidates
}

fn find_compiled_agent(resource_dir: Option<&Path>) -> Option<PathBuf> {
    for candidate in bundled_agent_candidates(resource_dir) {
        if !candidate.exists() {
            continue;
        }
        if crate::sidecar_integrity::verify_sidecar("ritual-agent", &candidate).is_err() {
            warn!(path = %candidate.display(), "Ignoring hash-mismatched ritual-agent sidecar");
            continue;
        }
        return Some(candidate);
    }
    None
}

fn find_node() -> Option<PathBuf> {
    host_node_candidates()
        .into_iter()
        .find(|path| path.exists())
}

fn sidecar_script_candidates(resource_dir: Option<PathBuf>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest_dir.join("../../../packages/agent/dist/sidecar.bundle.js"));
    candidates.push(manifest_dir.join("../../../packages/agent/dist/sidecar.js"));
    candidates.push(manifest_dir.join("../../../packages/chat-runtime/dist/sidecar.js"));
    if let Some(dir) = resource_dir {
        candidates.push(dir.join("agent/sidecar.mjs"));
        candidates.push(dir.join("agent/sidecar.js"));
        candidates.push(dir.join("resources/agent/sidecar.mjs"));
        candidates.push(dir.join("resources/agent/sidecar.js"));
        candidates.push(dir.join("chat-runtime/sidecar.js"));
        candidates.push(dir.join("resources/chat-runtime/sidecar.js"));
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("../../../packages/agent/dist/sidecar.bundle.js"));
        candidates.push(cwd.join("../../packages/agent/dist/sidecar.bundle.js"));
        candidates.push(cwd.join("../packages/agent/dist/sidecar.bundle.js"));
        candidates.push(cwd.join("packages/agent/dist/sidecar.bundle.js"));
        candidates.push(cwd.join("../../../packages/agent/dist/sidecar.js"));
        candidates.push(cwd.join("../../packages/agent/dist/sidecar.js"));
        candidates.push(cwd.join("../packages/agent/dist/sidecar.js"));
        candidates.push(cwd.join("packages/agent/dist/sidecar.js"));
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

fn configure_sidecar_stdio(command: &mut Command) {
    let log_dir = crate::app_paths::data_dir().join("logs");
    if std::fs::create_dir_all(&log_dir).is_err() {
        command.stdout(Stdio::null());
        command.stderr(Stdio::null());
        return;
    }
    let log_path = log_dir.join("ritual-chat-sidecar.log");
    let Ok(log_file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    else {
        command.stdout(Stdio::null());
        command.stderr(Stdio::null());
        return;
    };
    let Ok(stdout) = log_file.try_clone() else {
        command.stdout(Stdio::null());
        command.stderr(Stdio::from(log_file));
        return;
    };
    command.stdout(Stdio::from(stdout));
    command.stderr(Stdio::from(log_file));
    info!(path = %log_path.display(), "Capturing chat sidecar stdout/stderr");
}

fn launch_sidecar(mut command: Command, label: &str) {
    command
        .env("RITUAL_CHAT_RUNTIME_PORT", CHAT_RUNTIME_PORT.to_string())
        .env("RITUAL_CHAT_RUNTIME_HOST", "127.0.0.1")
        .stdin(Stdio::null());
    configure_sidecar_stdio(&mut command);
    match command.spawn() {
        Ok(child) => {
            info!(
                sidecar = label,
                port = CHAT_RUNTIME_PORT,
                "Started ritual agent sidecar"
            );
            if let Ok(mut slot) = CHAT_RUNTIME_CHILD.lock() {
                *slot = Some(child);
            }
            thread::spawn(|| {
                thread::sleep(Duration::from_millis(400));
                if let Ok(mut slot) = CHAT_RUNTIME_CHILD.lock() {
                    if let Some(child) = slot.as_mut() {
                        match child.try_wait() {
                            Ok(Some(status)) => warn!(
                                ?status,
                                "agent sidecar exited immediately; see ritual-chat-sidecar.log"
                            ),
                            Ok(None) => {}
                            Err(error) => warn!(error = %error, "Failed to poll agent sidecar"),
                        }
                    }
                }
            });
        }
        Err(error) => {
            warn!(error = %error, "Failed to start ritual chat-runtime sidecar");
        }
    }
}

/// Chat lives in a sidecar process, not in the webview. Spawn is non-blocking
/// so first paint never waits on `/health`. The SPA probes `127.0.0.1:8787`
/// after `createRoot` and falls back to hosted chat if the sidecar is missing.
///
/// Packaged builds run hash-pinned `ritual-agent` (`bun --compile` of
/// `sidecar.bundle.js`, `externalBin` + `sidecar-lock.json`) so Finder/Dock
/// launches do not need Homebrew Node. `tauri dev` keeps a host `node`/`bun`
/// plus the JS bundle so agent edits do not require recompiling the Mach-O.
pub fn start_chat_runtime_sidecar(resource_dir: Option<PathBuf>) {
    if !cfg!(debug_assertions) {
        if let Some(agent) = find_compiled_agent(resource_dir.as_deref()) {
            let current_dir = agent.parent().unwrap_or(Path::new(".")).to_path_buf();
            let label = agent.display().to_string();
            let mut command = Command::new(&agent);
            command.current_dir(current_dir);
            launch_sidecar(command, &label);
            return;
        }
        warn!(
            "ritual-agent sidecar not found; chat will try a host Node fallback then hosted stream"
        );
    }

    let Some(node) = find_node() else {
        warn!("Node.js not found; chat will fall back to the hosted stream");
        return;
    };
    let script = sidecar_script_candidates(resource_dir)
        .into_iter()
        .find(|path| path.exists());
    let Some(script) = script else {
        warn!("agent sidecar.js not found; chat will fall back to the hosted stream");
        return;
    };

    let package_dir = package_dir_for_script(&script);
    let label = script.display().to_string();
    let mut command = Command::new(node);
    command.arg(&script).current_dir(&package_dir);
    launch_sidecar(command, &label);
}

pub fn stop_chat_runtime_sidecar() {
    if let Ok(mut slot) = CHAT_RUNTIME_CHILD.lock() {
        if let Some(mut child) = slot.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::bundled_agent_candidates;
    use std::path::Path;

    #[test]
    fn bundled_agent_is_searched_before_host_paths() {
        let candidates = bundled_agent_candidates(Some(Path::new("/tmp/ritual-resources")));
        let joined = candidates
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(joined.contains("ritual-agent"));
        assert!(joined.contains("/tmp/ritual-resources/ritual-agent"));
        assert!(!joined.contains("/opt/homebrew/bin/node"));
    }
}
