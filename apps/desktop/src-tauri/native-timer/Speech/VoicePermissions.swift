import AppKit
import AVFoundation
import Speech

/// Consolidated permission checks for microphone and speech recognition.
///
/// The widget runs as an LSUIElement (no Dock icon) and cannot reliably present
/// system permission dialogs. Instead of calling `requestAuthorization`, we
/// check the current status and direct the user to System Settings when needed.
enum VoicePermissions {

    enum Status: CustomStringConvertible {
        case authorized
        case denied
        case notDetermined

        var description: String {
            switch self {
            case .authorized: return "authorized"
            case .denied: return "denied"
            case .notDetermined: return "notDetermined"
            }
        }
    }

    // MARK: - Microphone

    static var microphoneStatus: Status {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return .authorized
        case .denied, .restricted: return .denied
        case .notDetermined: return .notDetermined
        @unknown default: return .denied
        }
    }

    // MARK: - Speech Recognition

    static var speechStatus: Status {
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized: return .authorized
        case .denied, .restricted: return .denied
        case .notDetermined: return .notDetermined
        @unknown default: return .denied
        }
    }

    // MARK: - Combined

    static var allAuthorized: Bool {
        microphoneStatus == .authorized && speechStatus == .authorized
    }

    /// Returns a user-facing message describing which permissions are missing,
    /// or `nil` if all permissions are granted.
    static var missingPermissionMessage: String? {
        let mic = microphoneStatus
        let speech = speechStatus

        if mic == .authorized && speech == .authorized { return nil }

        var parts: [String] = []
        if mic != .authorized { parts.append("Microphone") }
        if speech != .authorized { parts.append("Speech Recognition") }

        let names = parts.joined(separator: " and ")
        let hasDenied = mic == .denied || speech == .denied
        let action = hasDenied
            ? "Enable in System Settings → Privacy & Security"
            : "Grant permission in System Settings → Privacy & Security"

        return "\(names) access required. \(action)."
    }

    // MARK: - Open Settings

    static func openMicrophoneSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone") {
            NSWorkspace.shared.open(url)
        }
    }

    static func openSpeechSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition") {
            NSWorkspace.shared.open(url)
        }
    }

    /// Opens the first relevant Settings pane for whichever permission is missing.
    static func openRelevantSettings() {
        if microphoneStatus != .authorized {
            openMicrophoneSettings()
        } else if speechStatus != .authorized {
            openSpeechSettings()
        }
    }

    // MARK: - One-time Registration

    /// Call once at startup so macOS registers the app in the Privacy lists.
    /// The system dialog may or may not appear (LSUIElement apps are unreliable),
    /// but the app will show up in System Settings for the user to toggle on.
    static func registerWithSystem() {
        if microphoneStatus == .notDetermined {
            AVCaptureDevice.requestAccess(for: .audio) { _ in
                print("🎙️ [Voice] Microphone registration callback received")
            }
        }
        if speechStatus == .notDetermined {
            SFSpeechRecognizer.requestAuthorization { _ in
                print("🎙️ [Voice] Speech recognition registration callback received")
            }
        }
    }
}
