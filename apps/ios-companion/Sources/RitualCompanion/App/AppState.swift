import SwiftUI
import Clerk
import Security

/// Global app state for Ritual Companion
@MainActor
final class AppState: ObservableObject {
    
    // MARK: - Published Properties
    
    /// Current connection status
    @Published var connectionStatus: ConnectionStatus = .disconnected
    
    /// Health data access status
    @Published var healthAccessStatus: HealthAccessStatus = .notDetermined
    
    /// Last successful sync time
    @Published var lastSyncTime: Date?
    
    /// Current sync state
    @Published var isSyncing: Bool = false
    
    /// Error message to display
    @Published var errorMessage: String?
    
    /// Show error alert
    @Published var showError: Bool = false
    
    /// Metric types the user has selected to track in the desktop app
    @Published var trackedMetricTypes: [String] = []
    
    /// Tracked habits from the desktop app
    @Published var trackedHabits: [TrackedHabit] = []
    
    /// Whether we're currently fetching tracked metrics
    @Published var isFetchingTrackedMetrics: Bool = false
    
    /// V2: Current sync status for UI display
    @Published var syncStatus: BackgroundSyncManagerV2.SyncStatus = .neverSynced

    /// Offline retry queue telemetry for UI
    @Published var queueTelemetry: OfflineSyncQueue.QueueTelemetry = OfflineSyncQueue.QueueTelemetry(
        pendingCount: 0,
        readyForRetryCount: 0,
        networkAvailable: true,
        isProcessing: false,
        oldestPendingDate: nil,
        totalPendingMetrics: 0
    )

    /// Recent sync history entries
    @Published var syncHistory: [BackgroundSyncManagerV2.SyncHistoryEntry] = []

    /// Pending request for future local-device pairing flows.
    @Published var pendingPairingRequest: PeerPairingRequest?

    /// Trusted peers explicitly approved on this device.
    @Published var trustedPeers: [TrustedPeer] = []

    /// Local export settings persisted on device.
    @Published var exportSettings: LocalExportSettings = LocalExportSettings.load()

    /// Local export history entries.
    @Published var exportHistory: [LocalExportHistoryEntry] = []

    /// Local export destination display name.
    @Published var exportDestinationName: String = "No folder selected"

    /// Export pipeline running state.
    @Published var isExporting: Bool = false

    /// Latest export status summary shown in UI.
    @Published var exportStatusMessage: String?

    /// Summary for most recent date-range retry.
    @Published var dateRangeRetrySummary: String?

    /// User-configured HealthKit → habit mappings (see HabitMapping.swift).
    @Published var habitMappings: [HabitMapping] = []

    /// Summary of the most recent habit-mapping resolver run, for UI.
    @Published var habitMappingStatus: String?

    /// Notification permission status for actionable sync alerts.
    @Published var notificationsEnabled: Bool = false
    
    // MARK: - Rate Limiting

    private var lastManualSyncTime: Date?
    private let manualSyncCooldown: TimeInterval = 30

    // MARK: - Services

    let healthKitManager = HealthKitManagerV2()
    let apiClient = RitualAPIClient.shared
    private let syncManager = BackgroundSyncManagerV2.shared
    private let notificationManager = NotificationManager.shared
    private let exportDestinationStore = ExportDestinationStore.shared
    private let localExportManager = LocalExportManager.shared
    private let exportHistoryStore = LocalExportHistoryStore.shared
    private let habitMappingStore = HabitMappingStore.shared
    private lazy var habitMappingResolver = HabitMappingResolver(
        apiClient: apiClient,
        healthKit: healthKitManager,
        store: habitMappingStore
    )
    private let trustedPeersStorageKey = "PeerPairing.trustedPeers"
    
    // MARK: - Computed Properties
    
    var isConnected: Bool {
        connectionStatus == .connected
    }
    
    var hasHealthAccess: Bool {
        healthAccessStatus == .authorized
    }
    
    var canSync: Bool {
        isConnected && hasHealthAccess && !isSyncing && !trackedMetricTypes.isEmpty
    }
    
