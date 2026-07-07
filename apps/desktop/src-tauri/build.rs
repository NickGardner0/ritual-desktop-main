use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const SYSTEM_AUDIO_MIN_MACOS_VERSION_FILE: &str = "system-audio-min-macos-version.txt";

fn binaries_match(source: &Path, destination: &Path) -> bool {
    let Ok(source_metadata) = fs::metadata(source) else {
        return false;
    };
    let Ok(destination_metadata) = fs::metadata(destination) else {
        return false;
    };

    if source_metadata.len() != destination_metadata.len() {
        return false;
    }

    match (fs::read(source), fs::read(destination)) {
        (Ok(source_bytes), Ok(destination_bytes)) => source_bytes == destination_bytes,
        _ => false,
    }
}

#[cfg(unix)]
fn set_executable_permissions(path: &Path) {
    use std::os::unix::fs::PermissionsExt;

    if let Ok(metadata) = fs::metadata(path) {
        let mut permissions = metadata.permissions();
        permissions.set_mode(0o755);
        let _ = fs::set_permissions(path, permissions);
    }
}

#[cfg(not(unix))]
fn set_executable_permissions(_path: &Path) {}

fn copy_if_different(source: &Path, destination: &Path) -> Result<bool, std::io::Error> {
    if binaries_match(source, destination) {
        set_executable_permissions(destination);
        return Ok(false);
    }

    fs::copy(source, destination)?;
    set_executable_permissions(destination);
    Ok(true)
}

