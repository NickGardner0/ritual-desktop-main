import SwiftUI
import Clerk
import BackgroundTasks

@main
struct RitualCompanionApp: App {
    @StateObject private var appState = AppState()
    @Environment(\.scenePhase) private var scenePhase
    
    /// Use V2 sync manager for incremental sync, offline queue, etc.
    private let syncManager = BackgroundSyncManagerV2.shared
    
    init() {
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
                .task {
                    // Load Clerk session
                    try? await Clerk.shared.load()
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
        }
    }
    
    private func handleScenePhaseChange(from oldPhase: ScenePhase, to newPhase: ScenePhase) {
        switch newPhase {
        case .background:
            // App moved to background - schedule background sync
            print("📱 App moved to background - scheduling background sync V2")
            syncManager.scheduleBackgroundSync()
            
        case .active:
            // App became active - sync immediately if connected
            print("📱 App became active")
            
            // Perform a foreground sync if user is connected and has health access
            Task {
                // First, check if the connection is still valid
                await appState.checkInitialState()
                
                // If connected and has access, do an incremental sync
                if appState.isConnected && appState.hasHealthAccess {
                    print("📱 Triggering foreground sync V2 (incremental)")
                    await syncManager.performForegroundSync()
                    
                    // Update the UI with the latest sync time
                    await MainActor.run {
                        if let syncTime = syncManager.lastSyncTime {
                            appState.lastSyncTime = syncTime
                        }
                        // Update sync status
                        appState.syncStatus = syncManager.syncStatus
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
            print("📱 V2 Background sync: \(addedCount) added, \(deletedCount) deleted")
        } else if let count = notification.userInfo?["count"] as? Int {
            print("📱 Background sync notification received: \(count) metrics synced")
        }
        
        // Update sync status
        Task { @MainActor in
            appState.syncStatus = syncManager.syncStatus
        }
    }
    
    private func handleRequiresReauth() {
        // Token refresh failed repeatedly - need user to re-authenticate
        print("⚠️ Token refresh failed - user needs to re-authenticate")
        
        Task { @MainActor in
            // Disconnect and force sign-in again
            await appState.disconnect()
        }
    }
}
