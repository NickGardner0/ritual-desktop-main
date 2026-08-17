import Foundation
import HealthKit
import BackgroundTasks
import UIKit
import UserNotifications

enum RetryScope {
    case dayKeys(Set<String>)
    case dateRange(ClosedRange<Date>)

    static func normalizedDateRange(
        startDate: Date,
        endDate: Date,
        calendar: Calendar = .current
    ) -> RetryScope {
        let start = calendar.startOfDay(for: min(startDate, endDate))
        let end = calendar.startOfDay(for: max(startDate, endDate))
        return .dateRange(start ... end)
    }
}

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
        static let trackedMetricSyncModes = "BackgroundSyncV2.trackedMetricSyncModes"
        static let trackedMetricProjectionFlags = "BackgroundSyncV2.trackedMetricProjectionFlags"
        static let syncHistory = "BackgroundSyncV2.syncHistory"
    }
    
    // MARK: - Properties
    
    private let healthStore = HKHealthStore()
    private let healthKitManager = HealthKitManagerV2()
    private let apiClient = RitualAPIClient.shared
    private let offlineQueue = OfflineSyncQueue.shared
    private let anchorStorage = AnchorStorage.shared

    private var observerQueries: [HKObserverQuery] = []
    private var isSetup = false

    // `isSyncing` was previously a plain `Bool` read/written from multiple
    // executors (BGAppRefreshTask handler, MainActor UI, HealthKit observer
    // debounce, network-availability notification). The "guard !isSyncing →
    // set isSyncing = true" pattern had a TOCTOU race that let two sync runs
    // start concurrently. We now gate it behind a lock and expose an atomic
    // check-and-set so only one caller can ever enter the critical section.
    private let syncingLock = NSLock()
    private var _isSyncing = false

    /// Thread-safe read of the syncing flag. Used by UI / debug surfaces.
    private var isSyncing: Bool {
        syncingLock.lock()
        defer { syncingLock.unlock() }
        return _isSyncing
    }

    /// Atomic "acquire the sync gate" — returns `true` iff this caller won
    /// the race and is now responsible for calling `endSyncing()` exactly
    /// once (use a `defer`). Returns `false` if another sync is in flight.
    private func beginSyncingIfIdle() -> Bool {
        syncingLock.lock()
        defer { syncingLock.unlock() }
        guard !_isSyncing else { return false }
        _isSyncing = true
        return true
    }

    /// Release the sync gate. Safe to call multiple times.
    private func endSyncing() {
        syncingLock.lock()
        defer { syncingLock.unlock() }
        _isSyncing = false
    }

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

    var cachedMetricSyncModes: [String: String] {
        get {
            guard let data = UserDefaults.standard.data(forKey: StorageKeys.trackedMetricSyncModes) else {
                return [:]
            }
            return (try? JSONDecoder().decode([String: String].self, from: data)) ?? [:]
        }
        set {
            if let data = try? JSONEncoder().encode(newValue) {
                UserDefaults.standard.set(data, forKey: StorageKeys.trackedMetricSyncModes)
            }
        }
    }

    var cachedMetricProjectionFlags: [String: Bool] {
        get {
            guard let data = UserDefaults.standard.data(forKey: StorageKeys.trackedMetricProjectionFlags) else {
                return [:]
            }
            return (try? JSONDecoder().decode([String: Bool].self, from: data)) ?? [:]
        }
        set {
            if let data = try? JSONEncoder().encode(newValue) {
                UserDefaults.standard.set(data, forKey: StorageKeys.trackedMetricProjectionFlags)
            }
        }
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

        // Re-enable background delivery if we have credentials and cached metrics.
        // `apiClient.hasStoredCredentials` is now actor-isolated, so we need a
        // Task hop to read it. We still gate on the cheap local check first.
        if !cachedMetricTypes.isEmpty {
            let metricTypes = cachedMetricTypes
            Task { [weak self] in
                guard let self else { return }
                guard await self.apiClient.hasStoredCredentials else { return }
                await self.enableBackgroundDelivery(forMetricTypes: metricTypes)
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
            Task { [weak self] in
                await self?.submitTelemetryEvent(
                    eventType: "background_task_expired",
                    taskType: "background",
                    success: false
                )
            }
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
            guard let hkType = HealthKitManagerV2.sampleType(for: metricType) else { continue }
            
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

                    guard let self else {
                        completionHandler()
                        return
                    }

                    let taskType = UIApplication.shared.applicationState == .background ? "background" : "foreground"
                    if UIApplication.shared.applicationState == .background {
                        Task {
                            await self.submitTelemetryEvent(
                                eventType: "healthkit_observer_delivery",
                                taskType: taskType,
                                metricType: metricType,
                                success: true
                            )
                            await self.performIncrementalSync(isBackground: true, specificMetricType: metricType)
                            completionHandler()
                        }
                    } else {
                        // Foreground observer bursts still benefit from a short debounce.
                        self.scheduleObserverDebouncedSync()
                        Task {
                            await self.submitTelemetryEvent(
                                eventType: "healthkit_observer_delivery",
                                taskType: taskType,
                                metricType: metricType,
                                success: true
                            )
                        }
                        completionHandler()
                    }
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

    private func syncModesByMetricType(from response: TrackedMetricsResponse) -> [String: String] {
        response.syncModesByMetricType.mapValues { $0.rawValue }
    }

    private func projectionFlagsByMetricType(from response: TrackedMetricsResponse) -> [String: Bool] {
        response.metrics.mapValues { preference in
            preference.syncPlan?.projectsToHabitLogs ?? (preference.syncMode == .dailyOnly)
        }
    }

    private struct MetricSyncPlan {
        let metricType: String
        let syncMode: MetricSyncMode
        let projectsToHabitLogs: Bool
        let safeHistoryDays: Int?
    }

    private struct IngestBatch {
        let added: [NormalizedMetric]
        let deleted: [String]
    }

    private func syncMode(for metricType: String, syncModes: [String: String]) -> MetricSyncMode {
        guard let rawValue = syncModes[metricType], let mode = MetricSyncMode(rawValue: rawValue) else {
            return .dailyOnly
        }
        return mode
    }

    private func syncPlans(
        metricTypes: [String],
        syncModes: [String: String],
        projectionFlags: [String: Bool] = [:]
    ) -> [MetricSyncPlan] {
        validateMetricTypes(metricTypes).compactMap { metricType in
            let mode = syncMode(for: metricType, syncModes: syncModes)
            guard mode != .off else { return nil }
            return MetricSyncPlan(
                metricType: metricType,
                syncMode: mode,
                projectsToHabitLogs: projectionFlags[metricType] ?? (mode == .dailyOnly),
                safeHistoryDays: nil
            )
        }
    }

    private func syncPlans(from response: TrackedMetricsResponse) -> [MetricSyncPlan] {
        validateMetricTypes(response.metricTypes).compactMap { metricType in
            guard let preference = response.metrics[metricType] else { return nil }
            let mode = preference.syncMode
            guard mode != .off else { return nil }
            return MetricSyncPlan(
                metricType: metricType,
                syncMode: mode,
                projectsToHabitLogs: preference.syncPlan?.projectsToHabitLogs ?? (mode == .dailyOnly),
                safeHistoryDays: preference.syncPlan?.safeHistoryDays
            )
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
        let taskType = isBackground ? "background" : "foreground"

        // Atomic check-and-set. Without this, two concurrent callers can both
        // pass the guard and each set `isSyncing = true`, running parallel
        // syncs that duplicate work and clobber anchor state.
        guard beginSyncingIfIdle() else {
            #if DEBUG
            print("⚠️ Sync already in progress")
            #endif
            await submitTelemetryEvent(
                eventType: "sync_skipped_already_running",
                taskType: taskType,
                metricType: specificMetricType,
                success: false
            )
            return
        }
        defer { endSyncing() }

        let syncStartTime = Date()
        var telemetryEvents: [AppleSyncTelemetryEvent] = [
            makeTelemetryEvent(
                eventType: "sync_start",
                taskType: taskType,
                metricType: specificMetricType,
                windowDays: nil
            )
        ]
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
        
        lastSyncAttemptTime = Date()

        // Check credentials (actor-isolated; must `await`).
        guard await apiClient.hasStoredCredentials else {
            #if DEBUG
            print("⚠️ No credentials - skipping sync")
            #endif
            telemetryEvents.append(makeTelemetryEvent(
                eventType: "credentials_missing",
                taskType: taskType,
                metricType: specificMetricType,
                success: false
            ))
            recordHistory(succeeded: false, errorMessage: "No stored credentials")
            await submitTelemetry(telemetryEvents)
            return
        }
        telemetryEvents.append(makeTelemetryEvent(
            eventType: "credentials_present",
            taskType: taskType,
            metricType: specificMetricType,
            success: true
        ))
        
        // Ensure token is valid (silent refresh if needed)
        do {
            try await apiClient.ensureValidToken()
            telemetryEvents.append(makeTelemetryEvent(
                eventType: "credentials_valid",
                taskType: taskType,
                metricType: specificMetricType,
                success: true
            ))
        } catch let error as APIError where error.requiresReauth {
            #if DEBUG
            print("❌ Token refresh failed - requires re-auth")
            #endif
            lastError = error.localizedDescription
            lastErrorTime = Date()
            telemetryEvents.append(makeTelemetryEvent(
                eventType: "credentials_invalid",
                taskType: taskType,
                metricType: specificMetricType,
                success: false,
                errorMessage: error.localizedDescription
            ))
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
            await submitTelemetry(telemetryEvents)
            return
        } catch {
            #if DEBUG
            print("⚠️ Token refresh error: \(error)")
            #endif
            telemetryEvents.append(makeTelemetryEvent(
                eventType: "credentials_refresh_error",
                taskType: taskType,
                metricType: specificMetricType,
                success: false,
                errorMessage: error.localizedDescription
            ))
        }
        
        // Determine which metrics to sync
        let metricPlans: [MetricSyncPlan]
        if let specific = specificMetricType {
            metricPlans = syncPlans(
                metricTypes: [specific],
                syncModes: cachedMetricSyncModes.merging([specific: MetricSyncMode.dailyOnly.rawValue]) { current, _ in current },
                projectionFlags: cachedMetricProjectionFlags
            )
        } else {
            // Refresh tracked metrics from server
            do {
                let response = try await apiClient.fetchTrackedMetrics()
                let syncModes = syncModesByMetricType(from: response)
                if cachedMetricSyncModes != syncModes {
                    cachedMetricSyncModes = syncModes
                }
                let projectionFlags = projectionFlagsByMetricType(from: response)
                if cachedMetricProjectionFlags != projectionFlags {
                    cachedMetricProjectionFlags = projectionFlags
                }

                let plans = syncPlans(from: response)
                let enabledMetricTypes = plans.map(\.metricType)
                telemetryEvents.append(makeTelemetryEvent(
                    eventType: "tracked_metrics_received",
                    taskType: taskType,
                    success: true,
                    recordCount: enabledMetricTypes.count,
                    metadata: [
                        "metric_types": AnyCodable(enabledMetricTypes),
                        "projecting_metric_types": AnyCodable(plans.filter { $0.projectsToHabitLogs }.map(\.metricType))
                    ]
                ))

                if cachedMetricTypes != enabledMetricTypes {
                    cachedMetricTypes = enabledMetricTypes
                    await enableBackgroundDelivery(forMetricTypes: enabledMetricTypes)
                }
                metricPlans = plans
            } catch {
                #if DEBUG
                print("⚠️ Failed to fetch tracked metrics, using cached: \(error)")
                #endif
                telemetryEvents.append(makeTelemetryEvent(
                    eventType: "tracked_metrics_fetch_failed",
                    taskType: taskType,
                    success: false,
                    errorMessage: error.localizedDescription
                ))
                metricPlans = syncPlans(
                    metricTypes: cachedMetricTypes,
                    syncModes: cachedMetricSyncModes,
                    projectionFlags: cachedMetricProjectionFlags
                )
            }
        }

        historyMetricTypes = metricPlans.map(\.metricType)
        
        guard !metricPlans.isEmpty else {
            #if DEBUG
            print("📊 No metrics to sync")
            #endif
            telemetryEvents.append(makeTelemetryEvent(
                eventType: "no_metrics_configured",
                taskType: taskType,
                success: true,
                recordCount: 0
            ))
            postSyncActionRequired(.noMetricsConfigured, message: "No tracked metrics configured. Choose metrics in Ritual desktop.")
            recordHistory(succeeded: true, errorMessage: nil)
            await submitTelemetry(telemetryEvents)
            return
        }
        
        #if DEBUG
        print("🔄 Starting wearable sync for \(metricPlans.count) metric types...")
        #endif
        
        // First, flush any pending offline queue items
        await flushOfflineQueue()
        
        // Fetch DAILY AGGREGATED data with a dynamic incremental window.
        // This keeps payloads bounded while widening the window after longer gaps.
        var allMetrics: [NormalizedMetric] = []
        var deletedExternalIds = Set<String>()
        let daysBack = resolvedIncrementalDaysBack()
        historyWindowDays = daysBack
        
        for plan in metricPlans {
            let queryStart = Date()
            var perMetricRecordCount = 0
            do {
                let metrics = try await healthKitManager.fetchMetrics(
                    for: plan.metricType,
                    syncMode: plan.syncMode,
                    daysBack: daysBack
                )
                let adjustedMetrics = metrics.map {
                    $0.withShouldProjectToHabitLogs(plan.syncMode == .dailyOnly ? plan.projectsToHabitLogs : false)
                }
                allMetrics.append(contentsOf: adjustedMetrics)
                perMetricRecordCount += adjustedMetrics.count

                if plan.syncMode == .dailyOnly {
                    deletedExternalIds.formUnion(
                        missingDailyExternalIds(
                            metricType: plan.metricType,
                            daysBack: daysBack,
                            existingDailyMetrics: adjustedMetrics
                        )
                    )
                } else if plan.projectsToHabitLogs {
                    let dailyMetrics = try await healthKitManager.fetchMetrics(
                        for: plan.metricType,
                        syncMode: .dailyOnly,
                        daysBack: daysBack
                    )
                    let projectedDailyMetrics = dailyMetrics.map {
                        $0.withShouldProjectToHabitLogs(true)
                    }
                    allMetrics.append(contentsOf: projectedDailyMetrics)
                    perMetricRecordCount += projectedDailyMetrics.count
                    deletedExternalIds.formUnion(
                        missingDailyExternalIds(
                            metricType: plan.metricType,
                            daysBack: daysBack,
                            existingDailyMetrics: projectedDailyMetrics
                        )
                    )
                }

                telemetryEvents.append(makeTelemetryEvent(
                    eventType: "healthkit_metric_query",
                    taskType: taskType,
                    metricType: plan.metricType,
                    success: true,
                    recordCount: perMetricRecordCount,
                    durationMs: durationMs(since: queryStart),
                    windowDays: daysBack,
                    metadata: [
                        "sync_mode": AnyCodable(plan.syncMode.rawValue),
                        "projects_to_habit_logs": AnyCodable(plan.projectsToHabitLogs),
                        "safe_history_days": AnyCodable(plan.safeHistoryDays as Any),
                        "zero_reconciliation_count": AnyCodable(deletedExternalIds.count)
                    ]
                ))
            } catch {
                #if DEBUG
                print("⚠️ Failed to fetch \(plan.syncMode.rawValue) metrics for \(plan.metricType): \(error.localizedDescription)")
                #endif
                historyFailedMetricTypes.insert(plan.metricType)
                telemetryEvents.append(makeTelemetryEvent(
                    eventType: "healthkit_metric_query",
                    taskType: taskType,
                    metricType: plan.metricType,
                    success: false,
                    recordCount: perMetricRecordCount,
                    durationMs: durationMs(since: queryStart),
                    windowDays: daysBack,
                    errorMessage: error.localizedDescription,
                    metadata: [
                        "sync_mode": AnyCodable(plan.syncMode.rawValue),
                        "projects_to_habit_logs": AnyCodable(plan.projectsToHabitLogs),
                        "safe_history_days": AnyCodable(plan.safeHistoryDays as Any)
                    ]
                ))
            }
        }

        var pendingAnchors: [String: HKQueryAnchor] = [:]
        for plan in metricPlans {
            let anchorStart = Date()
            do {
                let result = try await healthKitManager.fetchIncrementalDeletions(for: plan.metricType)
                deletedExternalIds.formUnion(result.deleted)
                if let newAnchor = result.newAnchor {
                    pendingAnchors[plan.metricType] = newAnchor
                }
                telemetryEvents.append(makeTelemetryEvent(
                    eventType: "healthkit_anchor_deletions",
                    taskType: taskType,
                    metricType: plan.metricType,
                    success: true,
                    recordCount: result.deleted.count,
                    durationMs: durationMs(since: anchorStart),
                    windowDays: daysBack
                ))
            } catch {
                #if DEBUG
                print("⚠️ Failed to fetch anchored deletions for \(plan.metricType): \(error.localizedDescription)")
                #endif
                telemetryEvents.append(makeTelemetryEvent(
                    eventType: "healthkit_anchor_deletions",
                    taskType: taskType,
                    metricType: plan.metricType,
                    success: false,
                    durationMs: durationMs(since: anchorStart),
                    windowDays: daysBack,
                    errorMessage: error.localizedDescription
                ))
            }
        }
        
        // Skip if no data
        guard !allMetrics.isEmpty || !deletedExternalIds.isEmpty else {
            #if DEBUG
            print("📊 No data to sync")
            #endif
            lastSyncTime = Date()
            lastError = nil
            if historyFailedMetricTypes.isEmpty && !pendingAnchors.isEmpty {
                healthKitManager.confirmAnchorsFromServer(
                    confirmedAnchorTokens: healthKitManager.makeAnchorTokens(pendingAnchors),
                    pendingAnchors: pendingAnchors
                )
            }
            let historyError = historyFailedMetricTypes.isEmpty ? nil : "Failed to fetch one or more metric types"
            telemetryEvents.append(makeTelemetryEvent(
                eventType: "no_data_to_sync",
                taskType: taskType,
                success: historyFailedMetricTypes.isEmpty,
                recordCount: 0,
                windowDays: daysBack,
                errorMessage: historyError
            ))
            recordHistory(succeeded: historyFailedMetricTypes.isEmpty, errorMessage: historyError)
            await submitTelemetry(telemetryEvents)
            return
        }
        
        #if DEBUG
        print("📊 Syncing \(allMetrics.count) values and \(deletedExternalIds.count) tombstones (\(daysBack)-day window)")
        #endif
        
        // Batch size limit (backend accepts max 500, use 400 for safety)
        let batchSize = 400
        let pendingAnchorTokens = healthKitManager.makeAnchorTokens(pendingAnchors)
        
        // Try to send to backend in batches
        var totalAddedSuccess = 0
        var totalDeletedSuccess = 0
        var allBatchesSucceeded = true
        var confirmedAnchorTokens: [String: String]? = nil
        
        let ingestBatches = makeIngestBatches(
            added: allMetrics,
            deleted: Array(deletedExternalIds).sorted(),
            batchSize: batchSize
        )
        
        #if DEBUG
        print("📦 Sending \(ingestBatches.count) batch(es)...")
        #endif
        
        var failedBatches = 0
        let startTime = Date()
        
        for (i, batch) in ingestBatches.enumerated() {
            if batch.added.isEmpty && batch.deleted.isEmpty { continue }
            
            // Log progress
            let elapsed = Date().timeIntervalSince(startTime)
            #if DEBUG
            print("📤 Batch \(i + 1)/\(ingestBatches.count): \(batch.added.count) values, \(batch.deleted.count) tombstones (elapsed: \(Int(elapsed))s)")
            #endif
            
            let uploadStart = Date()
            let batchMetricTypes = metricTypeSet(from: batch.added)
                .union(metricTypes(fromDailyExternalIds: batch.deleted))
            let batchDayKeys = dayKeys(from: batch.added)
                .union(dayKeys(fromDailyExternalIds: batch.deleted))

            do {
                let response = try await apiClient.ingestMetricsV2(
                    added: batch.added,
                    deleted: batch.deleted,
                    modified: [],
                    anchors: (i == ingestBatches.count - 1 && !pendingAnchorTokens.isEmpty) ? pendingAnchorTokens : nil
                )
                
                if response.success {
                    let addedSuccess = (response.addedResults.isEmpty && !batch.added.isEmpty)
                        ? batch.added.count
                        : response.addedResults.filter { $0.success }.count
                    let deletedSuccess = (response.deletedResults.isEmpty && !batch.deleted.isEmpty)
                        ? batch.deleted.count
                        : response.deletedResults.filter { $0.success }.count
                    let batchFullySucceeded = !response.addedResults.contains(where: { !$0.success })
                        && !response.deletedResults.contains(where: { !$0.success })

                    totalAddedSuccess += addedSuccess
                    totalDeletedSuccess += deletedSuccess
                    if response.confirmedAnchors != nil {
                        confirmedAnchorTokens = response.confirmedAnchors
                    }
                    if !batchFullySucceeded {
                        allBatchesSucceeded = false
                        historyFailedBatches += 1
                        historyFailedMetricTypes.formUnion(batchMetricTypes)
                        historyFailedDays.formUnion(batchDayKeys)
                    }
                    telemetryEvents.append(makeTelemetryEvent(
                        eventType: "upload_batch",
                        taskType: taskType,
                        success: batchFullySucceeded,
                        recordCount: batch.added.count + batch.deleted.count,
                        durationMs: durationMs(since: uploadStart),
                        windowDays: daysBack,
                        metadata: [
                            "batch_index": AnyCodable(i + 1),
                            "batch_count": AnyCodable(ingestBatches.count),
                            "added_count": AnyCodable(batch.added.count),
                            "deleted_count": AnyCodable(batch.deleted.count),
                            "added_success_count": AnyCodable(addedSuccess),
                            "deleted_success_count": AnyCodable(deletedSuccess)
                        ]
                    ))
                } else {
                    allBatchesSucceeded = false
                    failedBatches += 1
                    historyFailedBatches += 1
                    historyFailedMetricTypes.formUnion(batchMetricTypes)
                    historyFailedDays.formUnion(batchDayKeys)
                    telemetryEvents.append(makeTelemetryEvent(
                        eventType: "upload_batch",
                        taskType: taskType,
                        success: false,
                        recordCount: batch.added.count + batch.deleted.count,
                        durationMs: durationMs(since: uploadStart),
                        windowDays: daysBack,
                        errorMessage: "Server rejected batch",
                        metadata: [
                            "batch_index": AnyCodable(i + 1),
                            "batch_count": AnyCodable(ingestBatches.count),
                            "added_count": AnyCodable(batch.added.count),
                            "deleted_count": AnyCodable(batch.deleted.count)
                        ]
                    ))
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
                historyFailedMetricTypes.formUnion(batchMetricTypes)
                historyFailedDays.formUnion(batchDayKeys)
                
                let queuedPayload = IngestEnvelopeV1(
                    added: batch.added,
                    deleted: batch.deleted,
                    modified: []
                )
                _ = offlineQueue.enqueue(envelope: queuedPayload)
                telemetryEvents.append(makeTelemetryEvent(
                    eventType: "upload_batch",
                    taskType: taskType,
                    success: false,
                    recordCount: batch.added.count + batch.deleted.count,
                    durationMs: durationMs(since: uploadStart),
                    windowDays: daysBack,
                    errorMessage: error.localizedDescription,
                    metadata: [
                        "batch_index": AnyCodable(i + 1),
                        "batch_count": AnyCodable(ingestBatches.count),
                        "added_count": AnyCodable(batch.added.count),
                        "deleted_count": AnyCodable(batch.deleted.count),
                        "queued": AnyCodable(true)
                    ]
                ))
                
                failedBatches += 1
            } catch {
                allBatchesSucceeded = false
                failedBatches += 1
                historyFailedBatches += 1
                historyFailedMetricTypes.formUnion(batchMetricTypes)
                historyFailedDays.formUnion(batchDayKeys)
                telemetryEvents.append(makeTelemetryEvent(
                    eventType: "upload_batch",
                    taskType: taskType,
                    success: false,
                    recordCount: batch.added.count + batch.deleted.count,
                    durationMs: durationMs(since: uploadStart),
                    windowDays: daysBack,
                    errorMessage: error.localizedDescription,
                    metadata: [
                        "batch_index": AnyCodable(i + 1),
                        "batch_count": AnyCodable(ingestBatches.count),
                        "added_count": AnyCodable(batch.added.count),
                        "deleted_count": AnyCodable(batch.deleted.count)
                    ]
                ))
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
            if i < ingestBatches.count - 1 {
                try? await Task.sleep(nanoseconds: 50_000_000) // 50ms
            }
        }
        
        let totalElapsed = Date().timeIntervalSince(startTime)
        let totalSuccess = totalAddedSuccess + totalDeletedSuccess
        #if DEBUG
        print("📊 Sync completed in \(Int(totalElapsed))s: \(totalAddedSuccess) values synced, \(totalDeletedSuccess) tombstones synced, \(failedBatches) failed batches")
        #endif
        historyAddedCount = totalAddedSuccess
        
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
            print("✅ Sync complete: \(totalAddedSuccess) values, \(totalDeletedSuccess) tombstones (total syncs: \(syncCount))")
            #endif
            
            let addedCount = totalAddedSuccess
            let deletedCount = totalDeletedSuccess
            let completionTime = Date()
            await MainActor.run {
                NotificationCenter.default.post(
                    name: NSNotification.Name("BackgroundSyncCompleted"),
                    object: nil,
                    userInfo: [
                        "addedCount": addedCount,
                        "deletedCount": deletedCount,
                        "time": completionTime
                    ]
                )
            }
            telemetryEvents.append(makeTelemetryEvent(
                eventType: "sync_end",
                taskType: taskType,
                success: allBatchesSucceeded,
                recordCount: totalSuccess,
                durationMs: durationMs(since: syncStartTime),
                windowDays: daysBack,
                errorMessage: allBatchesSucceeded ? nil : "Partial sync completed with failed batches",
                metadata: [
                    "added_success_count": AnyCodable(totalAddedSuccess),
                    "deleted_success_count": AnyCodable(totalDeletedSuccess),
                    "failed_batch_count": AnyCodable(failedBatches),
                    "queued_batch_count": AnyCodable(historyQueuedBatches)
                ]
            ))
            await submitTelemetry(telemetryEvents)
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
            telemetryEvents.append(makeTelemetryEvent(
                eventType: "sync_end",
                taskType: taskType,
                success: false,
                recordCount: 0,
                durationMs: durationMs(since: syncStartTime),
                windowDays: daysBack,
                errorMessage: "Sync failed",
                metadata: [
                    "failed_batch_count": AnyCodable(failedBatches),
                    "queued_batch_count": AnyCodable(historyQueuedBatches)
                ]
            ))
            await submitTelemetry(telemetryEvents)
            recordHistory(succeeded: false, errorMessage: "Sync failed")
            if historyQueuedBatches > 0 {
                postSyncActionRequired(.networkQueued, message: "Sync queued due to network issues. Retry will happen automatically.")
            } else {
                postSyncActionRequired(.partialFailure, message: "Sync failed. Open Ritual to review and retry.")
            }
        } else {
            telemetryEvents.append(makeTelemetryEvent(
                eventType: "sync_end",
                taskType: taskType,
                success: true,
                recordCount: 0,
                durationMs: durationMs(since: syncStartTime),
                windowDays: daysBack
            ))
            await submitTelemetry(telemetryEvents)
            recordHistory(succeeded: true, errorMessage: nil)
        }
    }

    /// Retry sync for specific failed day keys (YYYY-MM-DD).
    @discardableResult
    func retryFailedDays(_ failedDayKeys: [String]) async -> Int {
        let normalizedDayKeys = Set(
            failedDayKeys
                .map { String($0.prefix(10)) }
                .filter { $0.count == 10 }
        )
        return await runRetry(scope: .dayKeys(normalizedDayKeys)).syncedMetricCount
    }

    @discardableResult
    func retryDateRange(startDate: Date, endDate: Date) async -> RetryDateRangeResult {
        let run = await runRetry(
            scope: .normalizedDateRange(startDate: startDate, endDate: endDate)
        )
        let result = RetryDateRangeResult(
            attemptedDays: run.attemptedDayKeys.count,
            syncedMetricCount: run.syncedMetricCount,
            failedDays: run.failedDays,
            queuedBatchCount: run.queuedBatchCount,
            errorMessage: run.errorMessage
        )

        await MainActor.run {
            NotificationCenter.default.post(
                name: .syncRetryCompleted,
                object: nil,
                userInfo: [
                    "attemptedDays": result.attemptedDays,
                    "syncedMetricCount": result.syncedMetricCount,
                    "failedDays": result.failedDays,
                    "queuedBatchCount": result.queuedBatchCount,
                ]
            )
        }

        if !result.failedDays.isEmpty {
            Task { @MainActor in
                NotificationManager.shared.sendRetryCompleted(
                    remainingFailedDays: result.failedDays.count,
                    syncedMetricCount: result.syncedMetricCount
                )
            }
        }
        return result
    }

    private struct RetryRunResult {
        let attemptedDayKeys: [String]
        let syncedMetricCount: Int
        let failedDays: [String]
        let queuedBatchCount: Int
        let errorMessage: String?
    }

    private func runRetry(scope: RetryScope) async -> RetryRunResult {
        let attemptedDayKeys: [String]
        switch scope {
        case let .dayKeys(keys):
            attemptedDayKeys = keys.sorted()
        case let .dateRange(range):
            attemptedDayKeys = dayKeys(from: range.lowerBound, to: range.upperBound)
        }
        let attemptedSet = Set(attemptedDayKeys)

        func result(
            synced: Int = 0,
            failedDays: Set<String> = [],
            queued: Int = 0,
            error: String? = nil
        ) -> RetryRunResult {
            RetryRunResult(
                attemptedDayKeys: attemptedDayKeys,
                syncedMetricCount: synced,
                failedDays: Array(failedDays).sorted(),
                queuedBatchCount: queued,
                errorMessage: error
            )
        }

        guard !attemptedDayKeys.isEmpty else {
            return result(error: "No valid dates selected.")
        }
        guard beginSyncingIfIdle() else {
            return result(failedDays: attemptedSet, error: "Sync already in progress.")
        }
        defer { endSyncing() }

        let syncStartTime = Date()
        var historyMetricTypes: [String] = []
        var failedMetricTypes = Set<String>()
        var failedDays = Set<String>()
        var failedBatchCount = 0
        var queuedBatchCount = 0
        var syncedMetricCount = 0

        func recordHistory(succeeded: Bool, errorMessage: String?) {
            appendSyncHistory(
                SyncHistoryEntry(
                    id: UUID().uuidString,
                    startedAt: syncStartTime,
                    finishedAt: Date(),
                    isBackground: false,
                    isRetry: true,
                    windowDays: attemptedDayKeys.count,
                    succeeded: succeeded,
                    addedCount: syncedMetricCount,
                    failedBatchCount: failedBatchCount,
                    queuedBatchCount: queuedBatchCount,
                    metricTypes: historyMetricTypes,
                    failedMetricTypes: Array(failedMetricTypes).sorted(),
                    failedDays: Array(failedDays).sorted(),
                    errorMessage: errorMessage
                )
            )
        }

        lastSyncAttemptTime = Date()
        guard await apiClient.hasStoredCredentials else {
            let message = "No stored credentials"
            recordHistory(succeeded: false, errorMessage: message)
            return result(failedDays: attemptedSet, error: message)
        }

        do {
            try await apiClient.ensureValidToken()
        } catch let error as APIError where error.requiresReauth {
            lastError = error.localizedDescription
            lastErrorTime = Date()
            postSyncActionRequired(
                .authExpired,
                message: "Authentication expired. Open Ritual and sign in again."
            )
            await MainActor.run {
                NotificationCenter.default.post(
                    name: NSNotification.Name("RequiresReauthentication"),
                    object: nil
                )
            }
            await scheduleReauthLocalNotification()
            recordHistory(succeeded: false, errorMessage: error.localizedDescription)
            return result(failedDays: attemptedSet, error: error.localizedDescription)
        } catch {
            #if DEBUG
            print("⚠️ Token refresh error during retry: \(error)")
            #endif
        }

        let metricPlans: [MetricSyncPlan]
        do {
            let response = try await apiClient.fetchTrackedMetrics()
            cachedMetricSyncModes = syncModesByMetricType(from: response)
            cachedMetricProjectionFlags = projectionFlagsByMetricType(from: response)
            metricPlans = syncPlans(from: response)
        } catch {
            #if DEBUG
            print("⚠️ Failed to fetch tracked metrics for retry, using cached: \(error)")
            #endif
            metricPlans = syncPlans(
                metricTypes: cachedMetricTypes,
                syncModes: cachedMetricSyncModes,
                projectionFlags: cachedMetricProjectionFlags
            )
        }

        historyMetricTypes = metricPlans.map(\.metricType)
        guard !metricPlans.isEmpty else {
            let message = "No metric types configured"
            recordHistory(succeeded: false, errorMessage: message)
            postSyncActionRequired(
                .noMetricsConfigured,
                message: "No tracked metrics configured. Choose metrics in Ritual desktop."
            )
            return result(failedDays: attemptedSet, error: message)
        }

        var retryMetrics: [NormalizedMetric] = []
        for plan in metricPlans {
            do {
                let metrics: [NormalizedMetric]
                switch scope {
                case .dayKeys:
                    metrics = try await healthKitManager.fetchMetrics(
                        for: plan.metricType,
                        syncMode: plan.syncMode,
                        daysBack: maxIncrementalDaysBack
                    )
                case let .dateRange(range):
                    metrics = try await healthKitManager.fetchMetrics(
                        for: plan.metricType,
                        syncMode: plan.syncMode,
                        startDate: range.lowerBound,
                        endDate: range.upperBound
                    )
                }
                retryMetrics.append(contentsOf: metrics.filter { metric in
                    dayKey(for: metric).map(attemptedSet.contains) ?? false
                }.map {
                    $0.withShouldProjectToHabitLogs(
                        plan.syncMode == .dailyOnly ? plan.projectsToHabitLogs : false
                    )
                })

                if plan.syncMode == .granular && plan.projectsToHabitLogs {
                    let dailyMetrics: [NormalizedMetric]
                    switch scope {
                    case .dayKeys:
                        dailyMetrics = try await healthKitManager.fetchMetrics(
                            for: plan.metricType,
                            syncMode: .dailyOnly,
                            daysBack: maxIncrementalDaysBack
                        )
                    case let .dateRange(range):
                        dailyMetrics = try await healthKitManager.fetchMetrics(
                            for: plan.metricType,
                            syncMode: .dailyOnly,
                            startDate: range.lowerBound,
                            endDate: range.upperBound
                        )
                    }
                    retryMetrics.append(contentsOf: dailyMetrics.filter { metric in
                        dayKey(for: metric).map(attemptedSet.contains) ?? false
                    }.map {
                        $0.withShouldProjectToHabitLogs(true)
                    })
                }
            } catch {
                failedMetricTypes.insert(plan.metricType)
                failedDays.formUnion(attemptedSet)
                #if DEBUG
                print("⚠️ Failed to fetch retry metrics for \(plan.metricType): \(error.localizedDescription)")
                #endif
            }
        }

        guard !retryMetrics.isEmpty else {
            let message = failedMetricTypes.isEmpty
                ? "No retry data found for selected dates."
                : "Failed to load retry metrics."
            recordHistory(succeeded: false, errorMessage: message)
            postSyncActionRequired(.partialFailure, message: message)
            return result(failedDays: failedDays.isEmpty ? attemptedSet : failedDays, error: message)
        }

        let batches = stride(from: 0, to: retryMetrics.count, by: 400).map {
            Array(retryMetrics[$0 ..< min($0 + 400, retryMetrics.count)])
        }

        for (index, batch) in batches.enumerated() where !batch.isEmpty {
            let batchMetricTypes = metricTypeSet(from: batch)
            let batchDayKeys = dayKeys(from: batch)
            do {
                let response = try await apiClient.ingestMetricsV2(
                    added: batch,
                    deleted: [],
                    modified: []
                )
                let successfulCount = response.success
                    ? (response.addedResults.isEmpty
                        ? batch.count
                        : response.addedResults.filter(\.success).count)
                    : 0
                syncedMetricCount += successfulCount
                if successfulCount != batch.count {
                    failedBatchCount += 1
                    failedMetricTypes.formUnion(batchMetricTypes)
                    failedDays.formUnion(batchDayKeys)
                }
            } catch let error as APIError where error.shouldQueue {
                failedBatchCount += 1
                queuedBatchCount += 1
                failedMetricTypes.formUnion(batchMetricTypes)
                failedDays.formUnion(batchDayKeys)
                _ = offlineQueue.enqueue(envelope: IngestEnvelopeV1(added: batch))
            } catch {
                failedBatchCount += 1
                failedMetricTypes.formUnion(batchMetricTypes)
                failedDays.formUnion(batchDayKeys)
                #if DEBUG
                print("⚠️ Retry batch \(index + 1) failed: \(error.localizedDescription)")
                #endif
            }

            if index < batches.count - 1 {
                try? await Task.sleep(nanoseconds: 50_000_000)
            }
        }

        let succeeded = failedBatchCount == 0 && failedMetricTypes.isEmpty
        let errorMessage = succeeded ? nil : (syncedMetricCount > 0 ? "Retry partially succeeded" : "Retry failed")
        if syncedMetricCount > 0 {
            lastSyncTime = Date()
            lastError = nil
            syncCount += 1
            let completionTime = Date()
            await MainActor.run {
                NotificationCenter.default.post(
                    name: NSNotification.Name("BackgroundSyncCompleted"),
                    object: nil,
                    userInfo: [
                        "addedCount": syncedMetricCount,
                        "deletedCount": 0,
                        "time": completionTime,
                        "isRetry": true,
                    ]
                )
            }
        } else {
            lastError = errorMessage
            lastErrorTime = Date()
        }

        recordHistory(succeeded: succeeded, errorMessage: errorMessage)
        if !failedDays.isEmpty {
            postSyncActionRequired(
                .partialFailure,
                message: "Retry completed with remaining failed days."
            )
        }
        if queuedBatchCount > 0 {
            postSyncActionRequired(
                .networkQueued,
                message: "Retry batches were queued due to network issues."
            )
        }

        return result(
            synced: syncedMetricCount,
            failedDays: failedDays,
            queued: queuedBatchCount,
            error: errorMessage
        )
    }

    /// Flush the offline queue
    private func flushOfflineQueue() async {
        let payloads = await offlineQueue.processQueue()
        
        for payload in payloads {
            do {
                let decoder = JSONDecoder()
                let queuedPayload: IngestEnvelopeV1
                if let decoded = try? decoder.decode(IngestEnvelopeV1.self, from: payload.payload) {
                    queuedPayload = decoded
                } else {
                    let legacyMetrics = try decoder.decode([NormalizedMetric].self, from: payload.payload)
                    queuedPayload = IngestEnvelopeV1(added: legacyMetrics)
                }
                
                let response = try await apiClient.ingestMetricsV2(
                    added: queuedPayload.added,
                    deleted: queuedPayload.deleted,
                    modified: queuedPayload.modified
                )
                
                if response.success {
                    offlineQueue.markSuccess(id: payload.id)
                    await submitTelemetryEvent(
                        eventType: "offline_queue_flush",
                        taskType: "retry",
                        success: true,
                        recordCount: queuedPayload.added.count + queuedPayload.deleted.count + queuedPayload.modified.count
                    )
                    #if DEBUG
                    print("✅ Flushed queued payload \(payload.id)")
                    #endif
                } else {
                    offlineQueue.markFailed(id: payload.id, error: "Server rejected")
                    await submitTelemetryEvent(
                        eventType: "offline_queue_flush",
                        taskType: "retry",
                        success: false,
                        recordCount: queuedPayload.added.count + queuedPayload.deleted.count + queuedPayload.modified.count,
                        errorMessage: "Server rejected"
                    )
                }
                
            } catch {
                offlineQueue.markFailed(id: payload.id, error: error.localizedDescription)
                await submitTelemetryEvent(
                    eventType: "offline_queue_flush",
                    taskType: "retry",
                    success: false,
                    recordCount: payload.metricCount,
                    errorMessage: error.localizedDescription
                )
                #if DEBUG
                print("❌ Failed to flush payload \(payload.id): \(error)")
                #endif
            }
        }
    }
    
    /// Perform a policy-aware backfill.
    /// Daily-only metrics keep long-range daily totals, while granular metrics use
    /// narrower high-resolution windows to avoid exploding payload size.
    func performFullBackfill(daysBack: Int = 730, progressHandler: ((Int, Int) -> Void)? = nil) async throws -> Int {
        guard await apiClient.hasStoredCredentials else {
            throw APIError.notRegistered
        }

        let metricSyncModes = Dictionary(
            uniqueKeysWithValues: cachedMetricTypes.map { metricType in
                (metricType, syncMode(for: metricType, syncModes: cachedMetricSyncModes))
            }
        )
        
        #if DEBUG
        print("📊 Starting policy-aware backfill for \(metricSyncModes.count) metrics...")
        #endif
        
        let metrics = try await healthKitManager.performBackfill(
            for: metricSyncModes,
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
        print("📦 Backfill: \(metrics.count) metrics in \(batches.count) batch(es)")
        #endif
        
        var totalSuccess = 0
        let startTime = Date()
        
        for (index, batch) in batches.enumerated() {
            #if DEBUG
            print("📤 Backfill batch \(index + 1)/\(batches.count): \(batch.count) metrics")
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
            print("⚠️ Rejected unknown metric types from server: \(rejected)")
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

    private func makeIngestBatches(
        added: [NormalizedMetric],
        deleted: [String],
        batchSize: Int
    ) -> [IngestBatch] {
        let addedBatches = added.isEmpty
            ? [[NormalizedMetric]]()
            : stride(from: 0, to: added.count, by: batchSize).map {
                Array(added[$0..<min($0 + batchSize, added.count)])
            }
        let deletedBatches = deleted.isEmpty
            ? [[String]]()
            : stride(from: 0, to: deleted.count, by: batchSize).map {
                Array(deleted[$0..<min($0 + batchSize, deleted.count)])
            }

        let batchCount = max(addedBatches.count, deletedBatches.count)
        guard batchCount > 0 else { return [] }

        return (0..<batchCount).map { index in
            IngestBatch(
                added: index < addedBatches.count ? addedBatches[index] : [],
                deleted: index < deletedBatches.count ? deletedBatches[index] : []
            )
        }
    }

    private func missingDailyExternalIds(
        metricType: String,
        daysBack: Int,
        existingDailyMetrics: [NormalizedMetric]
    ) -> Set<String> {
        let existingIds = Set(
            existingDailyMetrics
                .filter { $0.aggregationKind == .daily }
                .compactMap(\.externalId)
        )
        return expectedDailyExternalIds(metricType: metricType, daysBack: daysBack)
            .subtracting(existingIds)
    }

    private func expectedDailyExternalIds(metricType: String, daysBack: Int) -> Set<String> {
        let calendar = Calendar.current
        let startOfToday = calendar.startOfDay(for: Date())
        let start = calendar.date(byAdding: .day, value: -daysBack, to: startOfToday) ?? startOfToday
        var current = start
        var ids = Set<String>()

        while current <= startOfToday {
            ids.insert(dailyExternalId(metricType: metricType, dayStart: current))
            guard let next = calendar.date(byAdding: .day, value: 1, to: current) else { break }
            current = next
        }

        return ids
    }

    private func dailyExternalId(metricType: String, dayStart: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]
        return "daily_\(metricType)_\(formatter.string(from: dayStart))"
    }

    private func dayKeys(fromDailyExternalIds externalIds: [String]) -> Set<String> {
        Set(externalIds.compactMap { externalId in
            let parts = externalId.split(separator: "_")
            guard parts.count >= 3 else { return nil }
            let day = String(parts.last ?? "")
            return day.count == 10 ? day : nil
        })
    }

    private func metricTypes(fromDailyExternalIds externalIds: [String]) -> Set<String> {
        Set(externalIds.compactMap { externalId in
            guard externalId.hasPrefix("daily_") else { return nil }
            let remainder = externalId.dropFirst("daily_".count)
            guard let separator = remainder.lastIndex(of: "_") else { return nil }
            return String(remainder[..<separator])
        })
    }

    private func durationMs(since start: Date) -> Int {
        max(0, Int(Date().timeIntervalSince(start) * 1000))
    }

    private func makeTelemetryEvent(
        eventType: String,
        taskType: String? = nil,
        metricType: String? = nil,
        success: Bool? = nil,
        recordCount: Int? = nil,
        durationMs: Int? = nil,
        windowDays: Int? = nil,
        errorMessage: String? = nil,
        metadata: [String: AnyCodable]? = nil
    ) -> AppleSyncTelemetryEvent {
        let queue = offlineQueue.telemetry
        return AppleSyncTelemetryEvent(
            eventType: eventType,
            taskType: taskType,
            metricType: metricType,
            success: success,
            recordCount: recordCount,
            durationMs: durationMs,
            windowDays: windowDays,
            errorMessage: errorMessage,
            queuePendingCount: queue.pendingCount,
            queueReadyCount: queue.readyForRetryCount,
            queuedMetricCount: queue.totalPendingMetrics,
            metadata: metadata
        )
    }

    private func submitTelemetry(_ events: [AppleSyncTelemetryEvent]) async {
        await apiClient.submitAppleSyncTelemetry(events)
    }

    func submitTelemetryEvent(
        eventType: String,
        taskType: String? = nil,
        metricType: String? = nil,
        success: Bool? = nil,
        recordCount: Int? = nil,
        durationMs: Int? = nil,
        windowDays: Int? = nil,
        errorMessage: String? = nil,
        metadata: [String: AnyCodable]? = nil
    ) async {
        await submitTelemetry([
            makeTelemetryEvent(
                eventType: eventType,
                taskType: taskType,
                metricType: metricType,
                success: success,
                recordCount: recordCount,
                durationMs: durationMs,
                windowDays: windowDays,
                errorMessage: errorMessage,
                metadata: metadata
            )
        ])
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
        info += "- Cached sync modes: \(cachedMetricSyncModes)\n"
        info += "- Cached projection flags: \(cachedMetricProjectionFlags)\n"
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
