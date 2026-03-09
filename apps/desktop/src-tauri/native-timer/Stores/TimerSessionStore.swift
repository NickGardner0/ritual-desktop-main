import Foundation
import Combine
import AVFoundation

/// Appends a timestamped line to ~/.ritual/widget.log for debugging.
/// Useful because stdout is not visible when the widget is launched via `open`.
func widgetLog(_ message: String) {
    let ts = ISO8601DateFormatter().string(from: Date())
    let line = "[\(ts)] \(message)\n"
    print(line, terminator: "")  // also print for bare-binary launches
    let logDir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".ritual")
    try? FileManager.default.createDirectory(at: logDir, withIntermediateDirectories: true)
    let logFile = logDir.appendingPathComponent("widget.log")
    if let fh = try? FileHandle(forWritingTo: logFile) {
        fh.seekToEndOfFile()
        fh.write(line.data(using: .utf8) ?? Data())
        fh.closeFile()
    } else {
        try? line.data(using: .utf8)?.write(to: logFile)
    }
}

// Matches the two-oscillator chime from the dashboard Web Audio API.
private var _chimeEngine: AVAudioEngine?
private var _chimePlayer: AVAudioPlayerNode?

func playSuccessChime() {
    let sampleRate: Double = 44100
    let duration: Double = 0.6
    let frameCount = AVAudioFrameCount(sampleRate * duration)

    guard let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1),
          let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount),
          let samples = buffer.floatChannelData?[0] else { return }

    buffer.frameLength = frameCount

    let freq1 = 523.25 // C5
    let freq2 = 659.25 // E5
    let twoPi = 2.0 * Double.pi

    for i in 0..<Int(frameCount) {
        let t = Double(i) / sampleRate
        let gain: Double
        if t < 0.1 {
            gain = 0.5 * (t / 0.1)
        } else {
            gain = 0.5 * exp(-(t - 0.1) * 12.4)
        }
        let sample = gain * (sin(twoPi * freq1 * t) + sin(twoPi * freq2 * t)) / 2.0
        samples[i] = Float(sample)
    }

    let engine = AVAudioEngine()
    let player = AVAudioPlayerNode()
    engine.attach(player)
    engine.connect(player, to: engine.mainMixerNode, format: format)

    do {
        try engine.start()
        _chimeEngine = engine
        _chimePlayer = player
        player.scheduleBuffer(buffer)
        player.play()

        DispatchQueue.main.asyncAfter(deadline: .now() + duration + 0.15) { [weak engine, weak player] in
            player?.stop()
            engine?.stop()
        }
    } catch {
        widgetLog("playSuccessChime: \(error.localizedDescription)")
    }
}

@MainActor
final class TimerSessionStore: ObservableObject {
    struct Habit: Identifiable, Equatable {
        let id: String
        let name: String
        let iconSystemName: String
    }

    private struct PersistedHabit: Codable {
        let id: String
        let name: String
        let iconSystemName: String
    }

    private struct PersistedSession: Codable {
        let activeHabitID: String?
        let isRunning: Bool
        let startedAt: Date?
        let accumulated: TimeInterval
    }

    @Published private(set) var habits: [Habit] = []
    @Published var activeHabitID: String?
    @Published private(set) var isRunning: Bool = false
    @Published private(set) var startedAt: Date?
    @Published private(set) var accumulated: TimeInterval = 0
    @Published private(set) var now: Date = Date()
    @Published var statusOverride: String?
    @Published private(set) var isLogging: Bool = false
    @Published private(set) var lastHabitSyncSucceeded: Bool = false

    // MARK: - Voice State

    @Published var voiceMode: VoiceMode = .inactive

    // MARK: - Voice Settings