fn ensure_watcher_sidecar_for_tauri() {
    if !running_on_macos_target() {
        println!("cargo:warning=ℹ️ Skipping watcher sidecar preparation for non-macOS target");
        return;
    }

    let manifest_dir = PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR should be set"),
    );
    let target = std::env::var("TARGET").unwrap_or_default();
    if target.is_empty() {
        println!("cargo:warning=⚠️ Unable to determine TARGET for watcher sidecar");
        return;
    }

    let profile = std::env::var("PROFILE").unwrap_or_else(|_| "debug".to_string());
    let sidecar_name = format!("ritual-watcher-{target}");
    let sidecar_dir = manifest_dir.join("binaries");
    let sidecar_path = sidecar_dir.join(&sidecar_name);
    let watcher_manifest = manifest_dir.join("bin/ritual-watcher/Cargo.toml");
    let watcher_target_dir = manifest_dir.join("target/watcher-sidecar-build");
    let cargo_bin = std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_string());

    if let Err(err) = fs::create_dir_all(&sidecar_dir) {
        panic!(
            "Failed to create watcher sidecar directory {}: {}",
            sidecar_dir.display(),
            err
        );
    }

    let mut command = Command::new(cargo_bin);
    command
        .arg("build")
        .arg("--manifest-path")
        .arg(&watcher_manifest)
        .arg("--bin")
        .arg("ritual-watcher")
        .arg("--target")
        .arg(&target)
        .arg("--target-dir")
        .arg(&watcher_target_dir);

    if profile == "release" {
        command.arg("--release");
    }

    let output = command
        .current_dir(&manifest_dir)
        .output()
        .unwrap_or_else(|err| {
            panic!(
                "Failed to invoke cargo build for watcher sidecar using {}: {}",
                watcher_manifest.display(),
                err
            )
        });

    if !output.status.success() {
        panic!(
            "watcher sidecar build failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let built_binary = watcher_target_binary_path(&watcher_target_dir, &target, &profile);
    if !built_binary.exists() {
        panic!(
            "watcher sidecar build completed but {} is missing",
            built_binary.display()
        );
    }

    let copied = copy_if_different(&built_binary, &sidecar_path).unwrap_or_else(|err| {
        panic!(
            "Failed to copy watcher sidecar {} -> {}: {}",
            built_binary.display(),
            sidecar_path.display(),
            err
        )
    });

    if copied {
        println!(
            "cargo:warning=✅ watcher sidecar prepared: {} -> {}",
            built_binary.display(),
            sidecar_path.display()
        );
    } else {
        println!(
            "cargo:warning=ℹ️ watcher sidecar already up to date: {}",
            sidecar_path.display()
        );
    }
}

fn watcher_target_binary_path(target_dir: &Path, target: &str, profile: &str) -> PathBuf {
    target_dir.join(target).join(profile).join("ritual-watcher")
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
    let script_path = manifest_dir.join("../../../scripts/build-native-vision-helper.sh");
    if !script_path.exists() {
        panic!(
            "ritual-vision-helper build script is missing at {}",
            script_path.display()
        );
    }

    let target = std::env::var("TARGET").unwrap_or_default();
    let binaries_dir = manifest_dir.join("binaries");
    let staging_dir = manifest_dir.join("target/vision-helper-build");
    let output = Command::new("bash")
        .arg(&script_path)
        .arg(&target)
        .arg(&staging_dir)
        .current_dir(&manifest_dir)
        .output()
        .unwrap_or_else(|err| panic!("Failed to invoke ritual-vision-helper build script: {err}"));

    if !output.status.success() {
        panic!(
            "ritual-vision-helper build failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let staged_helper_path = staging_dir.join(format!("ritual-vision-helper-{target}"));
    if !staged_helper_path.exists() {
        panic!(
            "ritual-vision-helper build completed but {} is missing",
            staged_helper_path.display()
        );
    }

    if let Err(err) = fs::create_dir_all(&binaries_dir) {
        panic!(
            "Failed to create vision helper binaries directory {}: {}",
            binaries_dir.display(),
            err
        );
    }

    let helper_path = binaries_dir.join(format!("ritual-vision-helper-{target}"));
    let copied = copy_if_different(&staged_helper_path, &helper_path).unwrap_or_else(|err| {
        panic!(
            "Failed to copy vision helper {} -> {}: {}",
            staged_helper_path.display(),
            helper_path.display(),
            err
        )
    });

    if copied {
        println!(
            "cargo:warning=✅ vision helper prepared: {} -> {}",
            staged_helper_path.display(),
            helper_path.display()
        );
    } else {
        println!(
            "cargo:warning=ℹ️ vision helper already up to date: {}",
            helper_path.display()
        );
    }
}

fn ensure_system_audio_helper_for_tauri() {
    if !running_on_macos_target() {
        return;
    }

    let manifest_dir = PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR should be set"),
    );
    let source = manifest_dir.join("native-system-audio").join("main.swift");
    println!("cargo:rerun-if-changed={}", source.display());
    if !source.exists() {
        panic!(
            "Ritual system audio helper source is missing at {}",
            source.display()
        );
    }

    let system_audio_min_macos_version = read_system_audio_min_macos_version(&manifest_dir)
        .expect("system audio minimum macOS version should be configured");

    let helper_dir = manifest_dir
        .parent()
        .expect("src-tauri should have a repository parent")
        .join(".tauri-helper");
    let app_dir = helper_dir.join("Ritual.app");
    let contents_dir = app_dir.join("Contents");
    let macos_dir = contents_dir.join("MacOS");
    fs::create_dir_all(&macos_dir).unwrap_or_else(|err| {
        panic!(
            "Failed to create system audio helper app directory {}: {}",
            macos_dir.display(),
            err
        )
    });

    let executable = macos_dir.join("ritual-system-audio-recorder");
    let mut should_sign = false;
    if !swift_helper_executable_current(&source, &executable) {
        let built = build_universal_swift_executable(
            "system audio helper",
            &manifest_dir,
            &source,
            &executable,
            &system_audio_min_macos_version,
            &[
                "Foundation",
                "AppKit",
                "AVFoundation",
                "CoreAudio",
                "AudioToolbox",
            ],
        );
        if !built {
            panic!(
                "system audio helper could not be built; refusing to ship a fake permission row"
            );
        }
        should_sign = true;
    }

    let plist = contents_dir.join("Info.plist");
    let plist_contents = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>Ritual Audio Capture</string>
  <key>CFBundleExecutable</key>
  <string>ritual-system-audio-recorder</string>
  <key>CFBundleIdentifier</key>
  <string>com.ritual.desktop.audio-capture</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Ritual Audio Capture</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>{system_audio_min_macos_version}</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSAudioCaptureUsageDescription</key>
  <string>Ritual records system audio locally when you include Mac audio in a voice log.</string>
</dict>
</plist>
"#
    );
    if fs::read_to_string(&plist).is_ok_and(|current| current != plist_contents) {
        fs::write(&plist, &plist_contents).unwrap_or_else(|err| {
            panic!(
                "Failed to write system audio helper Info.plist {}: {}",
                plist.display(),
                err
            )
        });
        should_sign = true;
    } else if !plist.exists() {
        fs::write(&plist, &plist_contents).unwrap_or_else(|err| {
            panic!(
                "Failed to write system audio helper Info.plist {}: {}",
                plist.display(),
                err
            )
        });
        should_sign = true;
    }

    if should_sign || has_signing_identity() {
        sign_helper_app(&manifest_dir, &app_dir);
    }
}

fn read_system_audio_min_macos_version(manifest_dir: &Path) -> Option<String> {
    let version_file = manifest_dir.join(SYSTEM_AUDIO_MIN_MACOS_VERSION_FILE);
    println!("cargo:rerun-if-changed={}", version_file.display());
    let version = fs::read_to_string(version_file).ok()?;
    let version = version.trim();
    if version.is_empty() {
        return None;
    }
    Some(version.to_string())
}

fn swift_helper_executable_current(source: &Path, executable: &Path) -> bool {
    if !executable.exists() {
        return false;
    }

    let source_modified = fs::metadata(source)
        .and_then(|metadata| metadata.modified())
        .ok();
    let executable_fresh = source_modified
        .and_then(|source_modified| {
            fs::metadata(executable)
                .and_then(|metadata| metadata.modified())
                .ok()
                .map(|executable_modified| executable_modified >= source_modified)
        })
        .unwrap_or(false);

    executable_fresh && executable_has_arches(executable, &["arm64", "x86_64"])
}

fn executable_has_arches(executable: &Path, required_arches: &[&str]) -> bool {
    let output = Command::new("lipo").arg("-archs").arg(executable).output();
    let Ok(output) = output else {
        return false;
    };
    if !output.status.success() {
        return false;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    required_arches
        .iter()
        .all(|required| stdout.split_whitespace().any(|arch| arch == *required))
}

fn build_universal_swift_executable(
    helper_name: &str,
    manifest_dir: &Path,
    source: &Path,
    executable: &Path,
    macos_version: &str,
    frameworks: &[&str],
) -> bool {
    let Some(executable_name) = executable.file_name().and_then(|name| name.to_str()) else {
        println!("cargo:warning={helper_name} executable path has no file name");
        return false;
    };
    let slice_dir = manifest_dir
        .join("target")
        .join("swift-helper-slices")
        .join(format!("{executable_name}-{}", std::process::id()));
    if let Err(error) = fs::create_dir_all(&slice_dir) {
        println!("cargo:warning={helper_name} slice dir could not be created: {error}");
        return false;
    }

    let mut slices = Vec::new();
    for swift_arch in ["arm64", "x86_64"] {
        let slice = slice_dir.join(format!("{executable_name}-{swift_arch}"));
        let mut command = Command::new("swiftc");
        configure_swift_command(&mut command, manifest_dir, swift_arch, macos_version);
        for framework in frameworks {
            command.arg("-framework").arg(framework);
        }
        let status = command.arg(source).arg("-o").arg(&slice).status();
        if !matches!(status, Ok(status) if status.success()) {
            println!("cargo:warning={helper_name} {swift_arch} slice could not be built");
            let _ = fs::remove_dir_all(&slice_dir);
            return false;
        }
        slices.push(slice);
    }

    let universal = slice_dir.join(format!("{executable_name}-universal"));
    let mut lipo = Command::new("lipo");
    lipo.arg("-create").arg("-output").arg(&universal);
    for slice in &slices {
        lipo.arg(slice);
    }
    let status = lipo.status();
    if !matches!(status, Ok(status) if status.success()) {
        println!("cargo:warning={helper_name} universal binary could not be created");
        let _ = fs::remove_dir_all(&slice_dir);
        return false;
    }

    if let Ok(permissions) = fs::metadata(&slices[0]).map(|metadata| metadata.permissions()) {
        let _ = fs::set_permissions(&universal, permissions);
    }
    if let Err(error) = fs::rename(&universal, executable) {
        println!("cargo:warning={helper_name} universal binary could not be installed: {error}");
        let _ = fs::remove_dir_all(&slice_dir);
        return false;
    }
    let _ = fs::remove_dir_all(&slice_dir);
    true
}

fn configure_swift_command(
    command: &mut Command,
    manifest_dir: &Path,
    swift_arch: &str,
    macos_version: &str,
) {
    command
        .arg("-target")
        .arg(format!("{swift_arch}-apple-macosx{macos_version}"));
    let module_cache = manifest_dir.join("target").join("swift-module-cache");
    fs::create_dir_all(&module_cache).expect("swift module cache dir should be created");
    command.arg("-module-cache-path").arg(module_cache);
}

fn has_signing_identity() -> bool {
    std::env::var("APPLE_SIGNING_IDENTITY")
        .ok()
        .is_some_and(|value| !value.trim().is_empty())
}

fn sign_helper_app(manifest_dir: &Path, app_dir: &Path) {
    let identity = std::env::var("APPLE_SIGNING_IDENTITY")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "-".to_string());
    let entitlements = manifest_dir.join("entitlements.plist");
    let mut command = Command::new("codesign");
    command
        .arg("--force")
        .arg("--deep")
        .arg("--entitlements")
        .arg(entitlements)
        .arg("--sign")
        .arg(&identity);
    if identity != "-" {
        command.arg("--timestamp").arg("--options").arg("runtime");
    }
    let status = command.arg(app_dir).status();
    if !matches!(status, Ok(status) if status.success()) {
        println!(
            "cargo:warning=system audio helper app could not be signed: {}",
            app_dir.display()
        );
    }
}

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=bin/ritual-watcher/Cargo.toml");
    println!("cargo:rerun-if-changed=bin/ritual-watcher/src");
    println!("cargo:rerun-if-changed=crates/ritual-db/Cargo.toml");
    println!("cargo:rerun-if-changed=crates/ritual-db/src");
    println!("cargo:rerun-if-changed=../../../scripts/build-native-vision-helper.sh");
    println!("cargo:rerun-if-changed=native-voice/MicrophonePermission.swift");
    println!("cargo:rerun-if-changed=native-voice/SpeechRecognition.swift");
    println!("cargo:rerun-if-changed=native-voice/VoiceHud.swift");
    println!("cargo:rerun-if-changed=native-system-audio/main.swift");
    println!("cargo:rerun-if-changed=system-audio-min-macos-version.txt");
    println!("cargo:rerun-if-changed=native-vision/VisionOcr.swift");
    println!("cargo:rerun-if-changed=native-vision/main.swift");
    println!("cargo:rerun-if-env-changed=TARGET");

    ensure_watcher_sidecar_for_tauri();
    ensure_vision_helper_for_tauri();
    ensure_system_audio_helper_for_tauri();
    tauri_build::build();

    if !running_on_macos_target() {
        println!("cargo:warning=ℹ️ Skipping Swift native voice build for non-macOS target");
        return;
    }

    println!("cargo:warning=🔨 Building Swift speech recognition library...");

    let swift_files = [
        PathBuf::from("native-voice/MicrophonePermission.swift"),
        PathBuf::from("native-voice/SpeechRecognition.swift"),
        PathBuf::from("native-voice/VoiceHud.swift"),
    ];
    let out_dir = PathBuf::from(std::env::var("OUT_DIR").unwrap());
    let object_files = [
        out_dir.join("MicrophonePermission.o"),
        out_dir.join("SpeechRecognition.o"),
        out_dir.join("VoiceHud.o"),
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

        let swift_output = swift_command.output();

        match swift_output {
            Ok(result) => {
                if !result.status.success() {
                    println!(
                        "cargo:warning=❌ Failed to compile {}",
                        swift_file.display()
                    );
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
