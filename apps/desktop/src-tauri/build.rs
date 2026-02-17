fn main() {
    tauri_build::build();
    
    println!("cargo:warning=🔨 Building Swift speech recognition library...");
    
    let swift_files = vec![
        "native-timer/MicrophonePermission.swift",
        "native-timer/SpeechRecognition.swift"
    ];
    let object_files = vec![
        "target/MicrophonePermission.o",
        "target/SpeechRecognition.o"
    ];
    let static_lib = "target/libspeech_native.a";
    
    // Step 1: Compile Swift files to object files
    let mut all_success = true;
    
    for (swift_file, object_file) in swift_files.iter().zip(object_files.iter()) {
        println!("cargo:warning=🔨 Compiling {}", swift_file);
        
        let swift_output = std::process::Command::new("swiftc")
            .args(&[
                "-c", 
                "-framework", "Cocoa",
                "-framework", "Foundation", 
                "-framework", "AVFoundation",
                "-framework", "Speech",
                "-o", object_file,
                swift_file
            ])
            .output();
            
        match swift_output {
            Ok(result) => {
                if !result.status.success() {
                    println!("cargo:warning=❌ Failed to compile {}", swift_file);
                    println!("cargo:warning=Error: {}", String::from_utf8_lossy(&result.stderr));
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
                    println!("cargo:warning=Error: {}", String::from_utf8_lossy(&ar_result.stderr));
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