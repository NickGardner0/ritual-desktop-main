import Cocoa
import AVFoundation
import AVFAudio
import Speech

private func imageFromBundleResource(named name: String) -> NSImage? {
    let rawName = name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !rawName.isEmpty else {
        return nil
    }

    let pathName = rawName as NSString
    let resourceName = pathName.deletingPathExtension
    let resourceExtension = pathName.pathExtension.isEmpty ? "icns" : pathName.pathExtension
    let imageNames = [rawName, resourceName]

    for imageName in imageNames {
        if let image = NSImage(named: NSImage.Name(imageName)), image.isValid {
            return image
        }
    }

    if let path = Bundle.main.path(forResource: resourceName, ofType: resourceExtension),
       let image = NSImage(contentsOfFile: path),
       image.isValid {
        return image
    }

    return nil
}

private func ritualAppIconImage() -> NSImage? {
    if let iconFile = Bundle.main.object(forInfoDictionaryKey: "CFBundleIconFile") as? String,
       let image = imageFromBundleResource(named: iconFile) {
        return image
    }

    for iconName in ["Ritual.icns", "Ritual", "icon.icns", "icon"] {
        if let image = imageFromBundleResource(named: iconName) {
            return image
        }
    }

    if let image = NSApp.applicationIconImage, image.isValid {
        return image
    }

    return NSImage(named: NSImage.applicationIconName)
}

private func usageDescription(for key: String) -> String? {
    (Bundle.main.object(forInfoDictionaryKey: key) as? String)?
        .trimmingCharacters(in: .whitespacesAndNewlines)
}

private func hasUsageDescription(key: String, api: String) -> Bool {
    if let description = usageDescription(for: key), !description.isEmpty {
        return true
    }

    let bundlePath = Bundle.main.bundlePath
    let bundleIdentifier = Bundle.main.bundleIdentifier ?? "nil"
    let executablePath = Bundle.main.executablePath ?? "nil"
    print("❌ [Swift] Cannot call \(api): Bundle.main is missing \(key). bundlePath=\(bundlePath) bundleIdentifier=\(bundleIdentifier) executablePath=\(executablePath)")
    return false
}

private func presentMissingUsageDescriptionAlert(feature: String, infoKey: String) {
    presentVoicePermissionAlert(
        title: "\(feature) unavailable in this build",
        body: "This build is missing \(infoKey) in its app bundle metadata, so macOS will terminate the process if Ritual requests \(feature.lowercased()) access. Use a bundled app build to test voice permissions.",
        settingsURL: "x-apple.systempreferences:com.apple.preference.security"
    )
}

private func resolveMicrophonePermission() -> Bool {
    guard hasUsageDescription(
        key: "NSMicrophoneUsageDescription",
        api: "AVCaptureDevice.requestAccess(for: .audio)"
    ) else {
        return false
    }

    var granted = false
    let semaphore = DispatchSemaphore(value: 0)

    let requestAccess = {
        AVCaptureDevice.requestAccess(for: .audio) { access in
            granted = access
            semaphore.signal()
        }
    }

    if Thread.isMainThread {
        requestAccess()
    } else {
        DispatchQueue.main.async(execute: requestAccess)
    }

    semaphore.wait()
    return granted
}

private func microphonePermissionStatus() -> AVAuthorizationStatus {
    AVCaptureDevice.authorizationStatus(for: .audio)
}

private func hasMicrophonePermission() -> Bool {
    if #available(macOS 14.0, *) {
        return AVAudioApplication.shared.recordPermission == .granted
    }

    return microphonePermissionStatus() == .authorized
}

private func requestMicrophonePermissionIfNeeded() -> Bool {
    let captureStatus = microphonePermissionStatus()

    if captureStatus == .authorized {
        return true
    }

    if captureStatus == .notDetermined {
        return resolveMicrophonePermission()
    }

    if #available(macOS 14.0, *) {
        let status = AVAudioApplication.shared.recordPermission
        switch status {
        case .granted:
            return true
        case .undetermined:
            return resolveMicrophonePermission()
        case .denied:
            return false
        @unknown default:
            return false
        }
    }

    switch captureStatus {
    case .authorized:
        return true
    case .notDetermined:
        return resolveMicrophonePermission()
    case .denied, .restricted:
        return false
    @unknown default:
        return false
    }
}

