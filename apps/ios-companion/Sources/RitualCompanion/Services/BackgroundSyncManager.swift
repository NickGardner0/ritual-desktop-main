import Foundation
import HealthKit
import BackgroundTasks
import UIKit

/// Manages automatic background sync of Apple Health data
/// Only syncs metrics that the user has selected to track in the desktop app
final class BackgroundSyncManager {
    
    // MARK: - Singleton
    
    static let shared = BackgroundSyncManager()
    
    // MARK: - Constants
    
    /// Background task identifier - must match Info.plist BGTaskSchedulerPermittedIdentifiers
    static let backgroundTaskIdentifier = "com.ritual.companion.healthsync"
    
    /// Minimum interval between background syncs (15 minutes)
    private let minimumSyncInterval: TimeInterval = 15 * 60
    
    /// Minimum interval between foreground syncs (5 minutes) - can be more frequent
    private let minimumForegroundSyncInterval: TimeInterval = 5 * 60
    
    /// UserDefaults keys for persistence
    private enum StorageKeys {
        static let lastSyncTime = "BackgroundSync.lastSyncTime"
        static let lastBackgroundDeliverySetup = "BackgroundSync.lastBackgroundDeliverySetup"
        static let trackedMetricTypes = "BackgroundSync.trackedMetricTypes"
        static let syncCount = "BackgroundSync.syncCount"
    }
    
    // MARK: - Properties
    
    private let healthStore = HKHealthStore()
    private let apiClient = RitualAPIClient()
    private var observerQueries: [HKObserverQuery] = []
    private var isSetup = false
    private var isSyncing = false
    
    /// Last sync time - persisted to UserDefaults
    var lastSyncTime: Date? {
        get {
            UserDefaults.standard.object(forKey: StorageKeys.lastSyncTime) as? Date
        }
        set {
            UserDefaults.standard.set(newValue, forKey: StorageKeys.lastSyncTime)
        }
    }
    
    /// Total sync count for debugging
    private var syncCount: Int {
        get { UserDefaults.standard.integer(forKey: StorageKeys.syncCount) }
        set { UserDefaults.standard.set(newValue, forKey: StorageKeys.syncCount) }
    }
    
    /// Cached tracked metric types
    private var cachedMetricTypes: [String] {
        get {
            UserDefaults.standard.stringArray(forKey: StorageKeys.trackedMetricTypes) ?? []
        }
        set {
            UserDefaults.standard.set(newValue, forKey: StorageKeys.trackedMetricTypes)
        }
    }
    
    // MARK: - Initialization
    
    private init() {}
    
    // MARK: - Setup
    
    /// Call this from AppDelegate/App on launch to set up background sync
    func setupBackgroundSync() {
        guard !isSetup else { return }
        isSetup = true
        
        // Register background task
        registerBackgroundTask()
        
        // Re-enable background delivery for cached metric types if we have credentials
        if apiClient.hasStoredCredentials && !cachedMetricTypes.isEmpty {
            Task {
                await enableBackgroundDelivery(forMetricTypes: cachedMetricTypes)
            }
        }
        
        print("📱 Background sync manager initialized (total syncs: \(syncCount))")
    }
    
    /// Register the background task with the system
    private func registerBackgroundTask() {
        let registered = BGTaskScheduler.shared.register(
            forTaskWithIdentifier: Self.backgroundTaskIdentifier,
            using: nil
        ) { [weak self] task in
            self?.handleBackgroundTask(task as! BGAppRefreshTask)
        }
        
        if registered {
            print("✅ Background task registered: \(Self.backgroundTaskIdentifier)")
        } else {
            print("⚠️ Failed to register background task - check BGTaskSchedulerPermittedIdentifiers in Info.plist")
        }
    }
    
    /// Schedule the next background task
    func scheduleBackgroundSync() {
        let request = BGAppRefreshTaskRequest(identifier: Self.backgroundTaskIdentifier)
        // Request to run no earlier than 15 minutes from now
        request.earliestBeginDate = Date(timeIntervalSinceNow: minimumSyncInterval)
        
        do {
            try BGTaskScheduler.shared.submit(request)
            print("📅 Background sync scheduled for ~15 minutes from now")
        } catch BGTaskScheduler.Error.notPermitted {
            print("⚠️ Background task not permitted - check Info.plist and capabilities")
        } catch BGTaskScheduler.Error.tooManyPendingTaskRequests {
            print("⚠️ Too many pending background tasks")
        } catch BGTaskScheduler.Error.unavailable {
            print("⚠️ Background tasks unavailable on this device")
        } catch {
            print("⚠️ Failed to schedule background sync: \(error)")
        }
    }
    
