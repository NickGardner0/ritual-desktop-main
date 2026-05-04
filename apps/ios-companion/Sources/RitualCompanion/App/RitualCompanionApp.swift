import SwiftUI
import Clerk
import BackgroundTasks

@main
struct RitualCompanionApp: App {
    @StateObject private var appState = AppState()
    @StateObject private var whoopService = WhoopBroadcastService()
    @Environment(\.scenePhase) private var scenePhase
    
    /// Use V2 sync manager for incremental sync, offline queue, etc.
    private let syncManager = BackgroundSyncManagerV2.shared
    private let notificationManager = NotificationManager.shared
    
    init() {
        // One-time cleanup: wipe stale Clerk keychain items left behind by a
        // previous install that used a different Clerk instance (keychain items
        // survive app deletion on iOS). We key off a UserDefaults flag so this
        // only runs once.
        let cleanupKey = "clerk_keychain_cleaned_v1"
        if !UserDefaults.standard.bool(forKey: cleanupKey) {
            let secClasses: [CFString] = [
                kSecClassGenericPassword,
                kSecClassInternetPassword,
            ]
            for secClass in secClasses {
                let query: [String: Any] = [
                    kSecClass as String: secClass,
                    // Clerk iOS SDK stores items under the app's default access group.
                ]
                SecItemDelete(query as CFDictionary)
            }
            #if DEBUG
            print("🧹 Cleared stale Clerk keychain items from previous install")
            #endif
            UserDefaults.standard.set(true, forKey: cleanupKey)
        }

        // Configure Clerk early in app lifecycle
        Clerk.shared.configure(publishableKey: AppConfig.clerkPublishableKey)

        // Set up V2 background sync - this registers the background task handler
        // MUST be called before the app finishes launching
        BackgroundSyncManagerV2.shared.setupBackgroundSync()
    }
    
    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(appState)
                .environmentObject(whoopService)
                .task {
                    // Load Clerk session
                    do {
                        try await Clerk.shared.load()
                    } catch {
                        #if DEBUG
                        print("Failed to load Clerk: \(error)")
                        #endif
                    }
                    await syncManager.submitTelemetryEvent(
                        eventType: "app_launched",
                        taskType: "foreground"
                    )
                    whoopService.handleAppDidBecomeActive()
                }
                .onChange(of: scenePhase) { oldPhase, newPhase in
                    handleScenePhaseChange(from: oldPhase, to: newPhase)
                }
                .onReceive(NotificationCenter.default.publisher(for: NSNotification.Name("BackgroundSyncCompleted"))) { notification in
                    // Update UI when background sync completes
                    handleBackgroundSyncCompleted(notification)
                }
                .onReceive(NotificationCenter.default.publisher(for: NSNotification.Name("RequiresReauthentication"))) { _ in
                    // Handle token expiration - force re-auth
                    handleRequiresReauth()
                }
                .onReceive(NotificationCenter.default.publisher(for: .syncActionRequired)) { notification in
                    handleSyncActionRequired(notification)
                }
                .onReceive(NotificationCenter.default.publisher(for: .syncRetryCompleted)) { notification in
                    handleSyncRetryCompleted(notification)
                }
        }
    }
    
    private func handleScenePhaseChange(from oldPhase: ScenePhase, to newPhase: ScenePhase) {
        switch newPhase {
        case .background:
            // App moved to background - schedule background sync
            #if DEBUG
            print("📱 App moved to background - scheduling background sync V2")
            #endif
            syncManager.scheduleBackgroundSync()
            whoopService.handleAppDidEnterBackground()
            
        case .active:
            // App became active - sync immediately if connected
            #if DEBUG
            print("📱 App became active")
            #endif
            whoopService.handleAppDidBecomeActive()
            
            // Perform a foreground sync if user is connected and has health access
            Task {
                // First, check if the connection is still valid
                await appState.checkInitialState()
                
                // If connected and has access, do an incremental sync
                if appState.isConnected && appState.hasHealthAccess {
                    #if DEBUG
                    print("📱 Triggering foreground sync V2 (incremental)")
                    #endif
                    await syncManager.performForegroundSync()
                    
                    // Update the UI with the latest sync time
                    await MainActor.run {
                        appState.refreshSyncDiagnostics()
                    }
                }
            }
            
        case .inactive:
            // App is transitioning - could be going to background or coming to foreground
            break
            
        @unknown default:
            break
        }
    }
    
    private func handleBackgroundSyncCompleted(_ notification: Notification) {
        // Update appState with the latest sync time from background sync
        if let syncTime = notification.userInfo?["time"] as? Date {
            appState.lastSyncTime = syncTime
        }
        
        // V2 notifications include addedCount and deletedCount
        if let addedCount = notification.userInfo?["addedCount"] as? Int,
           let deletedCount = notification.userInfo?["deletedCount"] as? Int {
            #if DEBUG
            print("📱 V2 Background sync: \(addedCount) added, \(deletedCount) deleted")
            #endif
            // A successful background sync that returned data is concrete
            // proof of HealthKit read access. Self-heal the UI in case the
            // verifyReadAccess() heuristic returned a false negative earlier.
            if addedCount > 0 {
                Task { @MainActor in
                    appState.healthAccessStatus = .authorized
                }
            }
        } else if let count = notification.userInfo?["count"] as? Int {
            #if DEBUG
            print("📱 Background sync notification received: \(count) metrics synced")
            #endif
        }
        
        // Update sync status
        Task { @MainActor in
            appState.refreshSyncDiagnostics()
        }
    }
    
    private func handleRequiresReauth() {
        // Token refresh failed repeatedly - need user to re-authenticate
        #if DEBUG
        print("⚠️ Token refresh failed - user needs to re-authenticate")
        #endif
        
        Task { @MainActor in
            // Disconnect and force sign-in again
            await appState.disconnect()
        }
    }

    private func handleSyncActionRequired(_ notification: Notification) {
        guard let userInfo = notification.userInfo else { return }
        guard let rawReason = userInfo["reason"] as? String,
              let reason = SyncActionRequiredReason(rawValue: rawReason) else { return }
        let message = userInfo["message"] as? String
        notificationManager.sendActionRequired(reason, message: message)
    }

    private func handleSyncRetryCompleted(_ notification: Notification) {
        guard let userInfo = notification.userInfo else { return }
        let failedDays = (userInfo["failedDays"] as? [String]) ?? []
        let syncedMetricCount = userInfo["syncedMetricCount"] as? Int ?? 0
        if !failedDays.isEmpty {
            notificationManager.sendRetryCompleted(
                remainingFailedDays: failedDays.count,
                syncedMetricCount: syncedMetricCount
            )
        }
    }
}
