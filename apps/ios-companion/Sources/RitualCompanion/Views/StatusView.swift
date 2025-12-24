import SwiftUI
import Clerk

/// Main status view showing connection state and sync controls
struct StatusView: View {
    @EnvironmentObject var appState: AppState
    @State private var showingPermissions = false
    @State private var showingDisconnectAlert = false
    @State private var lastBackgroundSyncInfo: String? = nil
    
    // Access Clerk user directly
    private var clerkUser: User? {
        Clerk.shared.user
    }
    
    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                // Header - simple profile display
                HStack {
                    Spacer()
                    if let user = clerkUser, let email = user.primaryEmailAddress?.emailAddress {
                        Text(email)
                            .font(.system(size: 12))
                            .foregroundColor(.gray)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 12)
                .padding(.bottom, 24)
                
                // App header - minimal
                VStack(spacing: 16) {
                    // Simple logo icon
                    RitualLogoShape()
                        .fill(Color.black)
                        .frame(width: 36, height: 38)
                    
                    Text("Ritual Companion")
                        .font(.system(size: 24, weight: .semibold))
                        .foregroundColor(.black)
                }
                .padding(.bottom, 32)
                
                // Status cards - stacked with no gaps
                VStack(spacing: 0) {
                    StatusCard(
                        title: "Connection",
                        status: appState.connectionStatus.displayText,
                        icon: appState.connectionStatus == .connected ? "checkmark" : "xmark",
                        iconColor: appState.connectionStatus == .connected ? .green : .secondary
                    )
                    
                    StatusCard(
                        title: "Health Access",
                        status: appState.healthAccessStatus.displayText,
                        icon: appState.healthAccessStatus == .authorized ? "checkmark" : "xmark",
                        iconColor: appState.healthAccessStatus == .authorized ? .green : .secondary
                    )
                    
                    StatusCard(
                        title: "Tracked Metrics",
                        status: appState.trackedMetricsDescription,
                        icon: "list.bullet",
                        iconColor: appState.hasTrackedMetrics ? .green : .secondary
                    )
                    
                    StatusCard(
                        title: "Last Sync",
                        status: appState.lastSyncDescription,
                        icon: "clock",
                        iconColor: appState.lastSyncTime != nil ? .green : .secondary
                    )
                }
                .padding(.horizontal, 20)
                
                // Sync button - clean black design
                Button(action: syncNow) {
                    HStack(spacing: 10) {
                        if appState.isSyncing {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                .scaleEffect(0.8)
                        } else {
                            Image(systemName: "arrow.triangle.2.circlepath")
                                .font(.system(size: 16))
                        }
                        Text(appState.isSyncing ? "Syncing..." : "Sync Now")
                            .font(.system(size: 16, weight: .medium))
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 52)
                    .background(appState.canSync ? Color.black : Color.gray.opacity(0.3))
                    .foregroundColor(appState.canSync ? .white : .gray)
                }
                .disabled(!appState.canSync)
                .padding(.horizontal, 20)
                .padding(.top, 24)
                
                // Info notices
                if !appState.hasHealthAccess {
                    noticeCard(
                        icon: "exclamationmark.triangle",
                        title: "Health Access Required",
                        message: "Grant health access to sync your data"
                    )
                    .onTapGesture {
                        showingPermissions = true
                    }
                }
                
                if appState.isConnected && appState.hasHealthAccess && !appState.hasTrackedMetrics {
                    noticeCard(
                        icon: "info.circle",
                        title: "No Metrics Selected",
                        message: "Open the Ritual desktop app and select which Apple Watch data you want to track"
                    )
                }
                
                // Tracked habits list
                if appState.hasTrackedMetrics {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text("Syncing These Metrics:")
                                .font(.system(size: 13))
                                .foregroundColor(.gray)
                            Spacer()
                            Button(action: refreshTrackedMetrics) {
                                HStack(spacing: 4) {
                                    Image(systemName: "arrow.clockwise")
                                        .font(.system(size: 12))
                                    Text("Refresh")
                                        .font(.system(size: 12))
                                }
                                .foregroundColor(.black)
                            }
                            .disabled(appState.isFetchingTrackedMetrics)
                        }
                        
                        // Metric tags - clean design
                        FlowLayout(spacing: 8) {
                            ForEach(appState.trackedHabits, id: \.id) { habit in
                                HStack(spacing: 6) {
                                    Image(systemName: "checkmark")
                                        .font(.system(size: 10, weight: .medium))
                                    Text(habit.name)
                                        .font(.system(size: 13))
                                }
                                .foregroundColor(.black)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                                .background(Color.white)
                                .overlay(
                                    Rectangle()
                                        .stroke(Color.black.opacity(0.15), lineWidth: 1)
                                )
                            }
                        }
                        
                        // Auto-sync indicator
                        Rectangle()
                            .fill(Color.black.opacity(0.1))
                            .frame(height: 1)
                            .padding(.vertical, 8)
                        
                        HStack(spacing: 10) {
                            Image(systemName: "arrow.triangle.2.circlepath")
                                .font(.system(size: 14))
                                .foregroundColor(.black)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Auto-Sync Enabled")
                                    .font(.system(size: 13, weight: .medium))
                                    .foregroundColor(.black)
                                Text("Data syncs automatically in the background")
                                    .font(.system(size: 11))
                                    .foregroundColor(.gray)
                            }
                            Spacer()
                        }
                        
