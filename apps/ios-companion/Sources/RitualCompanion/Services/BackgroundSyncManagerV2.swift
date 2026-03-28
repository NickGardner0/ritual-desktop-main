import Foundation
import HealthKit
import BackgroundTasks
import UIKit
import UserNotifications

/// V2 Background Sync Manager with incremental sync, offline queue, and better error handling
final class BackgroundSyncManagerV2: @unchecked Sendable {
    
    // MARK: - Singleton
    
    static let shared = BackgroundSyncManagerV2()
    
    // MARK: - Constants
    
    static let backgroundTaskIdentifier = "com.ritual.companion.healthsync.v2"
    
    /// Minimum interval between background syncs (5 minutes - reduced from 15)
    private let minimumSyncInterval: TimeInterval = 5 * 60
    
    /// Minimum interval between foreground syncs (2 minutes - more responsive)
    private let minimumForegroundSyncInterval: TimeInterval = 2 * 60
    private let defaultIncrementalDaysBack = 7
    private let maxIncrementalDaysBack = 30
    private let incrementalWindowBufferDays = 2
    private let maxSyncHistoryEntries = 40
    
    private enum StorageKeys {
        static let lastSyncTime = "BackgroundSyncV2.lastSyncTime"
        static let lastSyncAttemptTime = "BackgroundSyncV2.lastSyncAttemptTime"
        static let lastError = "BackgroundSyncV2.lastError"
        static let lastErrorTime = "BackgroundSyncV2.lastErrorTime"
        static let syncCount = "BackgroundSyncV2.syncCount"
        static let trackedMetricTypes = "BackgroundSyncV2.trackedMetricTypes"
        static let syncHistory = "BackgroundSyncV2.syncHistory"
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

    /// Debounce timer for HealthKit observer callbacks
    private var observerDebounceTimer: Timer?
    private let observerDebounceDuration: TimeInterval = 30 // seconds

    /// Maximum metric types accepted from server
    private let maxServerMetricTypes = 30

    /// Known valid metric type raw values (derived from MetricType enum)
    private static let validMetricTypeValues: Set<String> = Set(MetricType.allCases.map { $0.rawValue })
    
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

    var syncHistory: [SyncHistoryEntry] {
        get {
            guard let data = UserDefaults.standard.data(forKey: StorageKeys.syncHistory) else {
                return []
            }
            return (try? JSONDecoder().decode([SyncHistoryEntry].self, from: data)) ?? []
        }
        set {
            if let data = try? JSONEncoder().encode(newValue) {
                UserDefaults.standard.set(data, forKey: StorageKeys.syncHistory)
            }
        }
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
        #if DEBUG
        print("🌐 Network became available - flushing offline queue")
        #endif
        Task { [weak self] in
            await self?.flushOfflineQueue()
        }
    }
    
    // MARK: - Setup
    
    func setupBackgroundSync() {
        guard !isSetup else { return }
        isSetup = true
        
        registerBackgroundTask()
        
        // Re-enable background delivery if we have credentials and cached metrics
        if apiClient.hasStoredCredentials && !cachedMetricTypes.isEmpty {
            let metricTypes = cachedMetricTypes
            Task { [weak self] in
                await self?.enableBackgroundDelivery(forMetricTypes: metricTypes)
            }
        }
        
        #if DEBUG
        print("📱 Background sync V2 manager initialized (total syncs: \(syncCount))")
        #endif
    }
    
    private func registerBackgroundTask() {
        let registered = BGTaskScheduler.shared.register(
            forTaskWithIdentifier: Self.backgroundTaskIdentifier,
            using: nil
        ) { [weak self] task in
            self?.handleBackgroundTask(task as! BGAppRefreshTask)
        }
        
        if registered {
            #if DEBUG
            print("✅ Background task V2 registered")
            #endif
        } else {
            #if DEBUG
            print("⚠️ Failed to register background task V2")
            #endif
        }
    }
    
    func scheduleBackgroundSync() {
        let request = BGAppRefreshTaskRequest(identifier: Self.backgroundTaskIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: minimumSyncInterval)
        
        do {
            try BGTaskScheduler.shared.submit(request)
            #if DEBUG
            print("📅 Background sync scheduled")
            #endif
        } catch {
            #if DEBUG
            print("⚠️ Failed to schedule background sync: \(error)")
            #endif
        }
    }
    
    func cancelScheduledSync() {
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.backgroundTaskIdentifier)
    }
    
    private func handleBackgroundTask(_ task: BGAppRefreshTask) {
        #if DEBUG
        print("🔄 Background task started")
        #endif
        
        scheduleBackgroundSync() // Schedule next
        
        let syncTask = Task { [weak self] in
            await self?.performIncrementalSync(isBackground: true)
        }
        
        task.expirationHandler = {
            syncTask.cancel()
            #if DEBUG
            print("⚠️ Background task expired")
            #endif
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
                        #if DEBUG
                        print("⚠️ Observer error for \(metricType): \(error)")
                        #endif
                        completionHandler()
                        return
                    }

                    #if DEBUG
                    print("📊 New \(metricType) data detected")
                    #endif

                    // Debounce: wait for observer callbacks to settle before syncing
                    self?.scheduleObserverDebouncedSync()
                    completionHandler()
                }
                
