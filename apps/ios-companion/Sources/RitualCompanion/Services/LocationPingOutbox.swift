import Foundation
import OSLog

/// Disk-backed buffer of pending LocationPings.
///
/// SCLS can fire while the device is offline (airplane mode, dead Wi-Fi,
/// background launch with no immediate network). We persist every captured
/// ping to disk immediately, then opportunistically flush when the API is
/// reachable. Survives process termination and reboots.
actor LocationPingOutbox {
    private let logger = Logger(subsystem: "com.ritual.companion", category: "LocationPingOutbox")
    private let storageURL: URL
    private var pending: [LocationPing] = []

    /// Maximum pings to keep on disk. SCLS fires ~every 500m of movement so
    /// even an aggressive day rarely emits >100 pings. Cap protects against
    /// pathological cases (broken backend, etc.) eating disk.
    private let maxBufferedPings = 2_000

    init(filename: String = "location_outbox.json") {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        // Ensure parent dir exists (Application Support is not auto-created)
        try? FileManager.default.createDirectory(at: appSupport, withIntermediateDirectories: true)
        self.storageURL = appSupport.appendingPathComponent(filename)
        if let data = try? Data(contentsOf: self.storageURL) {
            do {
                self.pending = try JSONDecoder().decode([LocationPing].self, from: data)
            } catch {
                Self.quarantineRaw(data, reason: "malformed_outbox", storageURL: self.storageURL, logger: self.logger)
                self.pending = []
            }
        }
    }

    /// Buffer a new ping. Persists to disk immediately.
    func enqueue(_ ping: LocationPing) {
        pending.append(ping)
        if pending.count > maxBufferedPings {
            // Drop oldest — fresh data is more useful than ancient
            pending.removeFirst(pending.count - maxBufferedPings)
        }
        persistToDisk()
    }

    /// Snapshot current pending pings (used by callers that want to flush).
    func snapshot() -> [LocationPing] {
        return pending
    }

    /// Remove the given pings from the buffer (called after a successful flush).
    /// We match by client_event_id rather than index so concurrent enqueues are safe.
    func drain(submittedEventIds: Set<String>) {
        guard !submittedEventIds.isEmpty else { return }
        pending.removeAll { submittedEventIds.contains($0.clientEventId) }
        persistToDisk()
    }

    /// For tests and diagnostics.
    func count() -> Int { pending.count }

    /// Flush all pending pings via the provided API client.
    ///
    /// Returns the number of pings successfully submitted. On any error,
    /// keeps the full buffer for next attempt — better to retry than lose data.
    func flush(via api: RitualAPIClient) async -> Int {
        guard !pending.isEmpty else { return 0 }
        let batch = pending
        do {
            let response = try await api.postLocationPings(batch)
            var acknowledgedIds = Set((response.acceptedIds ?? []) + (response.duplicateIds ?? []))
            let rejectedIds = Set(response.rejectedIds ?? [])
            if acknowledgedIds.isEmpty && rejectedIds.isEmpty && response.rejected == 0 {
                acknowledgedIds = Set(batch.map { $0.clientEventId })
            }
            if acknowledgedIds.isEmpty && rejectedIds.isEmpty && response.rejected > 0 {
                logger.warning("Location ping flush returned rejects without IDs; keeping pending pings")
                return 0
            }
            let rejected = batch.filter { rejectedIds.contains($0.clientEventId) }
            quarantineRejected(rejected, reason: "backend_rejected")
            drain(submittedEventIds: acknowledgedIds.union(rejectedIds))
            logger.info("Flushed \(acknowledgedIds.count) location pings; quarantined \(rejected.count)")
            return acknowledgedIds.count + rejected.count
        } catch {
            logger.warning("Location ping flush failed: \(error.localizedDescription, privacy: .public)")
            return 0
        }
    }

    // MARK: - Disk persistence

    private func persistToDisk() {
        do {
            let data = try JSONEncoder().encode(pending)
            try data.write(to: storageURL, options: .atomic)
        } catch {
            logger.error("Failed to persist location outbox: \(error.localizedDescription, privacy: .public)")
        }
    }

    private func quarantineRejected(_ pings: [LocationPing], reason: String) {
        guard !pings.isEmpty else { return }
        let quarantineURL = storageURL.deletingPathExtension().appendingPathExtension("rejected.jsonl")
        var body = ""
        for ping in pings {
            do {
                let encoded = try JSONEncoder().encode(QuarantinedPing(reason: reason, ping: ping, quarantinedAt: Date()))
                if let line = String(data: encoded, encoding: .utf8) {
                    body.append(line)
                    body.append("\n")
                }
            } catch {
                logger.error("Failed to encode rejected location ping: \(error.localizedDescription, privacy: .public)")
            }
        }
        append(body, to: quarantineURL)
    }

    private func quarantineRaw(_ data: Data, reason: String) {
        Self.quarantineRaw(data, reason: reason, storageURL: storageURL, logger: logger)
    }

    private static func quarantineRaw(_ data: Data, reason: String, storageURL: URL, logger: Logger) {
        let quarantineURL = storageURL.deletingPathExtension().appendingPathExtension("malformed.json")
        let payload = String(data: data, encoding: .utf8) ?? ""
        do {
            let encoded = try JSONEncoder().encode(QuarantinedRaw(reason: reason, raw: payload, quarantinedAt: Date()))
            if let line = String(data: encoded, encoding: .utf8) {
                append(line + "\n", to: quarantineURL, logger: logger)
            }
        } catch {
            logger.error("Failed to encode malformed location outbox: \(error.localizedDescription, privacy: .public)")
        }
    }

    private func append(_ body: String, to url: URL) {
        Self.append(body, to: url, logger: logger)
    }

    private static func append(_ body: String, to url: URL, logger: Logger) {
        guard let data = body.data(using: .utf8), !data.isEmpty else { return }
        do {
            if FileManager.default.fileExists(atPath: url.path) {
                let handle = try FileHandle(forWritingTo: url)
                try handle.seekToEnd()
                try handle.write(contentsOf: data)
                try handle.close()
            } else {
                try data.write(to: url, options: .atomic)
            }
        } catch {
            logger.error("Failed to write location quarantine: \(error.localizedDescription, privacy: .public)")
        }
    }
}

private struct QuarantinedPing: Codable {
    let reason: String
    let ping: LocationPing
    let quarantinedAt: Date
}

private struct QuarantinedRaw: Codable {
    let reason: String
    let raw: String
    let quarantinedAt: Date
}
