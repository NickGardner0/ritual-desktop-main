import Foundation
import AVFoundation
import Speech

// Global variables to maintain state
private var audioEngine: AVAudioEngine?
private var request: SFSpeechAudioBufferRecognitionRequest?
private var task: SFSpeechRecognitionTask?
private var recognizer: SFSpeechRecognizer?
private var currentTranscript = ""
private var finalTranscriptEmitted = false

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
    print("🎤 [Swift] Emitting event: \(event) with payload: \(payload)")
    
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
    var granted = false
    let semaphore = DispatchSemaphore(value: 0)

    DispatchQueue.main.async {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            granted = true
            semaphore.signal()
        case .denied, .restricted:
            granted = false
            semaphore.signal()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .audio) { access in
                granted = access
                semaphore.signal()
            }
        @unknown default:
            granted = false
            semaphore.signal()
        }
    }

    semaphore.wait()
    return granted
}

private func requestSpeechPermissionIfNeeded() -> Bool {
    var granted = false
    let semaphore = DispatchSemaphore(value: 0)

    DispatchQueue.main.async {
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized:
            granted = true
            semaphore.signal()
        case .denied, .restricted:
            granted = false
            semaphore.signal()
        case .notDetermined:
            SFSpeechRecognizer.requestAuthorization { status in
                granted = (status == .authorized)
                semaphore.signal()
            }
        @unknown default:
            granted = false
            semaphore.signal()
        }
    }

    semaphore.wait()
    return granted
}

@_cdecl("start_speech_recognition")
func start_speech_recognition() -> Bool {
    print("🎤 [Swift] start_speech_recognition called")
    
    // Enable speech recognition - call the internal implementation
    return startSpeechRecognitionInternal()
}

private func startSpeechRecognitionInternal() -> Bool {
    print("🎤 [Swift] startSpeechRecognitionInternal called")

    return runOnMainThread {
        do {
            // Stop any existing recognition first
            _ = stop_speech_recognition()
            resetSpeechState()

            guard requestSpeechPermissionIfNeeded() else {
                print("❌ [Swift] Speech recognition permission unavailable")
                emitTauriEvent(event: "ritual:speech:error", payload: "speech-permission-denied")
                return false
            }

            guard requestMicrophonePermissionIfNeeded() else {
                print("❌ [Swift] Microphone permission unavailable")
                emitTauriEvent(event: "ritual:speech:error", payload: "microphone-permission-denied")
                return false
            }

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
                        print("🎤 [Swift] Transcript: \(transcript)")
                        emitTauriEvent(event: "ritual:speech:partial", payload: transcript)

                        if result.isFinal {
                            print("🎤 [Swift] Final result: \(transcript)")
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
            print("✅ [Swift] Speech recognition started successfully")
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
    print("🎤 [Swift] stop_speech_recognition called")

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

        request?.endAudio()
        task?.cancel()

        audioEngine = nil
        request = nil
        task = nil
        recognizer = nil

        print("✅ [Swift] Speech recognition stopped")
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