    @Published var holdCommandEnabled: Bool {
        didSet { UserDefaults.standard.set(holdCommandEnabled, forKey: Keys.holdCommand) }
    }
    @Published var confirmBeforeLog: Bool {
        didSet { UserDefaults.standard.set(confirmBeforeLog, forKey: Keys.confirmLog) }
    }
    @Published var fallbackHotkeyEnabled: Bool {
        didSet { UserDefaults.standard.set(fallbackHotkeyEnabled, forKey: Keys.fallbackHotkey) }
    }
    @Published var selectedHotkey: VoiceHotkeyOption {
        didSet {
            UserDefaults.standard.set(selectedHotkey.rawValue, forKey: Keys.selectedHotkey)
            writeHotkeySettingsFile()
        }
    }
    var onHotkeyChanged: ((VoiceHotkeyOption) -> Void)?

    private enum Keys {
        static let holdCommand = "ritual.notch.voice.holdCommandEnabled"
        static let confirmLog = "ritual.notch.voice.confirmBeforeLog"
        static let fallbackHotkey = "ritual.notch.voice.fallbackHotkeyEnabled"
        static let selectedHotkey = "ritual.notch.voice.selectedHotkey"
    }

    private let persistenceKey = "ritual.notch.timer.session.v1"
    private let habitsPersistenceKey = "ritual.notch.timer.habits.v1"
    private var ticker: Timer?
    private var habitsRefreshTicker: Timer?

    init() {
        let defaults = UserDefaults.standard
        self.holdCommandEnabled = defaults.object(forKey: Keys.holdCommand) as? Bool ?? true
        self.confirmBeforeLog = defaults.object(forKey: Keys.confirmLog) as? Bool ?? true
        self.fallbackHotkeyEnabled = defaults.object(forKey: Keys.fallbackHotkey) as? Bool ?? true

        if let raw = defaults.string(forKey: Keys.selectedHotkey),
           let option = VoiceHotkeyOption(rawValue: raw) {
            self.selectedHotkey = option
        } else {
            self.selectedHotkey = Self.readHotkeyFromSettingsFile() ?? .cmdShiftL
        }

        restoreSession()
        restoreHabits()
        configureTickerIfNeeded()
        configureHabitsRefreshTicker()
        installSettingsFileWatcher()
        Task { await loadHabits(force: true) }
    }

    deinit {
        ticker?.invalidate()
        habitsRefreshTicker?.invalidate()
    }

    var selectedHabit: Habit? {
        guard let activeHabitID else { return habits.first }
        return habits.first(where: { $0.id == activeHabitID }) ?? habits.first
    }

    var selectedHabitName: String {
        selectedHabit?.name ?? "Focus"
    }

    var selectedHabitShortName: String {
        let full = selectedHabitName
        if full.count <= 16 {
            return full
        }
        return String(full.prefix(15)) + "…"
    }

    var elapsedSeconds: Int {
        let dynamic = isRunning ? now.timeIntervalSince(startedAt ?? now) : 0
        let total = max(0, accumulated + dynamic)
        return Int(total.rounded(.down))
    }

