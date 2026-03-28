import Foundation
import Network

/// Manages offline queuing of sync payloads for retry when network is unavailable
/// Provides persistence, retry logic with exponential backoff, and automatic flushing
final class OfflineSyncQueue {
    
    // MARK: - Singleton
    
    static let shared = OfflineSyncQueue()
    
    // MARK: - Types
    
    struct QueuedPayload: Codable {
        let id: String
        let clientEventId: String
        let payload: Data
        let metricCount: Int
        let createdAt: Date
        var attemptCount: Int
        var lastAttemptAt: Date?
        var lastError: String?
    }

    struct QueueTelemetry {
        let pendingCount: Int
        let readyForRetryCount: Int
        let networkAvailable: Bool
        let isProcessing: Bool
        let oldestPendingDate: Date?
        let totalPendingMetrics: Int
    }
    
    // MARK: - Constants
    
    private let queueFileName = "offline_sync_queue.json"
    private let maxRetentionDays: Int = 30
    private let maxAttempts: Int = 10
    private let baseRetryInterval: TimeInterval = 60 // 1 minute
    private let maxRetryInterval: TimeInterval = 3600 // 1 hour
    
    // MARK: - Properties
    
    private var queue: [QueuedPayload] = []
    private let queueLock = NSLock()
    private var networkMonitor: NWPathMonitor?
    private var isNetworkAvailable = true
    private var isProcessing = false
    
    // MARK: - Computed Properties
    
    var pendingCount: Int {
        queueLock.lock()
        defer { queueLock.unlock() }
        return queue.count
    }
    
    var oldestPendingDate: Date? {
        queueLock.lock()
        defer { queueLock.unlock() }
        return queue.min(by: { $0.createdAt < $1.createdAt })?.createdAt
    }

    var telemetry: QueueTelemetry {
        queueLock.lock()
        defer { queueLock.unlock() }

        let readyForRetry = payloadsReadyForRetryLocked(now: Date())
        let totalPendingMetrics = queue.reduce(0) { $0 + $1.metricCount }

        return QueueTelemetry(
            pendingCount: queue.count,
            readyForRetryCount: readyForRetry.count,
            networkAvailable: isNetworkAvailable,
            isProcessing: isProcessing,
            oldestPendingDate: queue.min(by: { $0.createdAt < $1.createdAt })?.createdAt,
            totalPendingMetrics: totalPendingMetrics
        )
    }
    
    // MARK: - Initialization
    
    private init() {
        loadQueue()
        startNetworkMonitoring()
    }
    
    // MARK: - Queue Management
    
    /// Add a payload to the offline queue
    func enqueue(clientEventId: String, payload: Data, metricCount: Int) -> String {
        let id = UUID().uuidString
        
        let queuedPayload = QueuedPayload(
            id: id,
            clientEventId: clientEventId,
            payload: payload,
            metricCount: metricCount,
            createdAt: Date(),
            attemptCount: 0,
            lastAttemptAt: nil,
            lastError: nil
        )
        
        queueLock.lock()
        queue.append(queuedPayload)
        queueLock.unlock()
        
        saveQueue()
        
        #if DEBUG
        print("📥 Queued payload \(id) with \(metricCount) metrics")
        #endif
        return id
    }
    
    /// Mark a payload as successfully sent
    func markSuccess(id: String) {
        queueLock.lock()
        queue.removeAll { $0.id == id }
        queueLock.unlock()
        
        saveQueue()
        #if DEBUG
        print("✅ Removed successful payload \(id) from queue")
        #endif
    }
    
    /// Mark a payload as failed
    func markFailed(id: String, error: String) {
        queueLock.lock()
        if let index = queue.firstIndex(where: { $0.id == id }) {
            queue[index].attemptCount += 1
            queue[index].lastAttemptAt = Date()
            queue[index].lastError = error
            
            // Remove if max attempts exceeded
            if queue[index].attemptCount >= maxAttempts {
                #if DEBUG
                print("❌ Payload \(id) exceeded max attempts, removing from queue")
                #endif
                queue.remove(at: index)
            }
        }
        queueLock.unlock()
        
        saveQueue()
    }
    
    /// Get payloads ready for retry
    func getPayloadsReadyForRetry() -> [QueuedPayload] {
        let now = Date()
        
        queueLock.lock()
        defer { queueLock.unlock() }

        return payloadsReadyForRetryLocked(now: now)
    }
    
