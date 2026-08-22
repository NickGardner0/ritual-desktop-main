use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::process::Command;

const SIDECAR_LOCK: &str = include_str!("../binaries/sidecar-lock.json");
const RUNTIME_SIDECAR_LOCK: &str = match option_env!("RITUAL_RUNTIME_SIDECAR_LOCK_JSON") {
    Some(value) => value,
    None => SIDECAR_LOCK,
};

#[derive(Debug, Deserialize)]
struct LockFile {
    sidecars: HashMap<String, SidecarSpec>,
}

#[derive(Debug, Deserialize)]
struct SidecarSpec {
    targets: HashMap<String, TargetSpec>,
}

#[derive(Debug, Deserialize)]
struct TargetSpec {
    sha256: String,
}

pub(crate) fn current_target_triple() -> Result<&'static str, String> {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    return Ok("aarch64-apple-darwin");
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    return Ok("x86_64-apple-darwin");
    #[allow(unreachable_code)]
    Err("Ritual desktop sidecars are supported only on macOS arm64 and x86_64".to_string())
}

fn expected_macho_arch(triple: &str) -> &'static str {
    if triple.starts_with("aarch64") {
        "arm64"
    } else {
        "x86_64"
    }
}

pub(crate) fn verify_sidecar(name: &str, path: &Path) -> Result<(), String> {
    #[cfg(debug_assertions)]
    if std::env::var("RITUAL_VERIFY_DEBUG_SIDECARS")
        .ok()
        .as_deref()
        != Some("1")
    {
        return Ok(());
    }

    let triple = current_target_triple()?;
    let lock: LockFile = serde_json::from_str(RUNTIME_SIDECAR_LOCK)
        .map_err(|error| format!("Invalid bundled sidecar lock: {error}"))?;
    let target = lock
        .sidecars
        .get(name)
        .and_then(|sidecar| sidecar.targets.get(triple))
        .ok_or_else(|| {
            format!(
                "This Ritual build cannot start {name}: no hash-pinned {triple} sidecar is shipped"
            )
        })?;
    let bytes = fs::read(path)
        .map_err(|error| format!("Failed reading {name} at {}: {error}", path.display()))?;
    let actual = format!("{:x}", Sha256::digest(bytes));
    if actual != target.sha256 {
        return Err(format!(
            "Ritual refused to start {name}: SHA-256 mismatch for {triple}"
        ));
    }
    let file = Command::new("/usr/bin/file")
        .arg(path)
        .output()
        .map_err(|error| format!("Failed checking {name} architecture: {error}"))?;
    let output = String::from_utf8_lossy(&file.stdout);
    let expected_arch = expected_macho_arch(triple);
    if !file.status.success() || !output.contains("Mach-O") || !output.contains(expected_arch) {
        return Err(format!(
            "Ritual refused to start {name}: expected Mach-O {expected_arch}, got {}",
            output.trim()
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::current_target_triple;

    #[test]
    fn compiled_target_has_a_supported_sidecar_triple() {
        let triple = current_target_triple().expect("supported macOS test target");
        assert!(matches!(
            triple,
            "aarch64-apple-darwin" | "x86_64-apple-darwin"
        ));
    }
}
