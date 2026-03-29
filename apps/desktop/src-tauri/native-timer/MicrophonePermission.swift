import Cocoa
import AVFoundation
import Speech

private func presentVoicePermissionAlert(
    title: String,
    body: String,
    settingsURL: String
) {
    DispatchQueue.main.async {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = body
        alert.addButton(withTitle: "Open System Settings")
        alert.addButton(withTitle: "OK")

        if let appIcon = NSApp.applicationIconImage {
            alert.icon = appIcon
        }

        let response = alert.runModal()
        if response == .alertFirstButtonReturn,
           let url = URL(string: settingsURL) {
            NSWorkspace.shared.open(url)
        }
    }
}

@_cdecl("show_microphone_permission_dialog")
func show_microphone_permission_dialog() -> Bool {
    print("🎤 [Swift] show_microphone_permission_dialog called")
    
    // First, actually request microphone access to add the app to the permissions list
    var granted = false
    let semaphore = DispatchSemaphore(value: 0)

    // Ensure we're on the main thread for the permission request
    DispatchQueue.main.async {
        print("🎤 [Swift] About to call AVCaptureDevice.requestAccess")
        
        // Check current authorization status first
        let authStatus = AVCaptureDevice.authorizationStatus(for: .audio)
        print("🎤 [Swift] Current auth status: \(authStatus.rawValue)")
        
        switch authStatus {
        case .authorized:
            print("✅ Already authorized!")
            granted = true
            semaphore.signal()
            return
        case .notDetermined:
            print("🎤 [Swift] Permission not determined, requesting...")
            
            // Try to create an actual audio session to force registration
            do {
                print("🎤 [Swift] Attempting to create audio capture session...")
                let captureSession = AVCaptureSession()
                
                // Try to get the default audio input device
                guard let audioDevice = AVCaptureDevice.default(for: .audio) else {
                    print("🎤 [Swift] No audio device found")
                    granted = false
                    semaphore.signal()
                    return
                }
                
                let audioInput = try AVCaptureDeviceInput(device: audioDevice)
                captureSession.addInput(audioInput)
                
                print("🎤 [Swift] Audio capture session created successfully - this should register the app!")
                
                // Now request permission normally
                AVCaptureDevice.requestAccess(for: .audio) { grantedAccess in
                print("🎤 AVCaptureDevice.requestAccess result: \(grantedAccess)")
                
                if grantedAccess {
                    // Permission granted immediately
                    print("✅ Microphone permission granted!")
                    granted = true
                    semaphore.signal()
                } else {
                    // Permission denied or needs manual approval
                    print("❌ Microphone permission denied, showing custom dialog")
                    
                    // Show our custom dialog to guide the user
                    DispatchQueue.main.async {
                        print("🎤 [Swift] Creating NSAlert dialog")
                        
                        let alert = NSAlert()
                        alert.messageText = "Microphone access required"
                        alert.informativeText = "You must enable microphone access in your settings for voice recognition features"
                        alert.addButton(withTitle: "Open System Settings") // Default button
                        alert.addButton(withTitle: "OK") // Alternate button

                        // Set the icon to the app's icon
                        if let appIcon = NSApp.applicationIconImage {
                            alert.icon = appIcon
                            print("🎤 [Swift] App icon set successfully")
                        } else {
                            print("🎤 [Swift] No app icon available")
                        }

                        print("🎤 [Swift] About to show NSAlert dialog")
                        let response = alert.runModal()
                        print("🎤 [Swift] NSAlert response: \(response.rawValue)")

                        if response == .alertFirstButtonReturn { // "Open System Settings"
                            print("🎤 [Swift] User clicked 'Open System Settings'")
                            if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone") {
                                NSWorkspace.shared.open(url)
                                print("🎤 [Swift] Opened System Settings")
                            } else {
                                print("🎤 [Swift] Failed to create System Settings URL")
                            }
                        } else {
                            print("🎤 [Swift] User clicked 'OK' or dismissed dialog")
                        }
                        
                        // Return false since user needs to manually enable
                        granted = false
                        semaphore.signal()
                    }
                }
            }
            } catch {
                print("🎤 [Swift] Failed to create audio capture session: \(error)")
                // Fall back to just requesting permission
                AVCaptureDevice.requestAccess(for: .audio) { grantedAccess in
                    print("🎤 AVCaptureDevice.requestAccess result (fallback): \(grantedAccess)")
                    
                    if grantedAccess {
                        print("✅ Microphone permission granted!")
                        granted = true
                        semaphore.signal()
                    } else {
                        print("❌ Microphone permission denied, showing custom dialog")
                        
                        DispatchQueue.main.async {
                            print("🎤 [Swift] Creating NSAlert dialog (fallback)")
                            
                            let alert = NSAlert()
                            alert.messageText = "Microphone access required"
                            alert.informativeText = "You must enable microphone access in your settings for voice recognition features"
                            alert.addButton(withTitle: "Open System Settings")
                            alert.addButton(withTitle: "OK")

                            if let appIcon = NSApp.applicationIconImage {
                                alert.icon = appIcon
                            }

                            let response = alert.runModal()

                            if response == .alertFirstButtonReturn {
                                if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone") {
                                    NSWorkspace.shared.open(url)
                                }
                            }
                            
                            granted = false
                            semaphore.signal()
                        }
                    }
                }
            }
        case .denied, .restricted:
            print("🎤 [Swift] Permission previously denied/restricted, showing custom dialog")
            // Permission was previously denied, show custom dialog
            DispatchQueue.main.async {
                print("🎤 [Swift] Creating NSAlert dialog")
                
                let alert = NSAlert()
                alert.messageText = "Microphone access required"
                alert.informativeText = "You must enable microphone access in your settings for voice recognition features"
                alert.addButton(withTitle: "Open System Settings") // Default button
                alert.addButton(withTitle: "OK") // Alternate button

                // Set the icon to the app's icon
                if let appIcon = NSApp.applicationIconImage {
                    alert.icon = appIcon
                    print("🎤 [Swift] App icon set successfully")
                } else {
                    print("🎤 [Swift] No app icon available")
                }

                print("🎤 [Swift] About to show NSAlert dialog")
                let response = alert.runModal()
                print("🎤 [Swift] NSAlert response: \(response.rawValue)")

                if response == .alertFirstButtonReturn { // "Open System Settings"
                    print("🎤 [Swift] User clicked 'Open System Settings'")
                    if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone") {
                        NSWorkspace.shared.open(url)
                        print("🎤 [Swift] Opened System Settings")
                    } else {
                        print("🎤 [Swift] Failed to create System Settings URL")
                    }
                } else {
                    print("🎤 [Swift] User clicked 'OK' or dismissed dialog")
                }
                
                // Return false since user needs to manually enable
                granted = false
                semaphore.signal()
            }
        @unknown default:
            print("🎤 [Swift] Unknown authorization status")
            granted = false
            semaphore.signal()
        }
    }

    print("🎤 [Swift] Waiting for permission result...")
    semaphore.wait()
    print("🎤 [Swift] Returning granted: \(granted)")
    return granted
}

