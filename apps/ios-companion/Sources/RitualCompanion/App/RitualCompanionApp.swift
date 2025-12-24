import SwiftUI
import Clerk
import BackgroundTasks

@main
struct RitualCompanionApp: App {
    @StateObject private var appState = AppState()
    @Environment(\.scenePhase) private var scenePhase
    
    init() {
        // Configure Clerk early in app lifecycle
        Clerk.shared.configure(publishableKey: AppConfig.clerkPublishableKey)
        
        // Set up background sync - this registers the background task handler
        // MUST be called before the app finishes launching
        BackgroundSyncManager.shared.setupBackgroundSync()
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
        }
    }
    
    private func handleScenePhaseChange(from oldPhase: ScenePhase, to newPhase: ScenePhase) {
        switch newPhase {
        case .background:
            // App moved to background - schedule background sync
            print("📱 App moved to background - scheduling background sync")
            BackgroundSyncManager.shared.scheduleBackgroundSync()
            
        case .active:
            // App became active - sync immediately if connected
            print("📱 App became active")
            
            // Perform a foreground sync if user is connected and has health access
            Task {
                // First, check if the connection is still valid
                await appState.checkInitialState()
                
                // If connected and has access, do a sync
                if appState.isConnected && appState.hasHealthAccess {
                    print("📱 Triggering foreground sync")
                    await BackgroundSyncManager.shared.performForegroundSync()
                    
                    // Update the UI with the latest sync time
                    await MainActor.run {
                        if let syncTime = BackgroundSyncManager.shared.lastSyncTime {
                            appState.lastSyncTime = syncTime
                        }
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
        
        if let count = notification.userInfo?["count"] as? Int {
            print("📱 Background sync notification received: \(count) metrics synced")
        }
    }
}
