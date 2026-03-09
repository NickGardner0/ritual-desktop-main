use std::path::PathBuf;
use std::time::SystemTime;

fn ensure_watcher_sidecar_for_tauri() {
    let target = std::env::var("TARGET").unwrap_or_default();
    if target.is_empty() {
        println!("cargo:warning=⚠️ Unable to determine TARGET for watcher sidecar");
        return;
    }

    let sidecar_name = format!("ritual-watcher-{target}");
    let sidecar_dir = PathBuf::from("binaries");
    let sidecar_path = sidecar_dir.join(&sidecar_name);
    let candidates = [
        PathBuf::from("bin/ritual-watcher/target/release/ritual-watcher"),
        PathBuf::from("target/release/ritual-watcher"),
        PathBuf::from("bin/ritual-watcher/target/debug/ritual-watcher"),
        PathBuf::from("target/debug/ritual-watcher"),
    ];

    let force_refresh = std::env::var("RITUAL_FORCE_SIDECAR_REFRESH")
        .map(|v| {
            let value = v.trim().to_ascii_lowercase();
            matches!(value.as_str(), "1" | "true" | "yes" | "on")
        })
        .unwrap_or(false);

    let existing_mtime = std::fs::metadata(&sidecar_path)
        .and_then(|meta| meta.modified())
        .ok();

    let mut newest_candidate: Option<(PathBuf, SystemTime)> = None;
    for candidate in candidates {
        let Ok(meta) = std::fs::metadata(&candidate) else {
            continue;
        };
        let Ok(modified) = meta.modified() else {
            continue;
        };
        match &newest_candidate {
            Some((_, current_modified)) if *current_modified >= modified => {}
            _ => newest_candidate = Some((candidate, modified)),
        }
    }

    if let Some((candidate_path, candidate_mtime)) = newest_candidate {
        let should_copy = force_refresh
            || existing_mtime
                .map(|existing| candidate_mtime > existing)
                .unwrap_or(true);
        if should_copy {
            if let Err(e) = std::fs::create_dir_all(&sidecar_dir) {
                println!(
                    "cargo:warning=⚠️ Failed to create sidecar directory {}: {}",
                    sidecar_dir.display(),
                    e
                );
                return;
            }

            match std::fs::copy(&candidate_path, &sidecar_path) {
                Ok(_) => {
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        if let Ok(metadata) = std::fs::metadata(&sidecar_path) {
                            let mut permissions = metadata.permissions();
                            permissions.set_mode(0o755);
                            let _ = std::fs::set_permissions(&sidecar_path, permissions);
                        }
                    }

                    println!(
                        "cargo:warning=✅ watcher sidecar prepared: {} -> {}",
                        candidate_path.display(),
                        sidecar_path.display()
                    );
                    return;
                }
                Err(e) => {
                    println!(
                        "cargo:warning=⚠️ Failed to copy watcher sidecar from {}: {}",
                        candidate_path.display(),
                        e
                    );
                }
            }
        } else {
            println!(
                "cargo:warning=✅ watcher sidecar up-to-date: {}",
                sidecar_path.display()
            );
            return;
        }
    }

    if sidecar_path.exists() {
        println!(
            "cargo:warning=✅ watcher sidecar present (no newer local candidate found): {}",
            sidecar_path.display()
        );
        return;
    }

    println!(
        "cargo:warning=⚠️ watcher sidecar not found at {}. Run apps/desktop/src-tauri/bin/ritual-watcher/build.sh",
        sidecar_path.display()
    );
}

fn main() {
    ensure_watcher_sidecar_for_tauri();
    tauri_build::build();

    println!("cargo:warning=🔨 Building Swift speech recognition library...");

    let swift_files = vec![
        "native-timer/MicrophonePermission.swift",
        "native-timer/SpeechRecognition.swift",
    ];
    let object_files = vec![
        "target/MicrophonePermission.o",
        "target/SpeechRecognition.o",
    ];
    let static_lib = "target/libspeech_native.a";
    let module_cache_dir = "target/swift-module-cache";
    let _ = std::fs::create_dir_all(module_cache_dir);

    // Step 1: Compile Swift files to object files
    let mut all_success = true;

    for (swift_file, object_file) in swift_files.iter().zip(object_files.iter()) {
        println!("cargo:warning=🔨 Compiling {}", swift_file);

        let swift_output = std::process::Command::new("swiftc")
            .args(&[
                "-c",
                "-module-cache-path",
                module_cache_dir,
                "-framework",
                "Cocoa",
                "-framework",
                "Foundation",
                "-framework",
                "AVFoundation",
                "-framework",
                "Speech",
                "-o",
                object_file,
                swift_file,
            ])
            .env("CLANG_MODULE_CACHE_PATH", module_cache_dir)
            .output();

        match swift_output {
            Ok(result) => {
                if !result.status.success() {
                    println!("cargo:warning=❌ Failed to compile {}", swift_file);
                    println!(
                        "cargo:warning=Error: {}",
                        String::from_utf8_lossy(&result.stderr)
                    );
                    all_success = false;
                } else {
                    println!("cargo:warning=✅ Compiled {}", swift_file);
                }
            }
            Err(e) => {
                println!("cargo:warning=❌ swiftc not found or failed: {}", e);
                all_success = false;
            }
        }
    }

    if all_success {
        // Step 2: Create static library
        println!("cargo:warning=🔨 Creating static library...");
        let ar_output = std::process::Command::new("ar")
            .args(&["rcs", static_lib])
            .args(&object_files)
            .output();

        match ar_output {
            Ok(ar_result) => {
                if ar_result.status.success() {
                    println!("cargo:warning=✅ Static library created!");

                    // Step 3: Tell Rust linker about the library
                    let target_dir = std::env::current_dir().unwrap().join("target");
                    println!("cargo:rustc-link-search=native={}", target_dir.display());
                    println!("cargo:rustc-link-lib=static=speech_native");
                    println!("cargo:rustc-link-lib=framework=AVFoundation");
                    println!("cargo:rustc-link-lib=framework=Speech");
                    println!("cargo:rustc-link-lib=framework=Cocoa");
                } else {
                    println!("cargo:warning=❌ Failed to create static library");
                    println!(
                        "cargo:warning=Error: {}",
                        String::from_utf8_lossy(&ar_result.stderr)
                    );
                    all_success = false;
                }
            }
            Err(e) => {
                println!("cargo:warning=❌ Failed to run ar command: {}", e);
                all_success = false;
            }
        }
    }

    if !all_success {
        println!("cargo:warning=⚠️ Swift compilation failed, voice mode will be disabled");
    }
}
