import Foundation
import AVFoundation
import Speech

// Global variables to maintain state
private var audioEngine: AVAudioEngine?
private var request: SFSpeechAudioBufferRecognitionRequest?
private var task: SFSpeechRecognitionTask?
private var recognizer: SFSpeechRecognizer?

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

@_cdecl("start_speech_recognition")
func start_speech_recognition() -> Bool {
    print("🎤 [Swift] start_speech_recognition called")
    
    // Enable speech recognition - call the internal implementation
    return startSpeechRecognitionInternal()
}

private func startSpeechRecognitionInternal() -> Bool {
    print("🎤 [Swift] startSpeechRecognitionInternal called")
    
    do {
        // Stop any existing recognition first
        _ = stop_speech_recognition()
        
        // Initialize recognizer
        recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
        guard let recognizer = recognizer, recognizer.isAvailable else {
            print("❌ [Swift] Speech recognizer not available")
            emitTauriEvent(event: "ritual:speech:error", payload: "recognizer-unavailable")
            return false
        }
        
        // Note: AVAudioSession is iOS-only, not needed on macOS
        // macOS handles audio session management automatically
        
        // Initialize audio engine
        audioEngine = AVAudioEngine()
        guard let audioEngine = audioEngine else {
            print("❌ [Swift] Failed to create audio engine")
            emitTauriEvent(event: "ritual:speech:error", payload: "audio-engine-failed")
            return false
        }
        
        // Create recognition request
        request = SFSpeechAudioBufferRecognitionRequest()
        guard let request = request else {
            print("❌ [Swift] Failed to create speech request")
            emitTauriEvent(event: "ritual:speech:error", payload: "request-failed")
            return false
        }
        
        request.shouldReportPartialResults = true
        
        // Set up audio input with error handling
        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)
        
        // Remove any existing tap first
        inputNode.removeTap(onBus: 0)
        
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { buffer, _ in
            request.append(buffer)
        }
        
        // Start recognition task
        task = recognizer.recognitionTask(with: request) { [weak request] result, error in
            DispatchQueue.main.async {
                if let result = result {
                    let transcript = result.bestTranscription.formattedString
                    print("🎤 [Swift] Transcript: \(transcript)")
                    emitTauriEvent(event: "ritual:speech:partial", payload: transcript)
                    
                    if result.isFinal {
                        print("🎤 [Swift] Final result: \(transcript)")
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
        
        // Start audio engine
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

@_cdecl("stop_speech_recognition")
func stop_speech_recognition() -> Bool {
    print("🎤 [Swift] stop_speech_recognition called")
    
    // Stop audio engine safely
    if let audioEngine = audioEngine, audioEngine.isRunning {
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
    }
    
    // End recognition request
    request?.endAudio()
    
    // Cancel recognition task
    task?.cancel()
    
    // Note: No need to reset audio session on macOS
    // macOS handles audio session management automatically
    
    // Clear references
    audioEngine = nil
    request = nil
    task = nil
    recognizer = nil
    
    print("✅ [Swift] Speech recognition stopped")
    emitTauriEvent(event: "ritual:speech:status", payload: "stopped")
    return true
}
