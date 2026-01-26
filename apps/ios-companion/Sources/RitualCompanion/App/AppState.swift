import SwiftUI
import Clerk

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
    
    // MARK: - Services
    
    let healthKitManager = HealthKitManager()
    let apiClient = RitualAPIClient()
    
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
        BackgroundSyncManager.shared.debugInfo
    }
    
    // MARK: - Initialization
    
    init() {
        // Load persisted last sync time from BackgroundSyncManager
        lastSyncTime = BackgroundSyncManager.shared.lastSyncTime
        
        Task {
            await checkInitialState()
        }
    }
    
    /// Check if user is signed out and handle accordingly
    func checkClerkSession() {
        if Clerk.shared.session == nil {
            connectionStatus = .disconnected
            apiClient.clearCredentials()
        }
    }
    
    // MARK: - Methods
    
    func checkInitialState() async {
        // Check if we have stored credentials
        if apiClient.hasStoredCredentials {
            // Verify credentials are still valid by trying to fetch tracked metrics
            connectionStatus = .connected
            let isValid = await verifyConnectionIsValid()
            if !isValid {
                // Token expired - clear credentials and show sign-in
                print("⚠️ Stored credentials are invalid/expired - clearing")
                await disconnect()
                return
            }
            
            // If valid, set up background delivery for tracked metrics
            if !trackedMetricTypes.isEmpty {
                await BackgroundSyncManager.shared.enableBackgroundDelivery(forMetricTypes: trackedMetricTypes)
            }
        }
        
        // Check HealthKit authorization status
        healthAccessStatus = await healthKitManager.checkAuthorizationStatus()
        
        // Update last sync time from background manager
        lastSyncTime = BackgroundSyncManager.shared.lastSyncTime
    }
    
    /// Verify that stored credentials are still valid
    private func verifyConnectionIsValid() async -> Bool {
        do {
            let response = try await apiClient.fetchTrackedMetrics()
            trackedMetricTypes = response.metricTypes
            trackedHabits = response.habits
            print("📊 Tracked metrics: \(trackedMetricTypes)")
            return true
        } catch let error as APIError {
            if case .httpError(401) = error {
                print("❌ Token expired (401)")
                return false
            }
            if case .serverError(401, _) = error {
                print("❌ Token expired (401)")
                return false
            }
            // Other errors (network, etc.) - assume still valid
            print("⚠️ Error checking connection: \(error)")
            return true
        } catch {
            // Non-API errors - assume still valid
            print("⚠️ Error checking connection: \(error)")
            return true
        }
    }
    
    /// Fetch which metrics the user has selected to track in the desktop app
    func fetchTrackedMetrics() async {
        guard connectionStatus == .connected else { return }
        
        isFetchingTrackedMetrics = true
        defer { isFetchingTrackedMetrics = false }
        
        do {
            let response = try await apiClient.fetchTrackedMetrics()
            trackedMetricTypes = response.metricTypes
            trackedHabits = response.habits
            print("📊 Tracked metrics: \(trackedMetricTypes)")
            
            // Enable background delivery for these specific metrics
            if !trackedMetricTypes.isEmpty {
                await BackgroundSyncManager.shared.enableBackgroundDelivery(forMetricTypes: trackedMetricTypes)
                
                // Schedule background sync if not already scheduled
                BackgroundSyncManager.shared.scheduleBackgroundSync()
            }
        } catch let error as APIError {
            // Check for expired token
            if case .httpError(401) = error {
                print("❌ Token expired during fetch - disconnecting")
                await disconnect()
                return
            }
            if case .serverError(401, _) = error {
                print("❌ Token expired during fetch - disconnecting")
                await disconnect()
                return
            }
            print("⚠️ Failed to fetch tracked metrics: \(error.localizedDescription)")
            trackedMetricTypes = []
            trackedHabits = []
        } catch {
            print("⚠️ Failed to fetch tracked metrics: \(error.localizedDescription)")
            trackedMetricTypes = []
            trackedHabits = []
        }
    }
    
    func requestHealthAccess() async {
        do {
            let authorized = try await healthKitManager.requestAuthorization()
            healthAccessStatus = authorized ? .authorized : .denied
            
            // If we got access and are connected, enable background delivery
            if authorized && isConnected && !trackedMetricTypes.isEmpty {
                await BackgroundSyncManager.shared.enableBackgroundDelivery(forMetricTypes: trackedMetricTypes)
            }
        } catch {
            healthAccessStatus = .denied
            showError(message: "Failed to request health access: \(error.localizedDescription)")
        }
    }
    
    /// Refresh health access status (call when returning from settings or permissions sheet)
    func refreshHealthStatus() async {
        healthAccessStatus = await healthKitManager.checkAuthorizationStatus()
        print("📱 Health access status refreshed: \(healthAccessStatus.displayText)")
        
        // If we now have access and are connected, enable background delivery
        if healthAccessStatus == .authorized && isConnected && !trackedMetricTypes.isEmpty {
            await BackgroundSyncManager.shared.enableBackgroundDelivery(forMetricTypes: trackedMetricTypes)
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
            BackgroundSyncManager.shared.scheduleBackgroundSync()
            
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
                message = "Network unavailable. Please check your connection."
            }
            showError(message: message)
        } catch {
            connectionStatus = .disconnected
            showError(message: "Connection failed: \(error.localizedDescription)")
        }
    }
    
    func disconnect() async {
        // Clear API credentials
        apiClient.clearCredentials()
        connectionStatus = .disconnected
        lastSyncTime = nil
        
        // Clear tracked metrics
        trackedMetricTypes = []
        trackedHabits = []
        
        // Disable background sync and cancel pending tasks
        BackgroundSyncManager.shared.disableAllObservers()
        BackgroundSyncManager.shared.cancelScheduledSync()
        
        // Sign out of Clerk
        do {
            try await Clerk.shared.signOut()
        } catch {
            print("⚠️ Error signing out of Clerk: \(error)")
        }
        
        print("📱 Disconnected - user will need to sign in again")
    }
    
    /// Sync metrics to the backend using V2 incremental sync
    /// - Parameter showErrorsToUser: If true, show error dialogs to user. Set to false for background syncs.
    func syncNow(showErrorsToUser: Bool = true) async {
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
        
        // Refresh tracked metrics before syncing
        await fetchTrackedMetrics()
        
        guard hasTrackedMetrics else {
            if showErrorsToUser {
                showError(message: "No metrics selected to sync.\n\nOpen the Ritual desktop app and select which Apple Watch data you want to track from the habit selection menu.")
            }
            return
        }
        
        guard !isSyncing else { return }
        
        isSyncing = true
        
        print("📱 Starting manual sync via V2 incremental sync...")
        
        // Use V2 sync manager which handles incremental sync with batching
        await BackgroundSyncManagerV2.shared.performIncrementalSync(isBackground: false)
        
        // Update UI state from V2 manager
        let syncManager = BackgroundSyncManagerV2.shared
        lastSyncTime = syncManager.lastSyncTime
        syncStatus = syncManager.syncStatus
        
        isSyncing = false
        
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
            print("✅ Manual sync completed successfully")
        }
    }
    
    private func showError(message: String) {
        errorMessage = message
        showError = true
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