    var hasTrackedMetrics: Bool {
        !trackedMetricTypes.isEmpty
    }

    var canExport: Bool {
        isConnected && hasHealthAccess && hasTrackedMetrics && !isExporting && exportDestinationStore.destinationURL != nil
    }
    
    var trackedMetricsDescription: String {
        if trackedMetricTypes.isEmpty {
            return "No metrics selected"
        }
        return "\(trackedMetricTypes.count) metric(s) selected"
    }
    
    var lastSyncDescription: String {
        guard let lastSync = lastSyncTime else {
            return "Never synced"
        }
        
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: lastSync, relativeTo: Date())
    }
    
    /// Debug info about background sync
    var backgroundSyncDebugInfo: String {
        syncManager.debugInfo
    }

    var retryQueueDescription: String {
        if queueTelemetry.pendingCount == 0 {
            return "No pending retries"
        }

        var parts: [String] = [
            "\(queueTelemetry.pendingCount) pending payload(s)",
            "\(queueTelemetry.totalPendingMetrics) metric(s)"
        ]

        if queueTelemetry.readyForRetryCount > 0 {
            parts.append("\(queueTelemetry.readyForRetryCount) ready now")
        }

        if let oldest = queueTelemetry.oldestPendingDate {
            let formatter = RelativeDateTimeFormatter()
            formatter.unitsStyle = .abbreviated
            parts.append("oldest \(formatter.localizedString(for: oldest, relativeTo: Date()))")
        }

        return parts.joined(separator: " | ")
    }

    var latestFailedDays: [String] {
        var orderedUniqueDays: [String] = []
        var seen = Set<String>()

        for entry in syncHistory {
            for day in entry.failedDays {
                if !seen.contains(day) {
                    orderedUniqueDays.append(day)
                    seen.insert(day)
                }
            }
            if orderedUniqueDays.count >= 14 {
                break
            }
        }

        return orderedUniqueDays
    }
    
    // MARK: - Initialization
    
    init() {
        // Load persisted last sync time from background sync manager.
        lastSyncTime = syncManager.lastSyncTime
        trustedPeers = loadTrustedPeers()
        exportHistory = exportHistoryStore.load()
        exportDestinationName = exportDestinationStore.destinationName
        habitMappings = habitMappingStore.loadMappings()
        
        Task {
            await checkInitialState()
        }
    }
    
    /// Check if user is signed out and handle accordingly
    func checkClerkSession() {
        if Clerk.shared.session == nil {
            connectionStatus = .disconnected
            // `apiClient` is now actor-isolated; hop off @MainActor to clear.
            Task { await apiClient.clearCredentials() }
        }
    }
    
    // MARK: - Methods
    
    func checkInitialState() async {
        // Check if we have stored credentials
        if await apiClient.hasStoredCredentials {
            // Verify credentials are still valid by trying to fetch tracked metrics
            connectionStatus = .connected
            let isValid = await verifyConnectionIsValid()
            if !isValid {
                // Token expired - clear credentials and show sign-in
                #if DEBUG
                print("⚠️ Stored credentials are invalid/expired - clearing")
                #endif
                await disconnect()
                return
            }
            
            // If valid, set up background delivery for tracked metrics
            if !trackedMetricTypes.isEmpty {
                await syncManager.enableBackgroundDelivery(forMetricTypes: trackedMetricTypes)
            }
        }
        
        // Check HealthKit authorization status
        healthAccessStatus = await healthKitManager.checkAuthorizationStatus(forMetricTypes: trackedMetricTypes)
        
        // Update last sync time from background manager
        lastSyncTime = syncManager.lastSyncTime
        refreshSyncDiagnostics()
    }
    
    /// Verify that stored credentials are still valid
    private func verifyConnectionIsValid() async -> Bool {
        do {
            let response = try await apiClient.fetchTrackedMetrics()
            trackedMetricTypes = response.metricTypes
            trackedHabits = response.habits
            await syncManager.submitTelemetryEvent(
                eventType: "credentials_valid",
                taskType: "foreground",
                success: true
            )
            await syncManager.submitTelemetryEvent(
                eventType: "tracked_metrics_received",
                taskType: "foreground",
                success: true,
                recordCount: trackedMetricTypes.count,
                metadata: ["metric_types": AnyCodable(trackedMetricTypes)]
            )
            #if DEBUG
            print("📊 Tracked metrics: \(trackedMetricTypes)")
            #endif
            return true
        } catch let error as APIError {
            if case .httpError(401) = error {
                #if DEBUG
                print("❌ Token expired (401)")
                #endif
                await syncManager.submitTelemetryEvent(
                    eventType: "credentials_invalid",
                    taskType: "foreground",
                    success: false,
                    errorMessage: error.localizedDescription
                )
                return false
            }
            if case .serverError(401, _) = error {
                #if DEBUG
                print("❌ Token expired (401)")
                #endif
                await syncManager.submitTelemetryEvent(
                    eventType: "credentials_invalid",
                    taskType: "foreground",
                    success: false,
                    errorMessage: error.localizedDescription
                )
                return false
            }
            // Other errors (network, etc.) - assume still valid
            #if DEBUG
            print("⚠️ Error checking connection: \(error)")
            #endif
            await syncManager.submitTelemetryEvent(
                eventType: "credentials_check_error",
                taskType: "foreground",
                success: false,
                errorMessage: error.localizedDescription
            )
            return true
        } catch {
            // Non-API errors - assume still valid
            #if DEBUG
            print("⚠️ Error checking connection: \(error)")
            #endif
            await syncManager.submitTelemetryEvent(
                eventType: "credentials_check_error",
                taskType: "foreground",
                success: false,
                errorMessage: error.localizedDescription
            )
            return true
        }
    }
    
    /// Fetch which metrics the user has selected to track in the desktop app
    @discardableResult
    func fetchTrackedMetrics() async -> Bool {
        guard connectionStatus == .connected else { return false }
        
        isFetchingTrackedMetrics = true
        defer { isFetchingTrackedMetrics = false }

        let previousMetricTypes = trackedMetricTypes
        let previousHabits = trackedHabits
        
        do {
            let response = try await apiClient.fetchTrackedMetrics()
            trackedMetricTypes = response.metricTypes
            trackedHabits = response.habits
            await syncManager.submitTelemetryEvent(
                eventType: "tracked_metrics_received",
                taskType: "foreground",
                success: true,
                recordCount: trackedMetricTypes.count,
                metadata: ["metric_types": AnyCodable(trackedMetricTypes)]
            )
            #if DEBUG
            print("📊 Tracked metrics: \(trackedMetricTypes)")
            #endif

            // Enable background delivery for these specific metrics
            if !trackedMetricTypes.isEmpty {
                await syncManager.enableBackgroundDelivery(forMetricTypes: trackedMetricTypes)

                // Schedule background sync if not already scheduled
                syncManager.scheduleBackgroundSync()
            }
            refreshSyncDiagnostics()
            return true
        } catch let error as APIError {
            // Check for expired token
            if case .httpError(401) = error {
                #if DEBUG
                print("❌ Token expired during fetch - disconnecting")
                #endif
                await syncManager.submitTelemetryEvent(
                    eventType: "credentials_invalid",
                    taskType: "foreground",
                    success: false,
                    errorMessage: error.localizedDescription
                )
                await disconnect()
                return false
            }
            if case .serverError(401, _) = error {
                #if DEBUG
                print("❌ Token expired during fetch - disconnecting")
                #endif
                await syncManager.submitTelemetryEvent(
                    eventType: "credentials_invalid",
                    taskType: "foreground",
                    success: false,
                    errorMessage: error.localizedDescription
                )
                await disconnect()
                return false
            }
            #if DEBUG
            print("⚠️ Failed to fetch tracked metrics: \(error.localizedDescription)")
            #endif
            trackedMetricTypes = previousMetricTypes
            trackedHabits = previousHabits
            await syncManager.submitTelemetryEvent(
                eventType: "tracked_metrics_fetch_failed",
                taskType: "foreground",
                success: false,
                errorMessage: error.localizedDescription
            )
            refreshSyncDiagnostics()
            return false
        } catch {
            #if DEBUG
            print("⚠️ Failed to fetch tracked metrics: \(error.localizedDescription)")
            #endif
            trackedMetricTypes = previousMetricTypes
            trackedHabits = previousHabits
            await syncManager.submitTelemetryEvent(
                eventType: "tracked_metrics_fetch_failed",
                taskType: "foreground",
                success: false,
                errorMessage: error.localizedDescription
            )
            refreshSyncDiagnostics()
            return false
        }
    }

    func requestHealthAccess() async {
        await syncManager.submitTelemetryEvent(
            eventType: "healthkit_authorization_requested",
            taskType: "foreground",
            recordCount: trackedMetricTypes.count,
            metadata: ["metric_types": AnyCodable(trackedMetricTypes)]
        )
        do {
            let authorized = try await healthKitManager.requestAuthorization(forMetricTypes: trackedMetricTypes)
            healthAccessStatus = authorized ? .authorized : .denied
            await syncManager.submitTelemetryEvent(
                eventType: "healthkit_authorization_completed",
                taskType: "foreground",
                success: authorized,
                recordCount: trackedMetricTypes.count,
                metadata: ["status": AnyCodable(healthAccessStatus.displayText)]
            )
            
            // If we got access and are connected, enable background delivery
            if authorized && isConnected && !trackedMetricTypes.isEmpty {
                await syncManager.enableBackgroundDelivery(forMetricTypes: trackedMetricTypes)
            }
        } catch {
            healthAccessStatus = .denied
            await syncManager.submitTelemetryEvent(
                eventType: "healthkit_authorization_completed",
                taskType: "foreground",
                success: false,
                recordCount: trackedMetricTypes.count,
                errorMessage: error.localizedDescription
            )
            showError(message: "Failed to request health access: \(error.localizedDescription)")
        }
    }
    
    /// Refresh health access status (call when returning from settings or permissions sheet)
    func refreshHealthStatus() async {
        healthAccessStatus = await healthKitManager.checkAuthorizationStatus(forMetricTypes: trackedMetricTypes)
        #if DEBUG
        print("📱 Health access status refreshed: \(healthAccessStatus.displayText)")
        #endif
        
        // If we now have access and are connected, enable background delivery
        if healthAccessStatus == .authorized && isConnected && !trackedMetricTypes.isEmpty {
            await syncManager.enableBackgroundDelivery(forMetricTypes: trackedMetricTypes)
        }
    }
    
    func connect(authToken: String) async {
        connectionStatus = .connecting
        
        do {
            try await apiClient.registerDevice(authToken: authToken)
            connectionStatus = .connected
            // Fetch which metrics the user has selected to track
            await fetchTrackedMetrics()
            // Clear any previous errors on success
            errorMessage = nil
            
            // Schedule background sync now that we're connected
            syncManager.scheduleBackgroundSync()
            refreshSyncDiagnostics()
            await requestSyncNotificationPermissions()
            
        } catch let error as APIError {
            connectionStatus = .disconnected
            let message: String
            switch error {
            case .httpError(let code):
                if code == 401 {
                    message = "Authentication failed. Please sign in again."
                } else if code == 404 {
                    message = "API endpoint not found. Check your API URL configuration."
                } else {
                    message = "Connection failed (HTTP \(code))"
                }
            case .serverError(_, let detail):
                message = detail
            case .invalidURL:
                message = "Invalid API URL. Check your configuration."
            case .invalidResponse:
                message = "Invalid response from server."
            case .notRegistered:
                message = "Device registration failed."
            case .invalidSecret:
                message = "Device secret error."
            case .tokenRefreshFailed:
                message = "Authentication expired. Please sign in again."
            case .noSession:
                message = "No active session. Please sign in."
            case .networkUnavailable:
                message = AppConfig.localDeviceAPIHint ?? "Network unavailable. Please check your connection."
            }
            showError(message: message)
        } catch {
            connectionStatus = .disconnected
            showError(message: "Connection failed: \(error.localizedDescription)")
        }
    }
    
    func disconnect() async {
        // Clear API credentials
        await apiClient.clearCredentials()
        connectionStatus = .disconnected
        lastSyncTime = nil
        
        // Clear tracked metrics
        trackedMetricTypes = []
        trackedHabits = []
        
        // Disable background sync and cancel pending tasks
        syncManager.disableAllObservers()
        syncManager.cancelScheduledSync()
        
        // Sign out of Clerk
        do {
            try await Clerk.shared.signOut()
        } catch {
            #if DEBUG
            print("⚠️ Error signing out of Clerk: \(error)")
            #endif
        }

        #if DEBUG
        print("📱 Disconnected - user will need to sign in again")
        #endif
        refreshSyncDiagnostics()
    }
    
    /// Sync metrics to the backend using V2 incremental sync
    /// - Parameter showErrorsToUser: If true, show error dialogs to user. Set to false for background syncs.
    func syncNow(showErrorsToUser: Bool = true) async {
        // Rate limiting: enforce cooldown between manual syncs
        if let lastSync = lastManualSyncTime, Date().timeIntervalSince(lastSync) < manualSyncCooldown {
            let remaining = Int(manualSyncCooldown - Date().timeIntervalSince(lastSync))
            if showErrorsToUser {
                showError(message: "Please wait \(remaining) seconds before syncing again")
            }
            return
        }

        guard isConnected else {
            if showErrorsToUser {
                showError(message: "Device is not connected. Please connect first.")
            }
            return
        }
        
        guard hasHealthAccess else {
            if showErrorsToUser {
                showError(message: "Health access is required to sync data")
            }
            return
        }
        
        // Refresh tracked metrics before syncing. Manual sync should use fresh
        // server settings instead of silently falling back to stale cached modes.
        let trackedMetricsRefreshed = await fetchTrackedMetrics()
        if !trackedMetricsRefreshed {
            if showErrorsToUser {
                if connectionStatus != .connected {
                    showError(message: "Authentication expired. Please sign in again.")
                } else {
                    showError(message: "Failed to refresh Apple Health sync settings. Please try again.")
                }
            }
            return
        }
        
        guard hasTrackedMetrics else {
            if showErrorsToUser {
                showError(message: "No metrics selected to sync.\n\nOpen the Ritual desktop app and select which Apple Watch data you want to track from the habit selection menu.")
            }
            return
        }
        
        guard !isSyncing else { return }

        isSyncing = true

        #if DEBUG
        print("📱 Starting manual sync via V2 incremental sync...")
        #endif

        // Use V2 sync manager which handles incremental sync with batching
        await syncManager.performIncrementalSync(isBackground: false)

        // Update UI state from V2 manager
        lastSyncTime = syncManager.lastSyncTime
        syncStatus = syncManager.syncStatus
        refreshSyncDiagnostics()

        isSyncing = false

        // Only arm the cooldown after a *successful* sync. Failed syncs
        // shouldn't lock the user out — they need to be able to retry
        // immediately, which is exactly when the cooldown was hurting them.
        if syncManager.lastError == nil {
            lastManualSyncTime = Date()
            // A successful sync proves we have HealthKit read access. Self-
            // heal in case verifyReadAccess() returned a false negative.
            if healthAccessStatus != .authorized {
                healthAccessStatus = .authorized
            }
        }
        
        // After a successful sync, translate any user-configured HealthKit →
        // habit mappings into habit log posts. This is deliberately run AFTER
        // upload so the cloud path is unaffected if the resolver errors.
        if CompanionFeatureFlags.habitMappingEnabled, !habitMappings.isEmpty, syncManager.lastError == nil {
            await runHabitMappingResolver()
        }

        // Show error if sync failed
        if showErrorsToUser, let error = syncManager.lastError {
            // Only show if the error is recent (within last 30 seconds)
            if let errorTime = syncManager.lastErrorTime,
               Date().timeIntervalSince(errorTime) < 30 {
                showError(message: "Sync failed: \(error)")
            }
        } else if lastSyncTime != nil {
            // Clear any previous errors on success
            errorMessage = nil
            #if DEBUG
            print("✅ Manual sync completed successfully")
            #endif
        }
    }

    func retryFailedDays(_ dayKeys: [String], showErrorsToUser: Bool = true) async {
        guard isConnected else {
            if showErrorsToUser {
                showError(message: "Device is not connected. Please connect first.")
            }
            return
        }

        guard hasHealthAccess else {
            if showErrorsToUser {
                showError(message: "Health access is required to sync data")
            }
            return
        }

        guard !dayKeys.isEmpty else {
            if showErrorsToUser {
                showError(message: "No failed days available to retry.")
            }
            return
        }

        guard !isSyncing else { return }
        isSyncing = true

        let retriedCount = await syncManager.retryFailedDays(dayKeys)
        isSyncing = false

        refreshSyncDiagnostics()

        if retriedCount == 0, showErrorsToUser {
            if let error = syncManager.lastError {
                showError(message: "Retry failed: \(error)")
            } else {
                showError(message: "No new data was available for the selected failed days.")
            }
        }
    }

    func refreshSyncDiagnostics() {
        syncStatus = syncManager.syncStatus
        lastSyncTime = syncManager.lastSyncTime
        queueTelemetry = syncManager.queueTelemetry
        syncHistory = syncManager.syncHistory
        exportDestinationName = exportDestinationStore.destinationName
    }

    func requestSyncNotificationPermissions() async {
        notificationsEnabled = await notificationManager.requestPermissionsIfNeeded()
    }

    func selectExportDestination(_ url: URL) {
        exportDestinationStore.selectDestination(url)
        exportDestinationName = exportDestinationStore.destinationName
    }

    func clearExportDestination() {
        exportDestinationStore.clearDestination()
        exportDestinationName = exportDestinationStore.destinationName
    }

    func updateExportSettings(_ mutate: (inout LocalExportSettings) -> Void) {
        var updated = exportSettings
        mutate(&updated)
        exportSettings = updated
        updated.save()
    }

    func retryDateRange(startDate: Date, endDate: Date, showErrorsToUser: Bool = true) async {
        guard isConnected else {
            if showErrorsToUser {
                showError(message: "Device is not connected. Please connect first.")
            }
            return
        }

        guard hasHealthAccess else {
            if showErrorsToUser {
                showError(message: "Health access is required to sync data")
            }
            return
        }

        guard !isSyncing else { return }
        isSyncing = true

        let result = await syncManager.retryDateRange(startDate: startDate, endDate: endDate)
        isSyncing = false

        refreshSyncDiagnostics()

        if let error = result.errorMessage, result.syncedMetricCount == 0 {
            if showErrorsToUser {
                showError(message: "Retry failed: \(error)")
            }
            dateRangeRetrySummary = "Retry failed"
            return
        }

        dateRangeRetrySummary = "Retried \(result.attemptedDays) day(s): \(result.syncedMetricCount) metrics synced, \(result.failedDays.count) day(s) still failing, \(result.queuedBatchCount) batch(es) queued"
    }

    func exportDateRange(startDate: Date, endDate: Date, showErrorsToUser: Bool = true) async {
        guard isConnected else {
            if showErrorsToUser {
                showError(message: "Connect your device before exporting.")
            }
            return
        }

        guard hasHealthAccess else {
            if showErrorsToUser {
                showError(message: "Health access is required for export.")
            }
            return
        }

        guard hasTrackedMetrics else {
            if showErrorsToUser {
                showError(message: "No tracked metrics selected in Ritual desktop.")
            }
            return
        }

        guard exportDestinationStore.destinationURL != nil else {
            if showErrorsToUser {
                showError(message: "Select an export folder before exporting.")
            }
            return
        }

        guard !isExporting else { return }
        isExporting = true
        defer { isExporting = false }

        let result = await localExportManager.exportDateRange(
            startDate: startDate,
            endDate: endDate,
            metricTypes: trackedMetricTypes,
            settings: exportSettings,
            destinationStore: exportDestinationStore,
            healthKitManager: healthKitManager
        )

        recordExportResult(
            result: result,
            startDate: min(startDate, endDate),
            endDate: max(startDate, endDate)
        )

        if result.succeeded {
            exportStatusMessage = "Exported \(result.successDays) day(s), \(result.exportedMetricCount) metrics"
        } else if result.partiallySucceeded {
            exportStatusMessage = "Partial export: \(result.successDays)/\(result.attemptedDays) day(s)"
        } else {
            exportStatusMessage = result.failureReason?.description ?? "Export failed"
            if showErrorsToUser {
                showError(message: result.failureMessage ?? exportStatusMessage ?? "Export failed")
            }
        }
    }

    func exportFailedDays(_ dayKeys: [String], showErrorsToUser: Bool = true) async {
        guard !dayKeys.isEmpty else { return }
        guard isConnected, hasHealthAccess, hasTrackedMetrics, exportDestinationStore.destinationURL != nil else {
            if showErrorsToUser {
                showError(message: "Connect, grant Health access, and select an export folder before retrying export.")
            }
            return
        }
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"

        let dates = dayKeys.compactMap { formatter.date(from: String($0.prefix(10))) }.sorted()
        guard let startDate = dates.first, let endDate = dates.last else { return }

        guard !isExporting else { return }
        isExporting = true
        defer { isExporting = false }

        let result = await localExportManager.exportDayKeys(
            dayKeys,
            startDate: startDate,
            endDate: endDate,
            metricTypes: trackedMetricTypes,
            settings: exportSettings,
            destinationStore: exportDestinationStore,
            healthKitManager: healthKitManager
        )

        recordExportResult(result: result, startDate: startDate, endDate: endDate)

        if result.succeeded {
            exportStatusMessage = "Retried failed exports successfully."
        } else if result.partiallySucceeded {
            exportStatusMessage = "Retry partial: \(result.successDays)/\(result.attemptedDays) day(s)"
        } else {
            exportStatusMessage = "Retry export failed"
            if showErrorsToUser {
                showError(message: result.failureMessage ?? "Retry export failed")
            }
        }
    }

    // MARK: - Habit Mapping

    /// Insert or replace a habit mapping. The store de-dupes by (habitId, metricType)
    /// so re-binding the same habit to a new metric replaces the old rule.
    func upsertHabitMapping(_ mapping: HabitMapping) {
        habitMappings = habitMappingStore.upsert(mapping)
    }

    func deleteHabitMapping(id: String) {
        habitMappings = habitMappingStore.delete(id: id)
    }

    /// Run the resolver manually (e.g. from a "Sync habits now" button).
    func runHabitMappingResolver() async {
        guard !habitMappings.isEmpty else {
            habitMappingStatus = "No habit mappings configured"
            return
        }

        let result = await habitMappingResolver.resolveAndPost(mappings: habitMappings)

        var parts: [String] = []
        if result.posted > 0 { parts.append("\(result.posted) posted") }
        if result.skipped > 0 { parts.append("\(result.skipped) unchanged") }
        if result.failed > 0 { parts.append("\(result.failed) failed") }
        habitMappingStatus = parts.isEmpty ? "No changes" : parts.joined(separator: ", ")

        #if DEBUG
        if !result.errors.isEmpty {
            print("⚠️ HabitMappingResolver errors: \(result.errors)")
        }
        #endif
    }

    func clearExportHistory() {
        exportHistoryStore.clear()
        exportHistory = []
    }

    func receivePairingRequest(peerName: String, peerFingerprint: String) {
        pendingPairingRequest = PeerPairingRequest(
            id: UUID().uuidString,
            peerName: peerName,
            peerFingerprint: peerFingerprint,
            requestedAt: Date()
        )
    }

    func confirmPendingPairing() {
        guard let request = pendingPairingRequest else { return }

        let peer = TrustedPeer(
            id: request.id,
            peerName: request.peerName,
            peerFingerprint: request.peerFingerprint,
            approvedAt: Date()
        )

        trustedPeers.append(peer)
        saveTrustedPeers()
        pendingPairingRequest = nil
    }

    func declinePendingPairing() {
        pendingPairingRequest = nil
    }

    func isTrustedPeer(peerName: String, peerFingerprint: String) -> Bool {
        trustedPeers.contains {
            $0.peerName == peerName && $0.peerFingerprint == peerFingerprint
        }
    }

    private func loadTrustedPeers() -> [TrustedPeer] {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.ritual.trustedPeers",
            kSecAttrAccount as String: trustedPeersStorageKey,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess,
              let data = result as? Data else {
            return []
        }

        return (try? JSONDecoder().decode([TrustedPeer].self, from: data)) ?? []
    }

    private func saveTrustedPeers() {
        guard let data = try? JSONEncoder().encode(trustedPeers) else { return }

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.ritual.trustedPeers",
            kSecAttrAccount as String: trustedPeersStorageKey,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]

        let attributes: [String: Any] = [
            kSecValueData as String: data
        ]

        let existingStatus = SecItemCopyMatching(query as CFDictionary, nil)

        if existingStatus == errSecSuccess {
            SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        } else {
            var createQuery = query
            createQuery[kSecValueData as String] = data
            SecItemAdd(createQuery as CFDictionary, nil)
        }
    }
    
    private func showError(message: String) {
        errorMessage = message
        showError = true
    }

    private func recordExportResult(result: LocalExportResult, startDate: Date, endDate: Date) {
        let entry = LocalExportHistoryEntry(
            id: UUID().uuidString,
            timestamp: Date(),
            startDate: startDate,
            endDate: endDate,
            format: exportSettings.format,
            successDays: result.successDays,
            attemptedDays: result.attemptedDays,
            failedDays: result.failedDays,
            exportedMetricCount: result.exportedMetricCount,
            failureReason: result.failureReason,
            failureMessage: result.failureMessage
        )
        exportHistory = exportHistoryStore.append(entry)
    }
}