    /// Clean up old payloads
    func cleanupOldPayloads() {
        let cutoffDate = Calendar.current.date(byAdding: .day, value: -maxRetentionDays, to: Date())!
        
        queueLock.lock()
        let beforeCount = queue.count
        queue.removeAll { $0.createdAt < cutoffDate }
        let afterCount = queue.count
        queueLock.unlock()
        
        if beforeCount != afterCount {
            saveQueue()
            #if DEBUG
            print("🗑️ Cleaned up \(beforeCount - afterCount) old payloads from queue")
            #endif
        }
    }
    
    /// Clear all queued payloads
    func clearAll() {
        queueLock.lock()
        queue.removeAll()
        queueLock.unlock()
        
        saveQueue()
        #if DEBUG
        print("🗑️ Cleared all queued payloads")
        #endif
    }
    
    // MARK: - Processing
    
    /// Process the queue - called by BackgroundSyncManagerV2
    /// Returns the payloads that should be sent
    func processQueue() async -> [QueuedPayload] {
        guard !isProcessing else {
            #if DEBUG
            print("⚠️ Queue processing already in progress")
            #endif
            return []
        }
        
        guard isNetworkAvailable else {
            #if DEBUG
            print("⚠️ Network unavailable, skipping queue processing")
            #endif
            return []
        }
        
        isProcessing = true
        defer { isProcessing = false }
        
        // Clean up old payloads first
        cleanupOldPayloads()
        
        // Get payloads ready for retry
        let payloads = getPayloadsReadyForRetry()
        
        if payloads.isEmpty {
            #if DEBUG
            print("📭 No payloads ready for retry")
            #endif
        } else {
            #if DEBUG
            print("📤 Processing \(payloads.count) queued payloads")
            #endif
        }
        
        return payloads
    }
    
    // MARK: - Persistence
    
    private var queueFileURL: URL {
        let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return documentsPath.appendingPathComponent(queueFileName)
    }
    
    private func loadQueue() {
        guard FileManager.default.fileExists(atPath: queueFileURL.path) else {
            return
        }
        
        do {
            let data = try Data(contentsOf: queueFileURL)
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            queue = try decoder.decode([QueuedPayload].self, from: data)
            #if DEBUG
            print("📂 Loaded \(queue.count) payloads from offline queue")
            #endif
        } catch {
            #if DEBUG
            print("⚠️ Failed to load offline queue: \(error)")
            #endif
            queue = []
        }
    }
    
    private func saveQueue() {
        do {
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            let data = try encoder.encode(queue)
            try data.write(to: queueFileURL, options: .atomicWrite)
        } catch {
            #if DEBUG
            print("⚠️ Failed to save offline queue: \(error)")
            #endif
        }
    }
    
    // MARK: - Network Monitoring
    
    private func startNetworkMonitoring() {
        networkMonitor = NWPathMonitor()
        networkMonitor?.pathUpdateHandler = { [weak self] path in
            let wasAvailable = self?.isNetworkAvailable ?? false
            self?.isNetworkAvailable = path.status == .satisfied
            
            if !wasAvailable && path.status == .satisfied {
                #if DEBUG
                print("🌐 Network became available - triggering queue flush")
                #endif
                NotificationCenter.default.post(
                    name: NSNotification.Name("NetworkBecameAvailable"),
                    object: nil
                )
            }
        }
        networkMonitor?.start(queue: DispatchQueue.global(qos: .utility))
    }

    private func payloadsReadyForRetryLocked(now: Date) -> [QueuedPayload] {
        queue.filter { payload in
            // First attempt or enough time has passed since last attempt
            guard let lastAttempt = payload.lastAttemptAt else {
                return true
            }

            // Exponential backoff
            let backoffInterval = min(
                baseRetryInterval * pow(2.0, Double(payload.attemptCount - 1)),
                maxRetryInterval
            )

            return now.timeIntervalSince(lastAttempt) >= backoffInterval
        }
    }
    
    // MARK: - Debug
    
    var debugInfo: String {
        queueLock.lock()
        defer { queueLock.unlock() }
        
        var info = "Offline Queue Status:\n"
        info += "- Pending payloads: \(queue.count)\n"
        info += "- Network available: \(isNetworkAvailable)\n"
        info += "- Processing: \(isProcessing)\n"
        
        if !queue.isEmpty {
            info += "- Oldest payload: \(queue.min(by: { $0.createdAt < $1.createdAt })?.createdAt.description ?? "N/A")\n"
            info += "- Payloads by attempt count:\n"
            
            let grouped = Dictionary(grouping: queue, by: { $0.attemptCount })
            for (attempts, payloads) in grouped.sorted(by: { $0.key < $1.key }) {
                info += "  - \(attempts) attempts: \(payloads.count) payloads\n"
            }
        }
        
        return info
    }
}
