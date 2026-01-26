import Foundation
import HealthKit
import BackgroundTasks
import UIKit

/// V2 Background Sync Manager with incremental sync, offline queue, and better error handling
final class BackgroundSyncManagerV2 {
    
    // MARK: - Singleton
    
    static let shared = BackgroundSyncManagerV2()
    
    // MARK: - Constants
    
    static let backgroundTaskIdentifier = "com.ritual.companion.healthsync.v2"
    
    /// Minimum interval between background syncs (5 minutes - reduced from 15)
    private let minimumSyncInterval: TimeInterval = 5 * 60
    
    /// Minimum interval between foreground syncs (2 minutes - more responsive)
    private let minimumForegroundSyncInterval: TimeInterval = 2 * 60
    
    private enum StorageKeys {
        static let lastSyncTime = "BackgroundSyncV2.lastSyncTime"
        static let lastSyncAttemptTime = "BackgroundSyncV2.lastSyncAttemptTime"
        static let lastError = "BackgroundSyncV2.lastError"
        static let lastErrorTime = "BackgroundSyncV2.lastErrorTime"
        static let syncCount = "BackgroundSyncV2.syncCount"
        static let trackedMetricTypes = "BackgroundSyncV2.trackedMetricTypes"
    }
    
    // MARK: - Properties
    
    private let healthStore = HKHealthStore()
    private let healthKitManager = HealthKitManagerV2()
    private let apiClient = RitualAPIClient()
    private let offlineQueue = OfflineSyncQueue.shared
    private let anchorStorage = AnchorStorage.shared
    
    private var observerQueries: [HKObserverQuery] = []
    private var isSetup = false
    private var isSyncing = false
    
    // MARK: - Published State
    
    /// Last successful sync time
    var lastSyncTime: Date? {
        get { UserDefaults.standard.object(forKey: StorageKeys.lastSyncTime) as? Date }
        set { UserDefaults.standard.set(newValue, forKey: StorageKeys.lastSyncTime) }
    }
    
    /// Last sync attempt time (success or failure)
    var lastSyncAttemptTime: Date? {
        get { UserDefaults.standard.object(forKey: StorageKeys.lastSyncAttemptTime) as? Date }
        set { UserDefaults.standard.set(newValue, forKey: StorageKeys.lastSyncAttemptTime) }
    }
    
    /// Last error message
    var lastError: String? {
        get { UserDefaults.standard.string(forKey: StorageKeys.lastError) }
        set { UserDefaults.standard.set(newValue, forKey: StorageKeys.lastError) }
    }
    
    /// Last error time
    var lastErrorTime: Date? {
        get { UserDefaults.standard.object(forKey: StorageKeys.lastErrorTime) as? Date }
        set { UserDefaults.standard.set(newValue, forKey: StorageKeys.lastErrorTime) }
    }
    
    /// Total successful sync count
    private var syncCount: Int {
        get { UserDefaults.standard.integer(forKey: StorageKeys.syncCount) }
        set { UserDefaults.standard.set(newValue, forKey: StorageKeys.syncCount) }
    }
    
    /// Cached tracked metric types
    var cachedMetricTypes: [String] {
        get { UserDefaults.standard.stringArray(forKey: StorageKeys.trackedMetricTypes) ?? [] }
        set { UserDefaults.standard.set(newValue, forKey: StorageKeys.trackedMetricTypes) }
    }
    
    // MARK: - Initialization
    