private func resolveSpeechRecognitionPermission() -> Bool {
    guard hasUsageDescription(
        key: "NSSpeechRecognitionUsageDescription",
        api: "SFSpeechRecognizer.requestAuthorization"
    ) else {
        return false
    }

    var granted = false
    let semaphore = DispatchSemaphore(value: 0)

    SFSpeechRecognizer.requestAuthorization { status in
        granted = status == .authorized
        semaphore.signal()
    }

    semaphore.wait()
    return granted
}

private func speechRecognitionPermissionStatus() -> SFSpeechRecognizerAuthorizationStatus {
    SFSpeechRecognizer.authorizationStatus()
}

private func hasSpeechRecognitionPermission() -> Bool {
    speechRecognitionPermissionStatus() == .authorized
}

private func requestSpeechRecognitionPermissionIfNeeded() -> Bool {
    switch speechRecognitionPermissionStatus() {
    case .authorized:
        return true
    case .notDetermined:
        return resolveSpeechRecognitionPermission()
    case .denied, .restricted:
        return false
    @unknown default:
        return false
    }
}

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

        if let appIcon = ritualAppIconImage() {
            alert.icon = appIcon
        }

        let response = alert.runModal()
        if response == .alertFirstButtonReturn,
           let url = URL(string: settingsURL) {
            NSWorkspace.shared.open(url)
        }
    }
}

@_cdecl("show_ritual_update_install_prompt")
func show_ritual_update_install_prompt(_ versionPtr: UnsafePointer<CChar>?) -> Bool {
    let version = versionPtr.map { String(cString: $0) }?
        .trimmingCharacters(in: .whitespacesAndNewlines)
    let displayVersion = version?.isEmpty == false ? version! : "the latest version"

    var shouldInstall = false
    let showPrompt = {
        let alert = NSAlert()
        alert.alertStyle = .informational
        alert.messageText = "Install Ritual \(displayVersion)?"
        alert.informativeText = "A desktop update is ready. Ritual will relaunch after installation."
        alert.addButton(withTitle: "Install")
        alert.addButton(withTitle: "Later")

        if let appIcon = ritualAppIconImage() {
            alert.icon = appIcon
        }

        shouldInstall = alert.runModal() == .alertFirstButtonReturn
    }

    if Thread.isMainThread {
        showPrompt()
    } else {
        DispatchQueue.main.sync(execute: showPrompt)
    }

    return shouldInstall
}

@_cdecl("show_microphone_permission_dialog")
func show_microphone_permission_dialog() -> Bool {
    guard hasUsageDescription(
        key: "NSMicrophoneUsageDescription",
        api: "AVCaptureDevice.requestAccess(for: .audio)"
    ) else {
        presentMissingUsageDescriptionAlert(
            feature: "Microphone access",
            infoKey: "NSMicrophoneUsageDescription"
        )
        return false
    }

    let granted = requestMicrophonePermissionIfNeeded()
    if granted {
        return true
    }

    presentVoicePermissionAlert(
        title: "Microphone access required",
        body: "You must enable microphone access in your settings for voice recognition features",
        settingsURL: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
    )
    return false
}

@_cdecl("check_microphone_permission")
func check_microphone_permission() -> Bool {
    return hasMicrophonePermission()
}

@_cdecl("show_speech_recognition_permission_dialog")
func show_speech_recognition_permission_dialog() -> Bool {
    guard hasUsageDescription(
        key: "NSSpeechRecognitionUsageDescription",
        api: "SFSpeechRecognizer.requestAuthorization"
    ) else {
        presentMissingUsageDescriptionAlert(
            feature: "Speech recognition",
            infoKey: "NSSpeechRecognitionUsageDescription"
        )
        return false
    }

    let granted = requestSpeechRecognitionPermissionIfNeeded()
    if granted {
        return true
    }

    presentVoicePermissionAlert(
        title: "Speech recognition access required",
        body: "You must enable Speech Recognition access in System Settings for voice logging features.",
        settingsURL: "x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition"
    )
    return false
}

@_cdecl("check_speech_recognition_permission")
func check_speech_recognition_permission() -> Bool {
    return hasSpeechRecognitionPermission()
}
