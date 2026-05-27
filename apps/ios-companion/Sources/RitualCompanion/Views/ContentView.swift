import SwiftUI
import Clerk

/// Main content view that shows either Connect or Status based on state
struct ContentView: View {
    @EnvironmentObject var appState: AppState
    
    var body: some View {
        NavigationStack {
            ZStack {
                // Background
                Color(.systemBackground)
                    .ignoresSafeArea()
                
                // Content based on connection state
                if appState.isConnected {
                    StatusView()
                } else {
                    ConnectView()
                }
            }
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .alert("Error", isPresented: $appState.showError) {
                Button("OK", role: .cancel) { }
            } message: {
                Text(appState.errorMessage ?? "An error occurred")
            }
        }
    }
}

#Preview {
    ContentView()
        .environmentObject(AppState())
        .environmentObject(WhoopBroadcastService())
        .environmentObject(LocationManager.shared)
}
