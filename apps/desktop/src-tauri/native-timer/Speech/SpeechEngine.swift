import Foundation
import AVFoundation
import Speech

/// Self-contained speech recognition engine for the widget process.
/// Uses `SFSpeechRecognizer` + `AVAudioEngine`.
@MainActor
final class SpeechEngine: ObservableObject {

    @Published private(set) var isListening = false
    @Published private(set) var partialTranscript = ""
    @Published private(set) var audioLevel: Float = 0
    @Published private(set) var audioLevels: [Float] = Array(repeating: 0, count: 32)
    private var smoothedLevel: Float = 0

    var onFinalTranscript: ((String) -> Void)?
    var onError: ((String) -> Void)?

    /// Auto-stop after this many seconds of silence once speech has been detected.
    var silenceTimeout: TimeInterval = 1.5

    private var audioEngine: AVAudioEngine?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))

    private var hasSpeechStarted = false
    private var silenceTimer: Timer?
    private let speechThreshold: Float = 0.15

    func startListening() {
        guard !isListening else { return }
        guard let recognizer, recognizer.isAvailable else {
            onError?("Speech recognizer unavailable")
            return
        }

        do {
            try prepareAudioEngine()
        } catch {
            onError?("Audio engine failed: \(error.localizedDescription)")
            return
        }

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        recognitionRequest = request

        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            Task { @MainActor [weak self] in
                guard let self, self.isListening else { return }
                if let result {
                    self.partialTranscript = result.bestTranscription.formattedString
                    if result.isFinal {
                        let transcript = result.bestTranscription.formattedString
                        self.stopListening()
                    }
                }
                if let error, self.isListening {
                    self.stopListening()
                    self.onError?("Recognition error: \(error.localizedDescription)")
                }
            }
        }

        isListening = true
        partialTranscript = ""
        hasSpeechStarted = false
        silenceTimer?.invalidate()
        silenceTimer = nil
    }

    func stopListening() {
        guard isListening else { return }
        let transcript = partialTranscript
        isListening = false

        silenceTimer?.invalidate()
        silenceTimer = nil
        hasSpeechStarted = false

        if let audioEngine, audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }

        recognitionRequest?.endAudio()
        recognitionTask?.cancel()

        audioEngine = nil
        recognitionRequest = nil
        recognitionTask = nil
        audioLevel = 0
        audioLevels = Array(repeating: 0, count: 32)

        onFinalTranscript?(transcript)
    }

    /// Force-cancel without waiting for a final result.
    func cancel() {
        isListening = false

        silenceTimer?.invalidate()
        silenceTimer = nil
        hasSpeechStarted = false

        if let audioEngine, audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }

        recognitionRequest?.endAudio()
        recognitionTask?.cancel()

        audioEngine = nil
        recognitionRequest = nil
        recognitionTask = nil
        partialTranscript = ""
        audioLevel = 0
        audioLevels = Array(repeating: 0, count: 32)
    }

    // MARK: - Private

    private func prepareAudioEngine() throws {
        let engine = AVAudioEngine()
        let inputNode = engine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)

        inputNode.removeTap(onBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { [weak self] buffer, _ in
            self?.recognitionRequest?.append(buffer)

            let barCount = 32
            let levels = Self.perBarLevels(buffer: buffer, barCount: barCount)
            let peak = levels.max() ?? 0

            Task { @MainActor [weak self] in
                guard let self, self.isListening else { return }
                self.audioLevels = levels
                let attack: Float = 0.5
                let release: Float = 0.12
                let alpha = peak > self.smoothedLevel ? attack : release
                self.smoothedLevel = alpha * peak + (1 - alpha) * self.smoothedLevel
                self.audioLevel = self.smoothedLevel

                self.updateSilenceDetection(peak: peak)
            }
        }

        engine.prepare()
        try engine.start()
        audioEngine = engine
    }

    // MARK: - Silence Detection

    private func updateSilenceDetection(peak: Float) {
        let isSpeaking = peak > speechThreshold

        if isSpeaking {
            hasSpeechStarted = true
            silenceTimer?.invalidate()
            silenceTimer = nil
            return
        }

        guard hasSpeechStarted, !partialTranscript.isEmpty else { return }

        if silenceTimer == nil {
            silenceTimer = Timer.scheduledTimer(withTimeInterval: silenceTimeout, repeats: false) { [weak self] _ in
                Task { @MainActor [weak self] in
                    guard let self, self.isListening else { return }
                    self.stopListening()
                }
            }
        }
    }

    private static func perBarLevels(buffer: AVAudioPCMBuffer, barCount: Int) -> [Float] {
        guard let data = buffer.floatChannelData else {
            return Array(repeating: 0, count: barCount)
        }
        let count = Int(buffer.frameLength)
        guard count > 0 else {
            return Array(repeating: 0, count: barCount)
        }

        let step = max(1, count / barCount)
        var levels = [Float]()
        levels.reserveCapacity(barCount)

        for i in 0..<barCount {
            let start = i * step
            let end = min(start + step, count)
            var sumSquares: Float = 0
            for j in start..<end {
                let sample = data[0][j]
                sumSquares += sample * sample
            }
            let rms = sqrtf(sumSquares / Float(end - start))

            // Convert to decibel scale for dramatic visual range.
            // Typical speech RMS is 0.005–0.15; linear scaling looks flat.
            // dB mapping: -60 dB (silence) → 0.0, 0 dB (max) → 1.0
            let db = 20.0 * log10f(max(rms, 1e-6))
            let normalized = (db + 60.0) / 55.0   // maps -60..-5 dB → 0..1
            let height = min(1.0, max(0.0, normalized))
            levels.append(height)
        }
        return levels
    }
}
