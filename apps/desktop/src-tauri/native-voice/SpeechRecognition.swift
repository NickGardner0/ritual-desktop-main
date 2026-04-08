import Foundation
import AVFoundation
import AVFAudio
import Speech

// Global variables to maintain state
private var audioEngine: AVAudioEngine?
private var request: SFSpeechAudioBufferRecognitionRequest?
private var task: SFSpeechRecognitionTask?
private var recognizer: SFSpeechRecognizer?
private var currentTranscript = ""
private var finalTranscriptEmitted = false

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

private func runOnMainThread<T>(_ block: @escaping () -> T) -> T {
    if Thread.isMainThread {
        return block()
    }

    let semaphore = DispatchSemaphore(value: 0)
    var result: T? = nil
    DispatchQueue.main.async {
        result = block()
        semaphore.signal()
    }
    semaphore.wait()
    return result!
}

// Helper function to emit events to Tauri frontend
private func emitTauriEvent(event: String, payload: String) {
    // Create a simple callback mechanism by storing the transcript
    // The Rust side can poll for this data
    let userDefaults = UserDefaults.standard
    userDefaults.set(payload, forKey: "speech_transcript")
    userDefaults.set(event, forKey: "speech_event")
    userDefaults.set(Date().timeIntervalSince1970, forKey: "speech_timestamp")
}

private func resetSpeechState() {
    currentTranscript = ""
    finalTranscriptEmitted = false
    clear_speech_state()
}

private func requestMicrophonePermissionIfNeeded() -> Bool {
    guard hasUsageDescription(
        key: "NSMicrophoneUsageDescription",
        api: "AVCaptureDevice.requestAccess(for: .audio)"
    ) else {
        return false
    }

    let captureStatus = AVCaptureDevice.authorizationStatus(for: .audio)

    if captureStatus == .authorized {
        return true
    }

    if captureStatus == .notDetermined {
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

    if #available(macOS 14.0, *) {
        let status = AVAudioApplication.shared.recordPermission
        switch status {
        case .granted:
            return true
        case .undetermined:
            var granted = false
            let semaphore = DispatchSemaphore(value: 0)

            AVAudioApplication.requestRecordPermission { access in
                granted = access
                semaphore.signal()
            }

            semaphore.wait()
            return granted
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
        return false
    case .denied, .restricted:
        return false
    @unknown default:
        return false
    }
}

private func requestSpeechPermissionIfNeeded() -> Bool {
    guard hasUsageDescription(
        key: "NSSpeechRecognitionUsageDescription",
        api: "SFSpeechRecognizer.requestAuthorization"
    ) else {
        return false
    }

    let status = SFSpeechRecognizer.authorizationStatus()

    switch status {
    case .authorized:
        return true
    case .notDetermined:
        var granted = false
        let semaphore = DispatchSemaphore(value: 0)

        SFSpeechRecognizer.requestAuthorization { resolvedStatus in
            granted = resolvedStatus == .authorized
            semaphore.signal()
        }

        semaphore.wait()
        return granted
    case .denied, .restricted:
        return false
    @unknown default:
        return false
    }
}

@_cdecl("start_speech_recognition")
func start_speech_recognition() -> Bool {
    // Enable speech recognition - call the internal implementation
    return startSpeechRecognitionInternal()
}

private func startSpeechRecognitionInternal() -> Bool {
    guard hasUsageDescription(
        key: "NSSpeechRecognitionUsageDescription",
        api: "SFSpeechRecognizer.requestAuthorization"
    ) else {
        print("❌ [Swift] Speech recognition usage description missing")
        emitTauriEvent(event: "ritual:speech:error", payload: "speech-usage-description-missing")
        return false
    }

    guard hasUsageDescription(
        key: "NSMicrophoneUsageDescription",
        api: "AVCaptureDevice.requestAccess(for: .audio)"
    ) else {
        print("❌ [Swift] Microphone usage description missing")
        emitTauriEvent(event: "ritual:speech:error", payload: "microphone-usage-description-missing")
        return false
    }

    // Request privacy permissions before entering the main-thread setup block.
    // Blocking the main thread here can suppress the system TCC prompt.
    guard requestSpeechPermissionIfNeeded() else {
        emitTauriEvent(event: "ritual:speech:error", payload: "speech-permission-denied")
        return false
    }

    guard requestMicrophonePermissionIfNeeded() else {
        emitTauriEvent(event: "ritual:speech:error", payload: "microphone-permission-denied")
        return false
    }

    return runOnMainThread {
        do {
            // Stop any existing recognition first
            _ = stop_speech_recognition()
            resetSpeechState()

            recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
            guard let recognizer = recognizer, recognizer.isAvailable else {
                print("❌ [Swift] Speech recognizer not available")
                emitTauriEvent(event: "ritual:speech:error", payload: "recognizer-unavailable")
                return false
            }

            audioEngine = AVAudioEngine()
            guard let audioEngine = audioEngine else {
                print("❌ [Swift] Failed to create audio engine")
                emitTauriEvent(event: "ritual:speech:error", payload: "audio-engine-failed")
                return false
            }

            request = SFSpeechAudioBufferRecognitionRequest()
            guard let request = request else {
                print("❌ [Swift] Failed to create speech request")
                emitTauriEvent(event: "ritual:speech:error", payload: "request-failed")
                return false
            }

            request.shouldReportPartialResults = true

            // Prefer server-side recognition for better accuracy (falls back to on-device if offline)
            if #available(macOS 13, *) {
                request.requiresOnDeviceRecognition = false
            }

            // Contextual hints to bias recognition toward Ritual vocabulary
            if #available(macOS 14, *) {
                request.contextualStrings = [
                    "pages", "caffeine", "milligrams", "mg", "steps", "miles",
                    "hours", "minutes", "workout", "sleep", "reading", "read",
                    "nicotine", "spending", "dollars", "heart rate", "BPM",
                    "coding", "screen time", "computer time", "walked", "walking",
                    "coffee", "espresso", "tea", "ran", "running", "biked",
                    "logged", "consumed", "drank", "ate", "slept", "woke",
                ]
            }

            let inputNode = audioEngine.inputNode
            let recordingFormat = inputNode.outputFormat(forBus: 0)
            inputNode.removeTap(onBus: 0)
            inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { buffer, _ in
                request.append(buffer)
            }

            task = recognizer.recognitionTask(with: request) { [weak request] result, error in
                DispatchQueue.main.async {
                    if let result = result {
                        let transcript = result.bestTranscription.formattedString
                        currentTranscript = transcript
                        emitTauriEvent(event: "ritual:speech:partial", payload: transcript)

                        if result.isFinal {
                            finalTranscriptEmitted = true
                            emitTauriEvent(event: "ritual:speech:final", payload: transcript)
                            _ = stop_speech_recognition()
                        }
                    }

                    if let error = error {
                        print("❌ [Swift] Speech recognition error: \(error)")
                        emitTauriEvent(event: "ritual:speech:error", payload: "recognition-error: \(error.localizedDescription)")
                        _ = stop_speech_recognition()
                    }
                }
            }

            audioEngine.prepare()
            try audioEngine.start()
            emitTauriEvent(event: "ritual:speech:status", payload: "started")
            return true
        } catch {
            print("❌ [Swift] Failed to start speech recognition: \(error)")
            emitTauriEvent(event: "ritual:speech:error", payload: "startup-failed: \(error.localizedDescription)")
            _ = stop_speech_recognition()
            return false
        }
    }
}