    var elapsedText: String {
        let seconds = elapsedSeconds
        let hours = seconds / 3600
        let minutes = (seconds % 3600) / 60
        let secs = seconds % 60

        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, secs)
        }

        return String(format: "%02d:%02d", minutes, secs)
    }

    var progressInHour: CGFloat {
        let secondCount = elapsedSeconds % 3600
        if isRunning {
            return max(CGFloat(secondCount) / 3600, 1.0 / 3600)
        }
        return CGFloat(secondCount) / 3600
    }

    var statusText: String {
        if let statusOverride {
            return statusOverride
        }
        if isRunning {
            return "Running"
        }
        if elapsedSeconds > 0 {
            return "Paused"
        }
        return "Ready"
    }

    var canStopAndLog: Bool {
        !isLogging && elapsedSeconds > 0
    }

    var canDiscard: Bool {
        !isLogging && (isRunning || elapsedSeconds > 0)
    }

    var hasActiveSession: Bool {
        isRunning || elapsedSeconds > 0
    }

    func selectHabit(_ habitID: String) {
        activeHabitID = habitID
        persistSession()
    }

    func toggleRunning() {
        if isRunning {
            pause()
        } else {
            startOrResume()
        }
    }

    func startOrResume(habitID: String? = nil) {
        if let habitID {
            activeHabitID = habitID
        }

        if activeHabitID == nil {
            activeHabitID = habits.first?.id
        }

        if activeHabitID == nil {
            let fallback = Habit(id: "local-focus", name: "Focus", iconSystemName: "timer")
            habits = [fallback]
            activeHabitID = fallback.id
            persistHabits()
        }

        guard activeHabitID != nil else {
            statusOverride = "No habit selected"
            clearStatusAfterDelay()
            return
        }

        if !isRunning {
            startedAt = Date()
            isRunning = true
            statusOverride = nil
            configureTickerIfNeeded()
            persistSession()
        }
    }

    func pause() {
        guard isRunning else { return }

        let reference = startedAt ?? now
        accumulated += max(0, Date().timeIntervalSince(reference))
        startedAt = nil
        isRunning = false
        now = Date()

        configureTickerIfNeeded()
        persistSession()
    }

    func discard() {
        if isRunning { pause() }
        accumulated = 0
        startedAt = nil
        isRunning = false
        statusOverride = "Discarded"
        now = Date()
        configureTickerIfNeeded()
        persistSession()
        clearStatusAfterDelay()
    }

    func stopAndLog() async {
        if isRunning {
            pause()
        }

        guard let habitID = activeHabitID, elapsedSeconds > 0 else {
            statusOverride = "Nothing to log"
            clearStatusAfterDelay()
            return
        }

        isLogging = true
        statusOverride = "Logging…"

        let success = await createHabitLog(habitID: habitID, durationSeconds: elapsedSeconds)

        isLogging = false
        if success {
            accumulated = 0
            startedAt = nil
            isRunning = false
            statusOverride = "Logged"
            playSuccessChime()
            notifyDashboardRefresh()
        } else {
            statusOverride = "Log failed"
        }

        now = Date()
        configureTickerIfNeeded()
        persistSession()
        clearStatusAfterDelay()
    }

    // MARK: - Voice Logging

    /// Resolves a habit from a voice transcript by matching against habit names.
    /// Falls back to the currently selected habit if no match is found.
    func resolveHabit(from transcript: String) -> Habit? {
        let lower = transcript.lowercased()
        let tokens = lower.split(separator: " ").map(String.init)

        var bestMatch: Habit?
        var bestScore = 0

        for habit in habits {
            let habitLower = habit.name.lowercased()

            // Full name found verbatim in transcript — highest confidence.
            if lower.contains(habitLower) {
                let score = 100 + habitLower.count
                if score > bestScore {
                    bestScore = score
                    bestMatch = habit
                }
                continue
            }

            let habitTokens = habitLower.split(separator: " ").map(String.init)
            var score = 0

            for habitToken in habitTokens {
                for token in tokens {
                    if habitToken == token {
                        score += 10
                    } else if habitToken.count >= 3 && token.count >= 3 {
                        // Prefix match: "read"→"reading", "walked"→"walk", "code"→"coding"
                        let shorter = habitToken.count <= token.count ? habitToken : token
                        let longer  = habitToken.count <= token.count ? token : habitToken
                        if longer.hasPrefix(shorter) {
                            score += 6
                        }
                    }
                }
            }

            if score > bestScore {
                bestScore = score
                bestMatch = habit
            }
        }

        return bestMatch ?? selectedHabit
    }

    private static let wordToNumber: [String: Double] = [
        "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
        "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
        "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
        "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20,
        "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70,
        "eighty": 80, "ninety": 90, "hundred": 100,
        "a": 1, "an": 1, "half": 0.5, "quarter": 0.25
    ]

    static func extractAmount(from transcript: String) -> Double? {
        let digitPattern = #"(\d+(?:\.\d+)?)\s*(?:mg|milligrams?|hours?|hrs?|minutes?|mins?|pages?|miles?|steps?|bpm|reps?)?"#
        if let regex = try? NSRegularExpression(pattern: digitPattern, options: .caseInsensitive) {
            let range = NSRange(transcript.startIndex..., in: transcript)
            if let match = regex.firstMatch(in: transcript, range: range),
               let numRange = Range(match.range(at: 1), in: transcript),
               let value = Double(transcript[numRange]) {
                return value
            }
        }

        let lower = transcript.lowercased()
        let words = lower.components(separatedBy: .whitespaces)
        for word in words {
            if let value = wordToNumber[word], value > 0 {
                return value
            }
        }
        return nil
    }

    /// Logs a habit directly from a voice command (no timer session required).
    func voiceLog(habitID: String, transcript: String) async -> Bool {
        guard !isLogging else {
            widgetLog("voiceLog: already logging, skipping")
            return false
        }

        isLogging = true
        voiceMode = .inactive
        statusOverride = "Logging…"

        let amount = Self.extractAmount(from: transcript)
        widgetLog("voiceLog: habitID=\(habitID), transcript=\(transcript), amount=\(amount?.description ?? "nil")")
        let success = await createHabitLog(
            habitID: habitID,
            durationSeconds: 0,
            amount: amount,
            notes: "Voice log: \(transcript)"
        )

        isLogging = false
        if success {
            widgetLog("voiceLog: success")
            statusOverride = "Logged ✓"
            playSuccessChime()
            notifyDashboardRefresh()
        } else {
            widgetLog("voiceLog: FAILED")
            statusOverride = "Log failed"
        }

        clearStatusAfterDelay()
        return success
    }

    func loadHabits(force: Bool = false) async {
        if !force && !habits.isEmpty { return }
        let authToken = await freshAuthToken()
        let authParsed = await fetchHabits(token: authToken)
        let unauthedParsed = authParsed == nil ? await fetchHabits(token: nil) : nil

        if let parsed = authParsed ?? unauthedParsed,
           !parsed.isEmpty
        {
            lastHabitSyncSucceeded = true
            habits = parsed
            if activeHabitID == nil || !parsed.contains(where: { $0.id == activeHabitID }) {
                activeHabitID = parsed[0].id
            }
            persistHabits()
            persistSession()
            return
        }

        lastHabitSyncSucceeded = false
        if habits.isEmpty {
            let fallback = Habit(id: "local-focus", name: "Focus", iconSystemName: "timer")
            habits = [fallback]
            if activeHabitID == nil {
                activeHabitID = fallback.id
            }
            persistHabits()
            persistSession()
        }
    }

    func createHabitLog(habitID: String, durationSeconds: Int, amount: Double? = nil, notes: String = "Timer session from native notch") async -> Bool {
        guard let url = URL(string: "http://127.0.0.1:8000/api/habits/\(habitID)/logs") else {
            widgetLog("createHabitLog: invalid URL for habitID=\(habitID)")
            return false
        }

        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "yyyy-MM-dd"
        let todayStr = dateFormatter.string(from: Date())

        let isoFormatter = ISO8601DateFormatter()
        let completedAt = isoFormatter.string(from: Date())

        var payload: [String: Any] = [
            "date": todayStr,
            "duration": durationSeconds,
            "completed_at": completedAt,
            "status": "completed",
            "notes": notes
        ]
        if let amount {
            payload["amount"] = amount
        }

        guard let body = try? JSONSerialization.data(withJSONObject: payload) else {
            widgetLog("createHabitLog: failed to serialize payload")
            return false
        }

        for attempt in 1...3 {
            guard let token = await freshAuthToken() else {
                widgetLog("createHabitLog: no auth token available (attempt \(attempt))")
                continue
            }

            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            request.httpBody = body

            widgetLog("createHabitLog: POST \(url.absoluteString) (attempt \(attempt))")

            do {
                let (data, response) = try await URLSession.shared.data(for: request)

                guard let http = response as? HTTPURLResponse else {
                    widgetLog("createHabitLog: non-HTTP response")
                    return false
                }

                widgetLog("createHabitLog: HTTP \(http.statusCode)")

                if http.statusCode == 200 || http.statusCode == 201 {
                    return true
                }

                if (http.statusCode == 401 || http.statusCode == 403) && attempt < 3 {
                    let bodyStr = String(data: data, encoding: .utf8) ?? ""
                    widgetLog("createHabitLog: auth failed (attempt \(attempt)), requesting token refresh. \(bodyStr.prefix(200))")
                    requestAuthTokenRefresh()
                    try? await Task.sleep(for: .seconds(3))
                    continue
                }

                let bodyStr = String(data: data, encoding: .utf8) ?? "(no body)"
                widgetLog("createHabitLog: response body: \(bodyStr.prefix(300))")
                return false
            } catch {
                widgetLog("createHabitLog: network error: \(error.localizedDescription)")
                return false
            }
        }
        return false
    }

    private func configureTickerIfNeeded() {
        ticker?.invalidate()
        ticker = nil

        guard isRunning else { return }

        ticker = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.now = Date()
            }
        }
    }

    private func configureHabitsRefreshTicker() {
        habitsRefreshTicker?.invalidate()
        habitsRefreshTicker = Timer.scheduledTimer(withTimeInterval: 8.0, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                if !self.lastHabitSyncSucceeded || self.habits.count <= 1 {
                    await self.loadHabits(force: true)
                }
            }
        }
    }

    private func clearStatusAfterDelay() {
        let currentMarker = UUID().uuidString
        let markerKey = "ritual.notch.status.marker"
        UserDefaults.standard.set(currentMarker, forKey: markerKey)

        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(2.2))
            guard UserDefaults.standard.string(forKey: markerKey) == currentMarker else { return }
            self?.statusOverride = nil
        }
    }

    private func persistSession() {
        let state = PersistedSession(
            activeHabitID: activeHabitID,
            isRunning: isRunning,
            startedAt: startedAt,
            accumulated: accumulated
        )

        do {
            let encoded = try JSONEncoder().encode(state)
            UserDefaults.standard.set(encoded, forKey: persistenceKey)
        } catch {
            // Ignore persistence failures.
        }
    }

    private func persistHabits() {
        let encodedHabits = habits.map {
            PersistedHabit(id: $0.id, name: $0.name, iconSystemName: $0.iconSystemName)
        }

        do {
            let encoded = try JSONEncoder().encode(encodedHabits)
            UserDefaults.standard.set(encoded, forKey: habitsPersistenceKey)
        } catch {
            // Ignore persistence failures.
        }
    }

    private func restoreHabits() {
        guard let data = UserDefaults.standard.data(forKey: habitsPersistenceKey) else {
            return
        }

        do {
            let decoded = try JSONDecoder().decode([PersistedHabit].self, from: data)
            habits = decoded.map { Habit(id: $0.id, name: $0.name, iconSystemName: $0.iconSystemName) }
        } catch {
            UserDefaults.standard.removeObject(forKey: habitsPersistenceKey)
        }
    }

    private func restoreSession() {
        guard let data = UserDefaults.standard.data(forKey: persistenceKey) else {
            return
        }

        do {
            let state = try JSONDecoder().decode(PersistedSession.self, from: data)
            activeHabitID = state.activeHabitID
            isRunning = state.isRunning
            startedAt = state.startedAt
            accumulated = max(0, state.accumulated)
            now = Date()
        } catch {
            UserDefaults.standard.removeObject(forKey: persistenceKey)
        }
    }

    private func notifyDashboardRefresh() {
        let path = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("ritual_timer_updated.txt")
        let timestamp = String(Date().timeIntervalSince1970)
        try? timestamp.write(to: path, atomically: true, encoding: .utf8)
    }

    private func requestAuthTokenRefresh() {
        let refreshFile = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("ritual_refresh_token_request.txt")
        let timestamp = String(Date().timeIntervalSince1970)
        try? timestamp.write(to: refreshFile, atomically: true, encoding: .utf8)
    }

    private func freshAuthToken() async -> String? {
        if let token = authTokenFromFile() {
            return token
        }

        requestAuthTokenRefresh()
        try? await Task.sleep(for: .milliseconds(550))
        return authTokenFromFile()
    }

    private func authTokenFromFile() -> String? {
        let tokenFile = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".ritual/auth_token.txt")
        guard let token = try? String(contentsOf: tokenFile, encoding: .utf8) else {
            return nil
        }

        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    // MARK: - Voice Settings File IPC

    private static var voiceSettingsURL: URL {
        let home = FileManager.default.homeDirectoryForCurrentUser
        return home.appendingPathComponent(".ritual/voice_settings.json")
    }

    static func readHotkeyFromSettingsFile() -> VoiceHotkeyOption? {
        guard let data = try? Data(contentsOf: voiceSettingsURL),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let raw = json["hotkey"] as? String,
              let option = VoiceHotkeyOption(rawValue: raw) else {
            return nil
        }
        return option
    }

    private func writeHotkeySettingsFile() {
        let payload: [String: Any] = ["hotkey": selectedHotkey.rawValue]
        guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return }
        try? data.write(to: Self.voiceSettingsURL, options: .atomic)
    }

    private var settingsFileWatcherSource: DispatchSourceFileSystemObject?

    private func installSettingsFileWatcher() {
        let url = Self.voiceSettingsURL
        let fd = open(url.path, O_EVTONLY)
        guard fd >= 0 else { return }

        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fd,
            eventMask: [.write, .rename],
            queue: .main
        )
        source.setEventHandler { [weak self] in
            guard let self else { return }
            if let newOption = Self.readHotkeyFromSettingsFile(), newOption != self.selectedHotkey {
                self.selectedHotkey = newOption
                self.onHotkeyChanged?(newOption)
            }
        }
        source.setCancelHandler { close(fd) }
        source.resume()
        settingsFileWatcherSource = source
    }

    private func fetchHabits(token: String?) async -> [Habit]? {
        guard let url = URL(string: "http://127.0.0.1:8000/api/habits") else { return nil }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 2.5

        if let token, !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                return nil
            }

            let parsedRows = parseHabitRows(from: data)
            guard !parsedRows.isEmpty else { return nil }

            return parsedRows.compactMap { row in
                guard let name = row["name"] as? String else { return nil }

                let id: String
                if let rawID = row["id"] as? String {
                    id = rawID
                } else if let numberID = row["id"] as? NSNumber {
                    id = numberID.stringValue
                } else {
                    return nil
                }

                return Habit(id: id, name: name, iconSystemName: habitIcon(for: name))
            }
        } catch {
            return nil
        }
    }

    private func parseHabitRows(from data: Data) -> [[String: Any]] {
        guard let json = try? JSONSerialization.jsonObject(with: data) else {
            return []
        }

        if let rows = json as? [[String: Any]] {
            return rows
        }

        if let object = json as? [String: Any] {
            if let rows = object["habits"] as? [[String: Any]] {
                return rows
            }
            if let rows = object["data"] as? [[String: Any]] {
                return rows
            }
        }

        return []
    }

    private func habitIcon(for name: String) -> String {
        let lowercase = name.lowercased()
        if lowercase.contains("read") { return "book" }
        if lowercase.contains("walk") { return "figure.walk" }
        if lowercase.contains("sleep") { return "moon.zzz" }
        if lowercase.contains("code") { return "chevron.left.forwardslash.chevron.right" }
        if lowercase.contains("workout") { return "figure.strengthtraining.traditional" }
        if lowercase.contains("heart") { return "heart" }
        if lowercase.contains("screen") { return "display" }
        return "circle.fill"
    }
}