// MARK: - Status Types

enum ConnectionStatus: String {
    case disconnected
    case connecting
    case connected
    
    var displayText: String {
        switch self {
        case .disconnected: return "Disconnected"
        case .connecting: return "Connecting..."
        case .connected: return "Connected to Ritual"
        }
    }
    
    var icon: String {
        switch self {
        case .disconnected: return "wifi.slash"
        case .connecting: return "wifi.exclamationmark"
        case .connected: return "checkmark.circle.fill"
        }
    }
    
    var color: Color {
        switch self {
        case .disconnected: return .secondary
        case .connecting: return .orange
        case .connected: return .green
        }
    }
}

enum HealthAccessStatus: String {
    case notDetermined
    case authorized
    case denied
    
    var displayText: String {
        switch self {
        case .notDetermined: return "Not Requested"
        case .authorized: return "Granted"
        case .denied: return "Denied"
        }
    }
    
    var icon: String {
        switch self {
        case .notDetermined: return "questionmark.circle"
        case .authorized: return "checkmark.circle.fill"
        case .denied: return "xmark.circle.fill"
        }
    }
    
    var color: Color {
        switch self {
        case .notDetermined: return .secondary
        case .authorized: return .green
        case .denied: return .red
        }
    }
}

struct PeerPairingRequest: Identifiable, Codable {
    let id: String
    let peerName: String
    let peerFingerprint: String
    let requestedAt: Date
}

struct TrustedPeer: Identifiable, Codable {
    let id: String
    let peerName: String
    let peerFingerprint: String
    let approvedAt: Date
}