@_cdecl("stop_speech_recognition")
func stop_speech_recognition() -> Bool {
    return runOnMainThread {
        let transcript = currentTranscript.trimmingCharacters(in: .whitespacesAndNewlines)
        var emittedFinalOnStop = false
        if !transcript.isEmpty && !finalTranscriptEmitted {
            finalTranscriptEmitted = true
            emittedFinalOnStop = true
            emitTauriEvent(event: "ritual:speech:final", payload: transcript)
        }

        if let audioEngine = audioEngine, audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }

        // Signal end of audio — let the recognition task finish naturally for
        // a more accurate final result instead of cancelling mid-recognition.
        request?.endAudio()

        // We already emitted the final transcript above, so cancel the task
        // promptly — no need to wait for additional recognition cycles.
        let capturedTask = task
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            capturedTask?.cancel()
        }

        audioEngine = nil
        request = nil
        task = nil
        recognizer = nil

        if !emittedFinalOnStop && !finalTranscriptEmitted {
            emitTauriEvent(event: "ritual:speech:status", payload: "stopped")
        }
        return true
    }
}

@_cdecl("get_speech_state_json")
func get_speech_state_json() -> UnsafeMutablePointer<CChar>? {
    let userDefaults = UserDefaults.standard
    let payload: [String: Any] = [
        "event": userDefaults.string(forKey: "speech_event") ?? "",
        "transcript": userDefaults.string(forKey: "speech_transcript") ?? "",
        "timestamp": userDefaults.double(forKey: "speech_timestamp"),
    ]

    guard let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
          let json = String(data: data, encoding: .utf8) else {
        return strdup("{\"event\":\"\",\"transcript\":\"\",\"timestamp\":0}")
    }

    return strdup(json)
}

@_cdecl("clear_speech_state")
func clear_speech_state() {
    let userDefaults = UserDefaults.standard
    userDefaults.removeObject(forKey: "speech_transcript")
    userDefaults.removeObject(forKey: "speech_event")
    userDefaults.removeObject(forKey: "speech_timestamp")
}

@_cdecl("free_swift_c_string")
func free_swift_c_string(_ ptr: UnsafeMutablePointer<CChar>?) {
    guard let ptr else { return }
    free(ptr)
}