    private init() {
        // Listen for network availability
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(networkBecameAvailable),
            name: NSNotification.Name("NetworkBecameAvailable"),
            object: nil
        )
    }
    
    @objc private func networkBecameAvailable() {
        print("🌐 Network became available - flushing offline queue")
        Task {
            await flushOfflineQueue()
        }
    }
    
    // MARK: - Setup
    
    func setupBackgroundSync() {
        guard !isSetup else { return }
        isSetup = true
        
        registerBackgroundTask()
        
        // Re-enable background delivery if we have credentials and cached metrics
        if apiClient.hasStoredCredentials && !cachedMetricTypes.isEmpty {
            Task {
                await enableBackgroundDelivery(forMetricTypes: cachedMetricTypes)
            }
        }
        
        print("📱 Background sync V2 manager initialized (total syncs: \(syncCount))")
    }
    
    private func registerBackgroundTask() {
        let registered = BGTaskScheduler.shared.register(
            forTaskWithIdentifier: Self.backgroundTaskIdentifier,
            using: nil
        ) { [weak self] task in
            self?.handleBackgroundTask(task as! BGAppRefreshTask)
        }
        
        if registered {
            print("✅ Background task V2 registered")
        } else {
            print("⚠️ Failed to register background task V2")
        }
    }
    
    func scheduleBackgroundSync() {
        let request = BGAppRefreshTaskRequest(identifier: Self.backgroundTaskIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: minimumSyncInterval)
        
        do {
            try BGTaskScheduler.shared.submit(request)
            print("📅 Background sync scheduled")
        } catch {
            print("⚠️ Failed to schedule background sync: \(error)")
        }
    }
    
    func cancelScheduledSync() {
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.backgroundTaskIdentifier)
    }
    
    private func handleBackgroundTask(_ task: BGAppRefreshTask) {
        print("🔄 Background task started")
        
        scheduleBackgroundSync() // Schedule next
        
        let syncTask = Task {
            await performIncrementalSync(isBackground: true)
        }
        
        task.expirationHandler = {
            syncTask.cancel()
            print("⚠️ Background task expired")
        }
        
        Task {
            _ = await syncTask.value
            task.setTaskCompleted(success: true)
        }
    }
    
    // MARK: - HealthKit Background Delivery
    
    func enableBackgroundDelivery(forMetricTypes metricTypes: [String]) async {
        disableAllObservers()
        
        guard HKHealthStore.isHealthDataAvailable() else { return }
        guard !metricTypes.isEmpty else { return }
        
        cachedMetricTypes = metricTypes
        
        for metricType in metricTypes {
            guard let hkType = healthKitType(for: metricType) else { continue }
            
            do {
                try await healthStore.enableBackgroundDelivery(for: hkType, frequency: .immediate)
                
                let query = HKObserverQuery(sampleType: hkType, predicate: nil) { [weak self] _, completionHandler, error in
                    if let error = error {
                        print("⚠️ Observer error for \(metricType): \(error)")
                        completionHandler()
                        return
                    }
                    
                    print("📊 New \(metricType) data detected")
                    
                    Task {
                        await self?.performIncrementalSync(isBackground: true, specificMetricType: metricType)
                        completionHandler()
                    }
                }
                
                healthStore.execute(query)
                observerQueries.append(query)
                
                print("✅ Background delivery enabled for: \(metricType)")
            } catch {
                print("⚠️ Failed to enable background delivery for \(metricType): \(error)")
            }
        }
    }
    
    func disableAllObservers() {
        for query in observerQueries {
            healthStore.stop(query)
        }
        observerQueries.removeAll()
    }
    
    // MARK: - Sync Methods
    
    /// Perform sync when app comes to foreground
    func performForegroundSync() async {
        guard let lastSync = lastSyncTime else {
            await performIncrementalSync(isBackground: false)
            return
        }
        
        if Date().timeIntervalSince(lastSync) < minimumForegroundSyncInterval {
            print("⏱️ Skipping foreground sync - too recent")
            return
        }
        
        await performIncrementalSync(isBackground: false)
    }
    
    /// Perform incremental sync using DAILY AGGREGATES
    /// This sends daily totals instead of raw samples for much better data quality
    func performIncrementalSync(isBackground: Bool, specificMetricType: String? = nil) async {
        guard !isSyncing else {
            print("⚠️ Sync already in progress")
            return
        }
        
        isSyncing = true
        defer { isSyncing = false }
        
        lastSyncAttemptTime = Date()
        
        // Check credentials
        guard apiClient.hasStoredCredentials else {
            print("⚠️ No credentials - skipping sync")
            return
        }
        
        // Ensure token is valid (silent refresh if needed)
        do {
            try await apiClient.ensureValidToken()
        } catch let error as APIError where error.requiresReauth {
            print("❌ Token refresh failed - requires re-auth")
            lastError = error.localizedDescription
            lastErrorTime = Date()
            
            // Post notification for UI to handle re-auth
            await MainActor.run {
                NotificationCenter.default.post(
                    name: NSNotification.Name("RequiresReauthentication"),
                    object: nil
                )
            }
            return
        } catch {
            print("⚠️ Token refresh error: \(error)")
        }
        
        // Determine which metrics to sync
        let metricTypes: [String]
        if let specific = specificMetricType {
            metricTypes = [specific]
        } else {
            // Refresh tracked metrics from server
            do {
                let response = try await apiClient.fetchTrackedMetrics()
                metricTypes = response.metricTypes
                
                if cachedMetricTypes != metricTypes {
                    cachedMetricTypes = metricTypes
                    await enableBackgroundDelivery(forMetricTypes: metricTypes)
                }
            } catch {
                print("⚠️ Failed to fetch tracked metrics, using cached: \(error)")
                metricTypes = cachedMetricTypes
            }
        }
        
        guard !metricTypes.isEmpty else {
            print("📊 No metrics to sync")
            return
        }
        
        print("🔄 Starting DAILY AGGREGATED sync for \(metricTypes.count) metric types...")
        
        // First, flush any pending offline queue items
        await flushOfflineQueue()
        
        // Fetch DAILY AGGREGATED data for the last 7 days (for incremental updates)
        // This ensures we capture any recent changes without syncing years of data
        do {
            var allMetrics: [NormalizedMetric] = []
            
            for metricType in metricTypes {
                do {
                    // Sync last 7 days of daily aggregates for incremental updates
                    let metrics = try await healthKitManager.fetchDailyAggregatedMetrics(
                        for: metricType,
                        daysBack: 7  // Only fetch recent days for incremental sync
                    )
                    allMetrics.append(contentsOf: metrics)
                } catch {
                    print("⚠️ Failed to fetch daily aggregates for \(metricType): \(error.localizedDescription)")
                }
            }
            
            // Skip if no data
            guard !allMetrics.isEmpty else {
                print("📊 No data to sync")
                lastSyncTime = Date()
                lastError = nil
                return
            }
            
            print("📊 Syncing \(allMetrics.count) daily aggregate values")
            
            // Batch size limit (backend accepts max 500, use 400 for safety)
            let batchSize = 400
            
            // Try to send to backend in batches
            var totalSuccess = 0
            var allBatchesSucceeded = true
            
            // Split into batches
            let batches = stride(from: 0, to: allMetrics.count, by: batchSize).map {
                Array(allMetrics[$0..<min($0 + batchSize, allMetrics.count)])
            }
            
            print("📦 Sending \(batches.count) batch(es)...")
            
            var failedBatches = 0
            let startTime = Date()
            
            for (i, batch) in batches.enumerated() {
                if batch.isEmpty { continue }
                
                // Log progress
                let elapsed = Date().timeIntervalSince(startTime)
                print("📤 Batch \(i + 1)/\(batches.count): \(batch.count) daily values (elapsed: \(Int(elapsed))s)")
                
                do {
                    let response = try await apiClient.ingestMetricsV2(
                        added: batch,
                        deleted: [],
                        modified: []
                    )
                    
                    if response.success {
                        totalSuccess += batch.count
                    } else {
                        allBatchesSucceeded = false
                        failedBatches += 1
                        print("⚠️ Batch \(i + 1) rejected by server")
                    }
                } catch let error as APIError where error.shouldQueue {
                    // Network error - queue for retry
                    print("📥 Network error - queuing batch \(i + 1) for retry")
                    
                    let encoder = JSONEncoder()
                    let payloadData = try? encoder.encode(batch)
                    if let data = payloadData {
                        _ = offlineQueue.enqueue(
                            clientEventId: UUID().uuidString,
                            payload: data,
                            metricCount: batch.count
                        )
                    }
                    
                    failedBatches += 1
                } catch {
                    // Log error but continue with remaining batches
                    allBatchesSucceeded = false
                    failedBatches += 1
                    print("⚠️ Batch \(i + 1) failed: \(error.localizedDescription)")
                    
                    // If too many failures in a row, stop
                    if failedBatches >= 5 {
                        print("❌ Too many batch failures (\(failedBatches)), stopping sync")
                        break
                    }
                }
                
                // Small delay between batches
                if i < batches.count - 1 {
                    try? await Task.sleep(nanoseconds: 50_000_000) // 50ms
                }
            }
            
            let totalElapsed = Date().timeIntervalSince(startTime)
            print("📊 Sync completed in \(Int(totalElapsed))s: \(totalSuccess) daily values synced, \(failedBatches) failed batches")
            
            // Consider sync successful if any data was synced
            if totalSuccess > 0 {
                lastSyncTime = Date()
                lastError = nil
                syncCount += 1
                
                print("✅ Daily aggregated sync complete: \(totalSuccess) values (total syncs: \(syncCount))")
                
                // Notify UI
                await MainActor.run {
                    NotificationCenter.default.post(
                        name: NSNotification.Name("BackgroundSyncCompleted"),
                        object: nil,
                        userInfo: [
                            "addedCount": totalSuccess,
                            "deletedCount": 0,
                            "time": Date()
                        ]
                    )
                }
            } else if !allBatchesSucceeded {
                print("❌ Sync failed - no data was successfully synced")
                lastError = "Sync failed"
                lastErrorTime = Date()
            }
            
        } catch {
            print("❌ HealthKit query failed: \(error)")
            lastError = error.localizedDescription
            lastErrorTime = Date()
        }
    }
    
    /// Flush the offline queue
    private func flushOfflineQueue() async {
        let payloads = await offlineQueue.processQueue()
        
        for payload in payloads {
            do {
                let decoder = JSONDecoder()
                let metrics = try decoder.decode([NormalizedMetric].self, from: payload.payload)
                
                let response = try await apiClient.ingestMetricsV2(
                    added: metrics,
                    deleted: [],
                    modified: []
                )
                
                if response.success {
                    offlineQueue.markSuccess(id: payload.id)
                    print("✅ Flushed queued payload \(payload.id)")
                } else {
                    offlineQueue.markFailed(id: payload.id, error: "Server rejected")
                }
                
            } catch {
                offlineQueue.markFailed(id: payload.id, error: error.localizedDescription)
                print("❌ Failed to flush payload \(payload.id): \(error)")
            }
        }
    }
    
    /// Perform a full backfill using DAILY AGGREGATES (recommended for initial setup)
    /// This sends daily totals instead of raw samples (e.g., 700 daily values vs 50,000 raw samples)
    func performFullBackfill(daysBack: Int = 730, progressHandler: ((Int, Int) -> Void)? = nil) async throws -> Int {
        guard apiClient.hasStoredCredentials else {
            throw APIError.notRegistered
        }
        
        print("📊 Starting DAILY AGGREGATED backfill for \(daysBack) days...")
        print("   (This sends ~\(daysBack) daily values per metric instead of thousands of raw samples)")
        
        // Use the new daily aggregated backfill method
        let metrics = try await healthKitManager.performDailyAggregatedBackfill(
            for: cachedMetricTypes,
            daysBack: daysBack,
            progressHandler: progressHandler
        )
        
        guard !metrics.isEmpty else {
            print("📊 No metrics to backfill")
            return 0
        }
        
        // Batch the backfill to avoid 500 item limit (though with daily aggregates we rarely hit this)
        let batchSize = 400
        let batches = stride(from: 0, to: metrics.count, by: batchSize).map {
            Array(metrics[$0..<min($0 + batchSize, metrics.count)])
        }
        
        print("📦 Backfill: \(metrics.count) DAILY metrics in \(batches.count) batch(es)")
        
        var totalSuccess = 0
        let startTime = Date()
        
        for (index, batch) in batches.enumerated() {
            print("📤 Backfill batch \(index + 1)/\(batches.count): \(batch.count) daily metrics")
            
            do {
                let response = try await apiClient.ingestMetricsV2(
                    added: batch,
                    deleted: [],
                    modified: []
                )
                
                if response.success {
                    totalSuccess += batch.count
                }
            } catch {
                print("⚠️ Batch \(index + 1) failed: \(error.localizedDescription)")
                // Continue with remaining batches
            }
            
            // Small delay between batches
            if index < batches.count - 1 {
                try await Task.sleep(nanoseconds: 100_000_000) // 100ms
            }
        }
        
        let elapsed = Date().timeIntervalSince(startTime)
        print("✅ Backfill complete in \(Int(elapsed))s: \(totalSuccess) daily aggregates synced")
        
        if totalSuccess > 0 {
            lastSyncTime = Date()
            lastError = nil
        }
        
        return totalSuccess
    }
    
    // MARK: - Helpers
    
    private func healthKitType(for metricType: String) -> HKSampleType? {
        switch metricType {
        case "steps": return HKQuantityType.quantityType(forIdentifier: .stepCount)
        case "active_energy": return HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)
        case "basal_energy": return HKQuantityType.quantityType(forIdentifier: .basalEnergyBurned)
        case "distance": return HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning)
        case "flights_climbed": return HKQuantityType.quantityType(forIdentifier: .flightsClimbed)
        case "exercise_time": return HKQuantityType.quantityType(forIdentifier: .appleExerciseTime)
        case "stand_time": return HKQuantityType.quantityType(forIdentifier: .appleStandTime)
        case "hr": return HKQuantityType.quantityType(forIdentifier: .heartRate)
        case "hrv": return HKQuantityType.quantityType(forIdentifier: .heartRateVariabilitySDNN)
        case "resting_hr": return HKQuantityType.quantityType(forIdentifier: .restingHeartRate)
        case "walking_hr": return HKQuantityType.quantityType(forIdentifier: .walkingHeartRateAverage)
        case "respiratory_rate": return HKQuantityType.quantityType(forIdentifier: .respiratoryRate)
        case "oxygen_saturation": return HKQuantityType.quantityType(forIdentifier: .oxygenSaturation)
        case "sleep_session": return HKCategoryType.categoryType(forIdentifier: .sleepAnalysis)
        case "mindful_minutes": return HKCategoryType.categoryType(forIdentifier: .mindfulSession)
        case "workout": return HKObjectType.workoutType()
        default: return nil
        }
    }
    
    // MARK: - Debug
    
    var debugInfo: String {
        var info = "Background Sync V2 Status:\n"
        info += "- Setup: \(isSetup)\n"
        info += "- Syncing: \(isSyncing)\n"
        info += "- Last successful sync: \(lastSyncTime?.description ?? "Never")\n"
        info += "- Last attempt: \(lastSyncAttemptTime?.description ?? "Never")\n"
        info += "- Last error: \(lastError ?? "None")\n"
        info += "- Total syncs: \(syncCount)\n"
        info += "- Active observers: \(observerQueries.count)\n"
        info += "- Cached metric types: \(cachedMetricTypes.joined(separator: ", "))\n"
        info += "- Offline queue: \(offlineQueue.pendingCount) pending\n"
        info += "\n\(anchorStorage.debugInfo)"
        info += "\n\(offlineQueue.debugInfo)"
        return info
    }
    
    /// Sync status for UI display
    var syncStatus: SyncStatus {
        if isSyncing {
            return .syncing
        }
        
        if let error = lastError, let errorTime = lastErrorTime {
            // If error is recent (within 30 minutes), show error status
            if Date().timeIntervalSince(errorTime) < 1800 {
                return .error(error)
            }
        }
        
        if let lastSync = lastSyncTime {
            return .synced(lastSync)
        }
        
        return .neverSynced
    }
    
    enum SyncStatus {
        case syncing
        case synced(Date)
        case error(String)
        case neverSynced
        
        var displayText: String {
            switch self {
            case .syncing:
                return "Syncing..."
            case .synced(let date):
                let formatter = RelativeDateTimeFormatter()
                formatter.unitsStyle = .abbreviated
                return "Synced \(formatter.localizedString(for: date, relativeTo: Date()))"
            case .error(let message):
                return "Error: \(message)"
            case .neverSynced:
                return "Never synced"
            }
        }
        
        var isHealthy: Bool {
            switch self {
            case .syncing, .synced:
                return true
            case .error, .neverSynced:
                return false
            }
        }
    }
}