@_cdecl("check_microphone_permission")
func check_microphone_permission() -> Bool {
    var hasPermission = false
    let semaphore = DispatchSemaphore(value: 0)

    DispatchQueue.main.async {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            hasPermission = true
        case .notDetermined:
            // Request permission if not determined, but don't block
            AVCaptureDevice.requestAccess(for: .audio) { grantedAccess in
                hasPermission = grantedAccess
                semaphore.signal()
            }
            return // Don't signal yet, wait for requestAccess callback
        case .denied, .restricted:
            hasPermission = false
        @unknown default:
            hasPermission = false
        }
        semaphore.signal()
    }

    semaphore.wait()
    return hasPermission
}

@_cdecl("show_speech_recognition_permission_dialog")
func show_speech_recognition_permission_dialog() -> Bool {
    print("🎤 [Swift] show_speech_recognition_permission_dialog called")

    var granted = false
    let semaphore = DispatchSemaphore(value: 0)

    DispatchQueue.main.async {
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized:
            granted = true
            semaphore.signal()
        case .notDetermined:
            SFSpeechRecognizer.requestAuthorization { status in
                let allowed = status == .authorized
                print("🎤 [Swift] Speech recognition auth result: \(status.rawValue)")
                if allowed {
                    granted = true
                    semaphore.signal()
                } else {
                    presentVoicePermissionAlert(
                        title: "Speech recognition access required",
                        body: "You must enable Speech Recognition access in System Settings for voice logging features.",
                        settingsURL: "x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition"
                    )
                    granted = false
                    semaphore.signal()
                }
            }
        case .denied, .restricted:
            presentVoicePermissionAlert(
                title: "Speech recognition access required",
                body: "You must enable Speech Recognition access in System Settings for voice logging features.",
                settingsURL: "x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition"
            )
            granted = false
            semaphore.signal()
        @unknown default:
            granted = false
            semaphore.signal()
        }
    }

    semaphore.wait()
    return granted
}

@_cdecl("check_speech_recognition_permission")
func check_speech_recognition_permission() -> Bool {
    switch SFSpeechRecognizer.authorizationStatus() {
    case .authorized:
        return true
    case .denied, .restricted, .notDetermined:
        return false
    @unknown default:
        return false
    }
}