                        if let syncInfo = lastBackgroundSyncInfo {
                            Text(syncInfo)
                                .font(.system(size: 11))
                                .foregroundColor(.gray)
                        }
                    }
                    .padding(16)
                    .background(Color.white)
                    .overlay(
                        Rectangle()
                            .stroke(Color.black.opacity(0.1), lineWidth: 1)
                    )
                    .padding(.horizontal, 20)
                    .padding(.top, 16)
                }
                
                Spacer(minLength: 48)
                
                // Footer actions
                VStack(spacing: 16) {
                    Button(action: { showingPermissions = true }) {
                        HStack(spacing: 6) {
                            Image(systemName: "gearshape")
                                .font(.system(size: 14))
                            Text("View Permissions")
                                .font(.system(size: 14))
                        }
                        .foregroundColor(.gray)
                    }
                    
                    Button(action: { showingDisconnectAlert = true }) {
                        HStack(spacing: 6) {
                            Image(systemName: "link.badge.minus")
                                .font(.system(size: 14))
                            Text("Disconnect Device")
                                .font(.system(size: 14))
                        }
                        .foregroundColor(.black.opacity(0.5))
                    }
                }
                .padding(.bottom, 40)
            }
        }
        .background(Color(.systemGray6))
        .sheet(isPresented: $showingPermissions) {
            PermissionsView()
        }
        .onChange(of: showingPermissions) { _, isPresented in
            if !isPresented {
                Task {
                    await appState.refreshHealthStatus()
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
            Task {
                await appState.refreshHealthStatus()
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: NSNotification.Name("BackgroundSyncCompleted"))) { notification in
            if let userInfo = notification.userInfo,
               let count = userInfo["count"] as? Int,
               let time = userInfo["time"] as? Date {
                let formatter = DateFormatter()
                formatter.timeStyle = .short
                lastBackgroundSyncInfo = "\(count) metrics synced at \(formatter.string(from: time))"
                
                Task {
                    await appState.fetchTrackedMetrics()
                }
            }
        }
        .alert("Disconnect Device?", isPresented: $showingDisconnectAlert) {
            Button("Cancel", role: .cancel) { }
            Button("Disconnect", role: .destructive) {
                Task {
                    await appState.disconnect()
                }
            }
        } message: {
            Text("This will stop syncing health data. You'll stay signed in but will need to reconnect to sync again.")
        }
    }
    
    // MARK: - Notice Card
    
    private func noticeCard(icon: String, title: String, message: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 16))
                .foregroundColor(.black)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(.black)
                Text(message)
                    .font(.system(size: 12))
                    .foregroundColor(.gray)
            }
            Spacer()
        }
        .padding(14)
        .background(Color.white)
        .overlay(
            Rectangle()
                .stroke(Color.black.opacity(0.1), lineWidth: 1)
        )
        .padding(.horizontal, 20)
        .padding(.top, 16)
    }
    
    private func syncNow() {
        Task {
            await appState.syncNow()
        }
    }
    
    private func refreshTrackedMetrics() {
        Task {
            await appState.fetchTrackedMetrics()
        }
    }
}

// MARK: - Flow Layout for metric tags

struct FlowLayout: Layout {
    var spacing: CGFloat = 8
    
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let containerWidth = proposal.width ?? .infinity
        var currentX: CGFloat = 0
        var currentY: CGFloat = 0
        var lineHeight: CGFloat = 0
        
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            
            if currentX + size.width > containerWidth && currentX > 0 {
                currentX = 0
                currentY += lineHeight + spacing
                lineHeight = 0
            }
            
            currentX += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }
        
        return CGSize(width: containerWidth, height: currentY + lineHeight)
    }
    
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var currentX: CGFloat = bounds.minX
        var currentY: CGFloat = bounds.minY
        var lineHeight: CGFloat = 0
        
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            
            if currentX + size.width > bounds.maxX && currentX > bounds.minX {
                currentX = bounds.minX
                currentY += lineHeight + spacing
                lineHeight = 0
            }
            
            subview.place(at: CGPoint(x: currentX, y: currentY), proposal: .unspecified)
            currentX += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }
    }
}

#Preview {
    let state = AppState()
    state.connectionStatus = .connected
    state.healthAccessStatus = .authorized
    
    return StatusView()
        .environmentObject(state)
}
