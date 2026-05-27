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
        loadFromDisk()
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
            _ = try await api.postLocationPings(batch)
            let submittedIds = Set(batch.map { $0.clientEventId })
            drain(submittedEventIds: submittedIds)
            logger.info("Flushed \(batch.count) location pings")
            return batch.count
        } catch {
            logger.warning("Location ping flush failed: \(error.localizedDescription, privacy: .public)")
            return 0
        }
    }

    // MARK: - Disk persistence

    private func loadFromDisk() {
        guard let data = try? Data(contentsOf: storageURL) else { return }
        do {
            pending = try JSONDecoder().decode([LocationPing].self, from: data)
            logger.debug("Loaded \(self.pending.count) pings from outbox")
        } catch {
            logger.error("Failed to decode location outbox; starting fresh: \(error.localizedDescription, privacy: .public)")
            pending = []
        }
    }

    private func persistToDisk() {
        do {
            let data = try JSONEncoder().encode(pending)
            try data.write(to: storageURL, options: .atomic)
        } catch {
            logger.error("Failed to persist location outbox: \(error.localizedDescription, privacy: .public)")
        }
    }
}
