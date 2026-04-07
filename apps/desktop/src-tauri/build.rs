use std::path::PathBuf;
use std::process::Command;
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

fn running_on_macos_target() -> bool {
    std::env::var("TARGET")
        .map(|target| target.contains("apple-darwin"))
        .unwrap_or(false)
}

fn ensure_vision_helper_for_tauri() {
    if !running_on_macos_target() {
        return;
    }

    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let script_path = manifest_dir
        .join("../../../scripts/build-native-vision-helper.sh");
    if !script_path.exists() {
        panic!(
            "ritual-vision-helper build script is missing at {}",
            script_path.display()
        );
    }

    let target = std::env::var("TARGET").unwrap_or_default();
    let binaries_dir = manifest_dir.join("binaries");
    let output = Command::new("bash")
        .arg(&script_path)
        .arg(&target)
        .arg(&binaries_dir)
        .current_dir(&manifest_dir)
        .output()
        .unwrap_or_else(|err| panic!("Failed to invoke ritual-vision-helper build script: {err}"));

    if !output.status.success() {
        panic!(
            "ritual-vision-helper build failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let helper_path = binaries_dir.join(format!("ritual-vision-helper-{target}"));
    if !helper_path.exists() {
        panic!(
            "ritual-vision-helper build completed but {} is missing",
            helper_path.display()
        );
    }

    println!(
        "cargo:warning=✅ vision helper prepared: {}",
        helper_path.display()
    );
}

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=native-voice/MicrophonePermission.swift");
    println!("cargo:rerun-if-changed=native-voice/SpeechRecognition.swift");
    println!("cargo:rerun-if-changed=native-vision/VisionOcr.swift");
    println!("cargo:rerun-if-changed=native-vision/main.swift");
    println!("cargo:rerun-if-env-changed=TARGET");

    ensure_watcher_sidecar_for_tauri();
    ensure_vision_helper_for_tauri();
    tauri_build::build();

    println!("cargo:warning=🔨 Building Swift speech recognition library...");

    let swift_files = [
        PathBuf::from("native-voice/MicrophonePermission.swift"),
        PathBuf::from("native-voice/SpeechRecognition.swift"),
    ];
    let out_dir = PathBuf::from(std::env::var("OUT_DIR").unwrap());
    let object_files = [
        out_dir.join("MicrophonePermission.o"),
        out_dir.join("SpeechRecognition.o"),
    ];
    let static_lib = out_dir.join("libspeech_native.a");
    let module_cache_dir = out_dir.join("swift-module-cache");
    let _ = std::fs::create_dir_all(&module_cache_dir);

    // Step 1: Compile Swift files to object files
    let mut all_success = true;

    for (swift_file, object_file) in swift_files.iter().zip(object_files.iter()) {
        println!("cargo:warning=🔨 Compiling {}", swift_file.display());

        let mut swift_command = std::process::Command::new("swiftc");
        swift_command
            .arg("-c")
            .arg("-module-cache-path")
            .arg(&module_cache_dir)
            .arg("-framework")
            .arg("Cocoa")
            .arg("-framework")
            .arg("Foundation")
            .arg("-framework")
            .arg("AVFoundation")
            .arg("-framework")
            .arg("Speech")
            .arg("-o")
            .arg(object_file)
            .arg(swift_file)
            .env("CLANG_MODULE_CACHE_PATH", &module_cache_dir);

        let swift_output = swift_command
            .output();

        match swift_output {
            Ok(result) => {
                if !result.status.success() {
                    println!("cargo:warning=❌ Failed to compile {}", swift_file.display());
                    println!(
                        "cargo:warning=Error: {}",
                        String::from_utf8_lossy(&result.stderr)
                    );
                    all_success = false;
                } else {
                    println!("cargo:warning=✅ Compiled {}", swift_file.display());
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
        let mut ar_command = std::process::Command::new("ar");
        ar_command.arg("rcs").arg(&static_lib);
        for object_file in &object_files {
            ar_command.arg(object_file);
        }
        let ar_output = ar_command.output();

        match ar_output {
            Ok(ar_result) => {
                if ar_result.status.success() {
                    println!("cargo:warning=✅ Static library created!");

                    // Step 3: Tell Rust linker about the library
                    println!("cargo:rustc-link-search=native={}", out_dir.display());
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