                healthStore.execute(query)
                observerQueries.append(query)
                
                #if DEBUG
                print("✅ Background delivery enabled for: \(metricType)")
                #endif
            } catch {
                #if DEBUG
                print("⚠️ Failed to enable background delivery for \(metricType): \(error)")
                #endif
            }
        }
    }
    
    /// Schedule a debounced background sync after HealthKit observer callbacks.
    /// Waits for callbacks to settle (30s) before triggering a single sync.
    private func scheduleObserverDebouncedSync() {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.observerDebounceTimer?.invalidate()
            self.observerDebounceTimer = Timer.scheduledTimer(withTimeInterval: self.observerDebounceDuration, repeats: false) { [weak self] _ in
                Task { [weak self] in
                    await self?.performIncrementalSync(isBackground: true)
                }
            }
        }
    }

    func disableAllObservers() {
        for query in observerQueries {
            healthStore.stop(query)
        }
        observerQueries.removeAll()
        observerDebounceTimer?.invalidate()
        observerDebounceTimer = nil
    }
    
    // MARK: - Sync Methods
    
    /// Perform sync when app comes to foreground
    func performForegroundSync() async {
        guard let lastSync = lastSyncTime else {
            await performIncrementalSync(isBackground: false)
            return
        }
        
        if Date().timeIntervalSince(lastSync) < minimumForegroundSyncInterval {
            #if DEBUG
            print("⏱️ Skipping foreground sync - too recent")
            #endif
            return
        }
        
        await performIncrementalSync(isBackground: false)
    }
    
    /// Perform incremental sync using DAILY AGGREGATES
    /// This sends daily totals instead of raw samples for much better data quality
    func performIncrementalSync(isBackground: Bool, specificMetricType: String? = nil) async {
        guard !isSyncing else {
            #if DEBUG
            print("⚠️ Sync already in progress")
            #endif
            return
        }

        let syncStartTime = Date()
        var historyWindowDays = 0
        var historyMetricTypes: [String] = []
        var historyFailedMetricTypes = Set<String>()
        var historyFailedDays = Set<String>()
        var historyFailedBatches = 0
        var historyQueuedBatches = 0
        var historyAddedCount = 0

        func recordHistory(succeeded: Bool, errorMessage: String?) {
            appendSyncHistory(
                SyncHistoryEntry(
                    id: UUID().uuidString,
                    startedAt: syncStartTime,
                    finishedAt: Date(),
                    isBackground: isBackground,
                    isRetry: false,
                    windowDays: historyWindowDays,
                    succeeded: succeeded,
                    addedCount: historyAddedCount,
                    failedBatchCount: historyFailedBatches,
                    queuedBatchCount: historyQueuedBatches,
                    metricTypes: historyMetricTypes,
                    failedMetricTypes: Array(historyFailedMetricTypes).sorted(),
                    failedDays: Array(historyFailedDays).sorted(),
                    errorMessage: errorMessage
                )
            )
        }
        
        isSyncing = true
        defer { isSyncing = false }
        
        lastSyncAttemptTime = Date()
        
        // Check credentials
        guard apiClient.hasStoredCredentials else {
            #if DEBUG
            print("⚠️ No credentials - skipping sync")
            #endif
            recordHistory(succeeded: false, errorMessage: "No stored credentials")
            return
        }
        
        // Ensure token is valid (silent refresh if needed)
        do {
            try await apiClient.ensureValidToken()
        } catch let error as APIError where error.requiresReauth {
            #if DEBUG
            print("❌ Token refresh failed - requires re-auth")
            #endif
            lastError = error.localizedDescription
            lastErrorTime = Date()
            postSyncActionRequired(.authExpired, message: "Authentication expired. Open Ritual and sign in again.")
            
            // Post notification for UI to handle re-auth
            await MainActor.run {
                NotificationCenter.default.post(
                    name: NSNotification.Name("RequiresReauthentication"),
                    object: nil
                )
            }
            await scheduleReauthLocalNotification()
            recordHistory(succeeded: false, errorMessage: error.localizedDescription)
            return
        } catch {
            #if DEBUG
            print("⚠️ Token refresh error: \(error)")
            #endif
        }
        
        // Determine which metrics to sync
        let metricTypes: [String]
        if let specific = specificMetricType {
            metricTypes = [specific]
        } else {
            // Refresh tracked metrics from server
            do {
                let response = try await apiClient.fetchTrackedMetrics()
                metricTypes = validateMetricTypes(response.metricTypes)
                
                if cachedMetricTypes != metricTypes {
                    cachedMetricTypes = metricTypes
                    await enableBackgroundDelivery(forMetricTypes: metricTypes)
                }
            } catch {
                #if DEBUG
                print("⚠️ Failed to fetch tracked metrics, using cached: \(error)")
                #endif
                metricTypes = cachedMetricTypes
            }
        }

        historyMetricTypes = metricTypes
        
        guard !metricTypes.isEmpty else {
            #if DEBUG
            print("📊 No metrics to sync")
            #endif
            postSyncActionRequired(.noMetricsConfigured, message: "No tracked metrics configured. Choose metrics in Ritual desktop.")
            recordHistory(succeeded: true, errorMessage: nil)
            return
        }
        
        #if DEBUG
        print("🔄 Starting DAILY AGGREGATED sync for \(metricTypes.count) metric types...")
        #endif
        
        // First, flush any pending offline queue items
        await flushOfflineQueue()
        
        // Fetch DAILY AGGREGATED data with a dynamic incremental window.
        // This keeps payloads bounded while widening the window after longer gaps.
        var allMetrics: [NormalizedMetric] = []
        let daysBack = resolvedIncrementalDaysBack()
        historyWindowDays = daysBack
        
        for metricType in metricTypes {
            do {
                let metrics = try await healthKitManager.fetchDailyAggregatedMetrics(
                    for: metricType,
                    daysBack: daysBack
                )
                allMetrics.append(contentsOf: metrics)
            } catch {
                #if DEBUG
                print("⚠️ Failed to fetch daily aggregates for \(metricType): \(error.localizedDescription)")
                #endif
                historyFailedMetricTypes.insert(metricType)
            }
        }
        
        // Skip if no data
        guard !allMetrics.isEmpty else {
            #if DEBUG
            print("📊 No data to sync")
            #endif
            lastSyncTime = Date()
            lastError = nil
            let historyError = historyFailedMetricTypes.isEmpty ? nil : "Failed to fetch one or more metric types"
            recordHistory(succeeded: historyFailedMetricTypes.isEmpty, errorMessage: historyError)
            return
        }
        
        #if DEBUG
        print("📊 Syncing \(allMetrics.count) daily aggregate values (\(daysBack)-day window)")
        #endif
        
        // Batch size limit (backend accepts max 500, use 400 for safety)
        let batchSize = 400
        let pendingAnchors = await capturePendingAnchors(for: metricTypes)
        let pendingAnchorTokens = healthKitManager.makeAnchorTokens(pendingAnchors)
        
        // Try to send to backend in batches
        var totalSuccess = 0
        var allBatchesSucceeded = true
        var confirmedAnchorTokens: [String: String]? = nil
        
        // Split into batches
        let batches = stride(from: 0, to: allMetrics.count, by: batchSize).map {
            Array(allMetrics[$0..<min($0 + batchSize, allMetrics.count)])
        }
        
        #if DEBUG
        print("📦 Sending \(batches.count) batch(es)...")
        #endif
        
        var failedBatches = 0
        let startTime = Date()
        
        for (i, batch) in batches.enumerated() {
            if batch.isEmpty { continue }
            
            // Log progress
            let elapsed = Date().timeIntervalSince(startTime)
            #if DEBUG
            print("📤 Batch \(i + 1)/\(batches.count): \(batch.count) daily values (elapsed: \(Int(elapsed))s)")
            #endif
            
            do {
                let response = try await apiClient.ingestMetricsV2(
                    added: batch,
                    deleted: [],
                    modified: [],
                    anchors: pendingAnchorTokens.isEmpty ? nil : pendingAnchorTokens
                )
                
                if response.success {
                    totalSuccess += batch.count
                    if response.confirmedAnchors != nil {
                        confirmedAnchorTokens = response.confirmedAnchors
                    }
                } else {
                    allBatchesSucceeded = false
                    failedBatches += 1
                    historyFailedBatches += 1
                    historyFailedMetricTypes.formUnion(metricTypeSet(from: batch))
                    historyFailedDays.formUnion(dayKeys(from: batch))
                    #if DEBUG
                    print("⚠️ Batch \(i + 1) rejected by server")
                    #endif
                }
            } catch let error as APIError where error.shouldQueue {
                #if DEBUG
                print("📥 Network error - queuing batch \(i + 1) for retry")
                #endif
                allBatchesSucceeded = false
                historyFailedBatches += 1
                historyQueuedBatches += 1
                historyFailedMetricTypes.formUnion(metricTypeSet(from: batch))
                historyFailedDays.formUnion(dayKeys(from: batch))
                
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
                allBatchesSucceeded = false
                failedBatches += 1
                historyFailedBatches += 1
                historyFailedMetricTypes.formUnion(metricTypeSet(from: batch))
                historyFailedDays.formUnion(dayKeys(from: batch))
                #if DEBUG
                print("⚠️ Batch \(i + 1) failed: \(error.localizedDescription)")
                #endif
                
                if failedBatches >= 5 {
                    #if DEBUG
                    print("❌ Too many batch failures (\(failedBatches)), stopping sync")
                    #endif
                    break
                }
            }
            
            // Small delay between batches
            if i < batches.count - 1 {
                try? await Task.sleep(nanoseconds: 50_000_000) // 50ms
            }
        }
        
        let totalElapsed = Date().timeIntervalSince(startTime)
        #if DEBUG
        print("📊 Sync completed in \(Int(totalElapsed))s: \(totalSuccess) daily values synced, \(failedBatches) failed batches")
        #endif
        historyAddedCount = totalSuccess
        
        if totalSuccess > 0 {
            lastSyncTime = Date()
            lastError = nil
            syncCount += 1

            if allBatchesSucceeded && !pendingAnchors.isEmpty {
                healthKitManager.confirmAnchorsFromServer(
                    confirmedAnchorTokens: confirmedAnchorTokens,
                    pendingAnchors: pendingAnchors
                )
            }
            
            #if DEBUG
            print("✅ Daily aggregated sync complete: \(totalSuccess) values (total syncs: \(syncCount))")
            #endif
            
            let addedCount = totalSuccess
            let completionTime = Date()
            await MainActor.run {
                NotificationCenter.default.post(
                    name: NSNotification.Name("BackgroundSyncCompleted"),
                    object: nil,
                    userInfo: [
                        "addedCount": addedCount,
                        "deletedCount": 0,
                        "time": completionTime
                    ]
                )
            }
            recordHistory(
                succeeded: allBatchesSucceeded,
                errorMessage: allBatchesSucceeded ? nil : "Partial sync completed with failed batches"
            )
            if !allBatchesSucceeded {
                postSyncActionRequired(.partialFailure, message: "Some sync batches failed. Open Ritual to retry failed days.")
            }
            if historyQueuedBatches > 0 {
                postSyncActionRequired(.networkQueued, message: "Sync queued due to network issues. Retry will happen automatically.")
            }
        } else if !allBatchesSucceeded {
            #if DEBUG
            print("❌ Sync failed - no data was successfully synced")
            #endif
            lastError = "Sync failed"
            lastErrorTime = Date()
            recordHistory(succeeded: false, errorMessage: "Sync failed")
            if historyQueuedBatches > 0 {
                postSyncActionRequired(.networkQueued, message: "Sync queued due to network issues. Retry will happen automatically.")
            } else {
                postSyncActionRequired(.partialFailure, message: "Sync failed. Open Ritual to review and retry.")
            }
        } else {
            recordHistory(succeeded: true, errorMessage: nil)
        }
    }

    /// Retry sync for specific failed day keys (YYYY-MM-DD).
    /// This is used by the UI to recover from partial/failed sync runs.
    @discardableResult
    func retryFailedDays(_ failedDayKeys: [String]) async -> Int {
        let normalizedDayKeys = Set(
            failedDayKeys
                .map { String($0.prefix(10)) }
                .filter { $0.count == 10 }
        )

        guard !normalizedDayKeys.isEmpty else { return 0 }

        guard !isSyncing else {
            #if DEBUG
            print("⚠️ Sync already in progress")
            #endif
            return 0
        }

        let syncStartTime = Date()
        var historyMetricTypes: [String] = []
        var historyFailedMetricTypes = Set<String>()
        var historyFailedDays = Set<String>()
        var historyFailedBatches = 0
        var historyQueuedBatches = 0
        var historyAddedCount = 0

        func recordHistory(succeeded: Bool, errorMessage: String?) {
            appendSyncHistory(
                SyncHistoryEntry(
                    id: UUID().uuidString,
                    startedAt: syncStartTime,
                    finishedAt: Date(),
                    isBackground: false,
                    isRetry: true,
                    windowDays: maxIncrementalDaysBack,
                    succeeded: succeeded,
                    addedCount: historyAddedCount,
                    failedBatchCount: historyFailedBatches,
                    queuedBatchCount: historyQueuedBatches,
                    metricTypes: historyMetricTypes,
                    failedMetricTypes: Array(historyFailedMetricTypes).sorted(),
                    failedDays: Array(historyFailedDays).sorted(),
                    errorMessage: errorMessage
                )
            )
        }

        isSyncing = true
        defer { isSyncing = false }

        lastSyncAttemptTime = Date()

        guard apiClient.hasStoredCredentials else {
            recordHistory(succeeded: false, errorMessage: "No stored credentials")
            return 0
        }

        do {
            try await apiClient.ensureValidToken()
        } catch let error as APIError where error.requiresReauth {
            lastError = error.localizedDescription
            lastErrorTime = Date()
            postSyncActionRequired(.authExpired, message: "Authentication expired. Open Ritual and sign in again.")

            await MainActor.run {
                NotificationCenter.default.post(
                    name: NSNotification.Name("RequiresReauthentication"),
                    object: nil
                )
            }
            await scheduleReauthLocalNotification()

            recordHistory(succeeded: false, errorMessage: error.localizedDescription)
            return 0
        } catch {
            #if DEBUG
            print("⚠️ Token refresh error during retry: \(error)")
            #endif
        }

        let metricTypes: [String]
        do {
            let response = try await apiClient.fetchTrackedMetrics()
            metricTypes = validateMetricTypes(response.metricTypes)
        } catch {
            #if DEBUG
            print("⚠️ Failed to fetch tracked metrics for retry, using cached: \(error)")
            #endif
            metricTypes = cachedMetricTypes
        }

        historyMetricTypes = metricTypes

        guard !metricTypes.isEmpty else {
            recordHistory(succeeded: false, errorMessage: "No metric types configured")
            postSyncActionRequired(.noMetricsConfigured, message: "No tracked metrics configured. Choose metrics in Ritual desktop.")
            return 0
        }

        var retryMetrics: [NormalizedMetric] = []

        for metricType in metricTypes {
            do {
                let metrics = try await healthKitManager.fetchDailyAggregatedMetrics(
                    for: metricType,
                    daysBack: maxIncrementalDaysBack
                )

                let filtered = metrics.filter { metric in
                    guard let dayKey = dayKey(for: metric) else { return false }
                    return normalizedDayKeys.contains(dayKey)
                }

                retryMetrics.append(contentsOf: filtered)
            } catch {
                historyFailedMetricTypes.insert(metricType)
                #if DEBUG
                print("⚠️ Failed to fetch retry metrics for \(metricType): \(error.localizedDescription)")
                #endif
            }
        }

        guard !retryMetrics.isEmpty else {
            let historyError = historyFailedMetricTypes.isEmpty ? "No retry data found for selected days" : "Failed to load retry metrics"
            recordHistory(succeeded: false, errorMessage: historyError)
            return 0
        }

        let batchSize = 400
        let batches = stride(from: 0, to: retryMetrics.count, by: batchSize).map {
            Array(retryMetrics[$0..<min($0 + batchSize, retryMetrics.count)])
        }

        var totalSuccess = 0
        var allBatchesSucceeded = true

        for (index, batch) in batches.enumerated() {
            if batch.isEmpty { continue }

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
                    historyFailedBatches += 1
                    historyFailedMetricTypes.formUnion(metricTypeSet(from: batch))
                    historyFailedDays.formUnion(dayKeys(from: batch))
                }
            } catch let error as APIError where error.shouldQueue {
                allBatchesSucceeded = false
                historyFailedBatches += 1
                historyQueuedBatches += 1
                historyFailedMetricTypes.formUnion(metricTypeSet(from: batch))
                historyFailedDays.formUnion(dayKeys(from: batch))

                if let data = try? JSONEncoder().encode(batch) {
                    _ = offlineQueue.enqueue(
                        clientEventId: UUID().uuidString,
                        payload: data,
                        metricCount: batch.count
                    )
                }
            } catch {
                allBatchesSucceeded = false
                historyFailedBatches += 1
                historyFailedMetricTypes.formUnion(metricTypeSet(from: batch))
                historyFailedDays.formUnion(dayKeys(from: batch))
                #if DEBUG
                print("⚠️ Retry batch \(index + 1) failed: \(error.localizedDescription)")
                #endif
            }

            if index < batches.count - 1 {
                try? await Task.sleep(nanoseconds: 50_000_000)
            }
        }

        historyAddedCount = totalSuccess

        if totalSuccess > 0 {
            lastSyncTime = Date()
            lastError = nil
            syncCount += 1

            let addedCount = totalSuccess
            let completionTime = Date()
            await MainActor.run {
                NotificationCenter.default.post(
                    name: NSNotification.Name("BackgroundSyncCompleted"),
                    object: nil,
                    userInfo: [
                        "addedCount": addedCount,
                        "deletedCount": 0,
                        "time": completionTime,
                        "isRetry": true
                    ]
                )
            }

            recordHistory(
                succeeded: allBatchesSucceeded,
                errorMessage: allBatchesSucceeded ? nil : "Retry partially succeeded"
            )
            if !allBatchesSucceeded {
                postSyncActionRequired(.partialFailure, message: "Retry only partially succeeded. Open Ritual to retry remaining days.")
            }
            if historyQueuedBatches > 0 {
                postSyncActionRequired(.networkQueued, message: "Retry batches were queued due to network issues.")
            }
        } else {
            lastError = "Retry failed"
            lastErrorTime = Date()
            recordHistory(succeeded: false, errorMessage: "Retry failed")
            if historyQueuedBatches > 0 {
                postSyncActionRequired(.networkQueued, message: "Retry batches were queued due to network issues.")
            } else {
                postSyncActionRequired(.partialFailure, message: "Retry failed. Open Ritual to try again.")
            }
        }

        return totalSuccess
    }

    @discardableResult
    func retryDateRange(startDate: Date, endDate: Date) async -> RetryDateRangeResult {
        let calendar = Calendar.current
        let normalizedStart = calendar.startOfDay(for: min(startDate, endDate))
        let normalizedEnd = calendar.startOfDay(for: max(startDate, endDate))
        let attemptedDayKeys = dayKeys(from: normalizedStart, to: normalizedEnd)

        guard !attemptedDayKeys.isEmpty else {
            return RetryDateRangeResult(
                attemptedDays: 0,
                syncedMetricCount: 0,
                failedDays: [],
                queuedBatchCount: 0,
                errorMessage: "No valid dates selected."
            )
        }

        guard !isSyncing else {
            return RetryDateRangeResult(
                attemptedDays: attemptedDayKeys.count,
                syncedMetricCount: 0,
                failedDays: attemptedDayKeys,
                queuedBatchCount: 0,
                errorMessage: "Sync already in progress."
            )
        }

        isSyncing = true
        defer { isSyncing = false }

        lastSyncAttemptTime = Date()

        guard apiClient.hasStoredCredentials else {
            return RetryDateRangeResult(
                attemptedDays: attemptedDayKeys.count,
                syncedMetricCount: 0,
                failedDays: attemptedDayKeys,
                queuedBatchCount: 0,
                errorMessage: "No stored credentials"
            )
        }

        do {
            try await apiClient.ensureValidToken()
        } catch let error as APIError where error.requiresReauth {
            lastError = error.localizedDescription
            lastErrorTime = Date()
            postSyncActionRequired(.authExpired, message: "Authentication expired. Open Ritual and sign in again.")
            await MainActor.run {
                NotificationCenter.default.post(
                    name: NSNotification.Name("RequiresReauthentication"),
                    object: nil
                )
            }
            await scheduleReauthLocalNotification()
            return RetryDateRangeResult(
                attemptedDays: attemptedDayKeys.count,
                syncedMetricCount: 0,
                failedDays: attemptedDayKeys,
                queuedBatchCount: 0,
                errorMessage: error.localizedDescription
            )
        } catch {
            #if DEBUG
            print("⚠️ Token refresh error during date-range retry: \(error)")
            #endif
        }

        let metricTypes: [String]
        do {
            let response = try await apiClient.fetchTrackedMetrics()
            metricTypes = validateMetricTypes(response.metricTypes)
        } catch {
            metricTypes = cachedMetricTypes
        }

        guard !metricTypes.isEmpty else {
            postSyncActionRequired(.noMetricsConfigured, message: "No tracked metrics configured. Choose metrics in Ritual desktop.")
            return RetryDateRangeResult(
                attemptedDays: attemptedDayKeys.count,
                syncedMetricCount: 0,
                failedDays: attemptedDayKeys,
                queuedBatchCount: 0,
                errorMessage: "No metric types configured"
            )
        }

        var retryMetrics: [NormalizedMetric] = []
        var dataLoadFailedDays = Set<String>()

        for metricType in metricTypes {
            do {
                let metrics = try await healthKitManager.fetchDailyAggregatedMetrics(
                    for: metricType,
                    startDate: normalizedStart,
                    endDate: normalizedEnd
                )
                let filtered = metrics.filter { metric in
                    guard let key = dayKey(for: metric) else { return false }
                    return attemptedDayKeys.contains(key)
                }
                retryMetrics.append(contentsOf: filtered)
            } catch {
                #if DEBUG
                print("⚠️ Failed to load \(metricType) for date-range retry: \(error.localizedDescription)")
                #endif
                dataLoadFailedDays.formUnion(attemptedDayKeys)
            }
        }

        guard !retryMetrics.isEmpty else {
            let failed = Array(Set(attemptedDayKeys).union(dataLoadFailedDays)).sorted()
            postSyncActionRequired(.partialFailure, message: "No data available for selected retry dates.")
            return RetryDateRangeResult(
                attemptedDays: attemptedDayKeys.count,
                syncedMetricCount: 0,
                failedDays: failed,
                queuedBatchCount: 0,
                errorMessage: "No retry data found for selected dates."
            )
        }

        let batchSize = 400
        let batches = stride(from: 0, to: retryMetrics.count, by: batchSize).map {
            Array(retryMetrics[$0..<min($0 + batchSize, retryMetrics.count)])
        }

        var totalSuccess = 0
        var queuedBatchCount = 0
        var failedDays = dataLoadFailedDays

        for (index, batch) in batches.enumerated() {
            if batch.isEmpty { continue }

            do {
                let response = try await apiClient.ingestMetricsV2(
                    added: batch,
                    deleted: [],
                    modified: []
                )
                if response.success {
                    totalSuccess += batch.count
                } else {
                    failedDays.formUnion(dayKeys(from: batch))
                }
            } catch let error as APIError where error.shouldQueue {
                queuedBatchCount += 1
                failedDays.formUnion(dayKeys(from: batch))
                if let data = try? JSONEncoder().encode(batch) {
                    _ = offlineQueue.enqueue(
                        clientEventId: UUID().uuidString,
                        payload: data,
                        metricCount: batch.count
                    )
                }
            } catch {
                #if DEBUG
                print("⚠️ Date-range retry batch \(index + 1) failed: \(error.localizedDescription)")
                #endif
                failedDays.formUnion(dayKeys(from: batch))
            }

            if index < batches.count - 1 {
                try? await Task.sleep(nanoseconds: 50_000_000)
            }
        }

        if totalSuccess > 0 {
            lastSyncTime = Date()
            lastError = nil
            syncCount += 1
            let addedCount = totalSuccess
            let completionTime = Date()
            await MainActor.run {
                NotificationCenter.default.post(
                    name: NSNotification.Name("BackgroundSyncCompleted"),
                    object: nil,
                    userInfo: [
                        "addedCount": addedCount,
                        "deletedCount": 0,
                        "time": completionTime,
                        "isRetry": true,
                        "isDateRangeRetry": true
                    ]
                )
            }
        } else {
            lastError = "Date-range retry failed"
            lastErrorTime = Date()
        }

        let result = RetryDateRangeResult(
            attemptedDays: attemptedDayKeys.count,
            syncedMetricCount: totalSuccess,
            failedDays: Array(failedDays).sorted(),
            queuedBatchCount: queuedBatchCount,
            errorMessage: totalSuccess > 0 ? nil : "Retry failed"
        )

        await MainActor.run {
            NotificationCenter.default.post(
                name: .syncRetryCompleted,
                object: nil,
                userInfo: [
                    "attemptedDays": result.attemptedDays,
                    "syncedMetricCount": result.syncedMetricCount,
                    "failedDays": result.failedDays,
                    "queuedBatchCount": result.queuedBatchCount
                ]
            )
        }

        if !result.failedDays.isEmpty {
            postSyncActionRequired(.partialFailure, message: "Retry completed with remaining failed days.")
            Task { @MainActor in
                NotificationManager.shared.sendRetryCompleted(
                    remainingFailedDays: result.failedDays.count,
                    syncedMetricCount: result.syncedMetricCount
                )
            }
        }
        if result.queuedBatchCount > 0 {
            postSyncActionRequired(.networkQueued, message: "Retry batches were queued due to network issues.")
        }

        return result
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
                    #if DEBUG
                    print("✅ Flushed queued payload \(payload.id)")
                    #endif
                } else {
                    offlineQueue.markFailed(id: payload.id, error: "Server rejected")
                }
                
            } catch {
                offlineQueue.markFailed(id: payload.id, error: error.localizedDescription)
                #if DEBUG
                print("❌ Failed to flush payload \(payload.id): \(error)")
                #endif
            }
        }
    }
    
    /// Perform a full backfill using DAILY AGGREGATES (recommended for initial setup)
    /// This sends daily totals instead of raw samples (e.g., 700 daily values vs 50,000 raw samples)
    func performFullBackfill(daysBack: Int = 730, progressHandler: ((Int, Int) -> Void)? = nil) async throws -> Int {
        guard apiClient.hasStoredCredentials else {
            throw APIError.notRegistered
        }
        
        #if DEBUG
        print("📊 Starting DAILY AGGREGATED backfill for \(daysBack) days...")
        print("   (This sends ~\(daysBack) daily values per metric instead of thousands of raw samples)")
        #endif
        
        // Use the new daily aggregated backfill method
        let metrics = try await healthKitManager.performDailyAggregatedBackfill(
            for: cachedMetricTypes,
            daysBack: daysBack,
            progressHandler: progressHandler
        )
        
        guard !metrics.isEmpty else {
            #if DEBUG
            print("📊 No metrics to backfill")
            #endif
            return 0
        }
        
        // Batch the backfill to avoid 500 item limit (though with daily aggregates we rarely hit this)
        let batchSize = 400
        let batches = stride(from: 0, to: metrics.count, by: batchSize).map {
            Array(metrics[$0..<min($0 + batchSize, metrics.count)])
        }
        
        #if DEBUG
        print("📦 Backfill: \(metrics.count) DAILY metrics in \(batches.count) batch(es)")
        #endif
        
        var totalSuccess = 0
        let startTime = Date()
        
        for (index, batch) in batches.enumerated() {
            #if DEBUG
            print("📤 Backfill batch \(index + 1)/\(batches.count): \(batch.count) daily metrics")
            #endif
            
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
                #if DEBUG
                print("⚠️ Batch \(index + 1) failed: \(error.localizedDescription)")
                #endif
                // Continue with remaining batches
            }
            
            // Small delay between batches
            if index < batches.count - 1 {
                try await Task.sleep(nanoseconds: 100_000_000) // 100ms
            }
        }
        
        let elapsed = Date().timeIntervalSince(startTime)
        #if DEBUG
        print("✅ Backfill complete in \(Int(elapsed))s: \(totalSuccess) daily aggregates synced")
        #endif
        
        if totalSuccess > 0 {
            lastSyncTime = Date()
            lastError = nil
        }
        
        return totalSuccess
    }
    
    // MARK: - Local Notifications

    private func scheduleReauthLocalNotification() async {
        let content = UNMutableNotificationContent()
        content.title = "Ritual"
        content.body = "Your session has expired. Please open Ritual to continue syncing."
        content.sound = .default
        let request = UNNotificationRequest(identifier: "ritual-reauth", content: content, trigger: nil)
        try? await UNUserNotificationCenter.current().add(request)
    }

    // MARK: - Metric Type Validation

    /// Validate server-returned metric types against known valid values.
    /// Returns validated list, falling back to cached if validation fails entirely.
    private func validateMetricTypes(_ serverTypes: [String]) -> [String] {
        // Cap at maximum allowed count
        let capped = Array(serverTypes.prefix(maxServerMetricTypes))

        // Filter to known valid metric types
        let validated = capped.filter { Self.validMetricTypeValues.contains($0) }

        if validated.isEmpty && !serverTypes.isEmpty {
            // All server types were invalid - fall back to cached
            #if DEBUG
            print("⚠️ All server metric types invalid, falling back to cached: \(serverTypes)")
            #endif
            return cachedMetricTypes
        }

        if validated.count < capped.count {
            #if DEBUG
            let rejected = Set(capped).subtracting(validated)
            #if DEBUG
            print("⚠️ Rejected unknown metric types from server: \(rejected)")
            #endif
            #endif
        }

        return validated
    }

    // MARK: - Helpers

    private func appendSyncHistory(_ entry: SyncHistoryEntry) {
        var history = syncHistory
        history.insert(entry, at: 0)

        if history.count > maxSyncHistoryEntries {
            history = Array(history.prefix(maxSyncHistoryEntries))
        }

        syncHistory = history
    }

    private func dayKey(for metric: NormalizedMetric) -> String? {
        if let attributedDate = metric.attributedDate, !attributedDate.isEmpty {
            return attributedDate
        }

        guard metric.startTime.count >= 10 else { return nil }
        return String(metric.startTime.prefix(10))
    }

    private func dayKeys(from metrics: [NormalizedMetric]) -> Set<String> {
        Set(metrics.compactMap { dayKey(for: $0) })
    }

    private func metricTypeSet(from metrics: [NormalizedMetric]) -> Set<String> {
        Set(metrics.map { $0.metricType.rawValue })
    }

    private func resolvedIncrementalDaysBack() -> Int {
        guard let lastSync = lastSyncTime else {
            return defaultIncrementalDaysBack
        }

        let daysSinceSync = Int(Date().timeIntervalSince(lastSync) / 86_400.0)
        let rawWindow = max(1, daysSinceSync + incrementalWindowBufferDays)
        return min(maxIncrementalDaysBack, rawWindow)
    }

    private func capturePendingAnchors(for metricTypes: [String]) async -> [String: HKQueryAnchor] {
        var anchors: [String: HKQueryAnchor] = [:]

        for metricType in metricTypes {
            do {
                if let anchor = try await healthKitManager.captureAnchorBaseline(for: metricType) {
                    anchors[metricType] = anchor
                }
            } catch {
                #if DEBUG
                print("⚠️ Failed to capture anchor baseline for \(metricType): \(error.localizedDescription)")
                #endif
            }
        }

        return anchors
    }

    private func dayKeys(from startDate: Date, to endDate: Date) -> [String] {
        let calendar = Calendar.current
        var current = calendar.startOfDay(for: startDate)
        let end = calendar.startOfDay(for: endDate)
        var keys: [String] = []

        while current <= end {
            let formatter = DateFormatter()
            formatter.dateFormat = "yyyy-MM-dd"
            keys.append(formatter.string(from: current))
            guard let next = calendar.date(byAdding: .day, value: 1, to: current) else { break }
            current = next
        }

        return keys
    }

    private func postSyncActionRequired(_ reason: SyncActionRequiredReason, message: String? = nil) {
        Task { @MainActor in
            NotificationCenter.default.post(
                name: .syncActionRequired,
                object: nil,
                userInfo: [
                    "reason": reason.rawValue,
                    "message": message ?? ""
                ]
            )
        }
    }

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

    var queueTelemetry: OfflineSyncQueue.QueueTelemetry {
        offlineQueue.telemetry
    }
    
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

    struct SyncHistoryEntry: Identifiable, Codable {
        let id: String
        let startedAt: Date
        let finishedAt: Date
        let isBackground: Bool
        let isRetry: Bool
        let windowDays: Int
        let succeeded: Bool
        let addedCount: Int
        let failedBatchCount: Int
        let queuedBatchCount: Int
        let metricTypes: [String]
        let failedMetricTypes: [String]
        let failedDays: [String]
        let errorMessage: String?
    }

    struct RetryDateRangeResult {
        let attemptedDays: Int
        let syncedMetricCount: Int
        let failedDays: [String]
        let queuedBatchCount: Int
        let errorMessage: String?
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