    /// Cancel any pending background sync tasks
    func cancelScheduledSync() {
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.backgroundTaskIdentifier)
        print("🛑 Cancelled pending background sync")
    }
    
    /// Handle the background task when it runs
    private func handleBackgroundTask(_ task: BGAppRefreshTask) {
        print("🔄 Background task started at \(Date())")
        
        // Schedule the next task immediately
        scheduleBackgroundSync()
        
        // Create a task to perform the sync
        let syncTask = Task {
            await performBackgroundSync()
        }
        
        // Set expiration handler
        task.expirationHandler = {
            syncTask.cancel()
            print("⚠️ Background task expired before completion")
        }
        
        // Wait for sync to complete
        Task {
            _ = await syncTask.value
            task.setTaskCompleted(success: true)
            print("✅ Background task completed at \(Date())")
        }
    }
    
    // MARK: - HealthKit Background Delivery
    
    /// Enable background delivery for the user's tracked metrics
    /// Call this after the user connects and we know which metrics they want to track
    func enableBackgroundDelivery(forMetricTypes metricTypes: [String]) async {
        // First, disable any existing observers
        disableAllObservers()
        
        guard HKHealthStore.isHealthDataAvailable() else {
            print("⚠️ HealthKit not available - cannot enable background delivery")
            return
        }
        
        guard !metricTypes.isEmpty else {
            print("⚠️ No metric types provided - not enabling background delivery")
            return
        }
        
        // Cache the metric types for app restart
        cachedMetricTypes = metricTypes
        
        // Map metric types to HKQuantityTypes
        for metricType in metricTypes {
            guard let hkType = healthKitType(for: metricType) else {
                print("⚠️ Unknown metric type: \(metricType)")
                continue
            }
            
            // Enable background delivery for this type
            do {
                try await healthStore.enableBackgroundDelivery(
                    for: hkType,
                    frequency: .hourly  // iOS minimum is hourly for most types
                )
                
                // Create observer query that fires when new data is available
                let query = HKObserverQuery(sampleType: hkType, predicate: nil) { [weak self] _, completionHandler, error in
                    if let error = error {
                        print("⚠️ Observer query error for \(metricType): \(error)")
                        completionHandler()
                        return
                    }
                    
                    print("📊 New \(metricType) data detected via HealthKit observer")
                    
                    // Perform sync in response to new data
                    Task {
                        await self?.performBackgroundSync()
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
        
        UserDefaults.standard.set(Date(), forKey: StorageKeys.lastBackgroundDeliverySetup)
        print("📱 Background delivery set up for \(observerQueries.count) metric types")
    }
    
    /// Disable all observer queries
    func disableAllObservers() {
        for query in observerQueries {
            healthStore.stop(query)
        }
        observerQueries.removeAll()
        cachedMetricTypes = []
        print("🛑 Disabled all HealthKit observers")
    }
    
    // MARK: - Sync Methods
    
    /// Perform sync when app comes to foreground
    /// This has a shorter rate limit than background sync
    func performForegroundSync() async {
        // Rate limit - don't sync if we synced recently
        if let lastSync = lastSyncTime, Date().timeIntervalSince(lastSync) < minimumForegroundSyncInterval {
            let secondsAgo = Int(Date().timeIntervalSince(lastSync))
            print("⏱️ Skipping foreground sync - last sync was \(secondsAgo)s ago")
            return
        }
        
        await performBackgroundSync()
    }
    
    /// Perform the actual background sync
    /// Only syncs metrics that the user has selected to track
    func performBackgroundSync() async {
        // Prevent concurrent syncs
        guard !isSyncing else {
            print("⚠️ Sync already in progress - skipping")
            return
        }
        
        isSyncing = true
        defer { isSyncing = false }
        
        // Check if we have credentials
        guard apiClient.hasStoredCredentials else {
            print("⚠️ No stored credentials - skipping background sync")
            return
        }
        
        // Rate limit - don't sync more than once per 5 minutes
        if let lastSync = lastSyncTime, Date().timeIntervalSince(lastSync) < 300 {
            let secondsAgo = Int(Date().timeIntervalSince(lastSync))
            print("⏱️ Rate limited - last sync was \(secondsAgo)s ago")
            return
        }
        
        print("🔄 Starting background sync...")
        
        do {
            // 1. Fetch which metrics the user has selected to track
            let trackedResponse = try await apiClient.fetchTrackedMetrics()
            let trackedMetricTypes = trackedResponse.metricTypes
            
            guard !trackedMetricTypes.isEmpty else {
                print("📊 No metrics selected to track - skipping sync")
                return
            }
            
            // Update cached types if they changed
            if cachedMetricTypes != trackedMetricTypes {
                print("📊 Tracked metrics changed - updating background delivery")
                await enableBackgroundDelivery(forMetricTypes: trackedMetricTypes)
            }
            
            print("📊 Syncing \(trackedMetricTypes.count) tracked metric types: \(trackedMetricTypes)")
            
            // 2. Fetch only those metrics from HealthKit
            // Background syncs only fetch 1 day to be efficient - manual syncs fetch 7 days for backfill
            let healthKitManager = HealthKitManager()
            let metrics = try await healthKitManager.fetchMetrics(forTypes: trackedMetricTypes, daysBack: 1)
            
            guard !metrics.isEmpty else {
                print("📊 No new metrics to sync")
                lastSyncTime = Date()
                return
            }
            
            // 3. Send to backend
            let response = try await apiClient.ingestMetrics(metrics)
            
            if response.success {
                lastSyncTime = Date()
                syncCount += 1
                print("✅ Background sync completed: \(metrics.count) metrics synced (total: \(syncCount))")
                
                // Post notification for UI update if app is in foreground
                await MainActor.run {
                    NotificationCenter.default.post(
                        name: NSNotification.Name("BackgroundSyncCompleted"),
                        object: nil,
                        userInfo: ["count": metrics.count, "time": Date()]
                    )
                }
            } else {
                let failedCount = response.results.filter { !$0.success }.count
                print("⚠️ Background sync partially failed: \(failedCount) metrics failed")
                lastSyncTime = Date() // Still update time to avoid retry storm
            }
            
        } catch let error as APIError {
            print("❌ Background sync failed: \(error)")
            
            // If token expired, disable background sync until user reconnects
            if case .httpError(401) = error {
                print("❌ Token expired - disabling background sync")
                disableAllObservers()
            }
            if case .serverError(401, _) = error {
                print("❌ Token expired - disabling background sync")
                disableAllObservers()
            }
        } catch {
            print("❌ Background sync failed: \(error)")
        }
    }
    
    // MARK: - Helpers
    
    /// Convert metric type string to HKSampleType
    private func healthKitType(for metricType: String) -> HKSampleType? {
        switch metricType {
        case "steps":
            return HKQuantityType.quantityType(forIdentifier: .stepCount)
        case "active_energy":
            return HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)
        case "basal_energy":
            return HKQuantityType.quantityType(forIdentifier: .basalEnergyBurned)
        case "distance":
            return HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning)
        case "flights_climbed":
            return HKQuantityType.quantityType(forIdentifier: .flightsClimbed)
        case "exercise_time":
            return HKQuantityType.quantityType(forIdentifier: .appleExerciseTime)
        case "stand_time":
            return HKQuantityType.quantityType(forIdentifier: .appleStandTime)
        case "hr":
            return HKQuantityType.quantityType(forIdentifier: .heartRate)
        case "hrv":
            return HKQuantityType.quantityType(forIdentifier: .heartRateVariabilitySDNN)
        case "resting_hr":
            return HKQuantityType.quantityType(forIdentifier: .restingHeartRate)
        case "walking_hr":
            return HKQuantityType.quantityType(forIdentifier: .walkingHeartRateAverage)
        case "respiratory_rate":
            return HKQuantityType.quantityType(forIdentifier: .respiratoryRate)
        case "oxygen_saturation":
            return HKQuantityType.quantityType(forIdentifier: .oxygenSaturation)
        case "sleep_session":
            return HKCategoryType.categoryType(forIdentifier: .sleepAnalysis)
        case "mindful_minutes":
            return HKCategoryType.categoryType(forIdentifier: .mindfulSession)
        default:
            return nil
        }
    }
    
    // MARK: - Debug
    
    /// Get debug info about background sync status
    var debugInfo: String {
        var info = "Background Sync Status:\n"
        info += "- Setup: \(isSetup)\n"
        info += "- Syncing: \(isSyncing)\n"
        info += "- Last sync: \(lastSyncTime?.description ?? "Never")\n"
        info += "- Total syncs: \(syncCount)\n"
        info += "- Active observers: \(observerQueries.count)\n"
        info += "- Cached metric types: \(cachedMetricTypes.joined(separator: ", "))\n"
        info += "- Has credentials: \(apiClient.hasStoredCredentials)\n"
        return info
    }
}
