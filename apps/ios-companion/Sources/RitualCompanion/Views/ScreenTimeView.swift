import SwiftUI
import FamilyControls
import DeviceActivity
import RitualScreenTimeShared
import Clerk

struct ScreenTimeView: View {
    @State private var accessStatus: ScreenTimeAccessStatus = ScreenTimeManager.shared.checkAuthorizationStatus()
    @State private var snapshot: ScreenTimeSnapshot? = ScreenTimeManager.shared.loadLatestSnapshot()
    @State private var selection: FamilyActivitySelection = ScreenTimeManager.shared.loadSelection() ?? FamilyActivitySelection()
    @State private var isRequesting = false
    @State private var isSyncing = false
    @State private var showingPicker = false
    @State private var syncMessage: String?

    private var filter: DeviceActivityFilter {
        let start = Calendar.current.startOfDay(for: Date())
        let interval = DateInterval(start: start, end: Date())
        return DeviceActivityFilter(
            segment: .daily(during: interval),
            users: .all,
            devices: .init([.iPhone]),
            applications: selection.applicationTokens,
            categories: selection.categoryTokens,
            webDomains: selection.webDomainTokens
        )
    }

    private var hasSelection: Bool {
        !selection.applicationTokens.isEmpty ||
        !selection.categoryTokens.isEmpty ||
        !selection.webDomainTokens.isEmpty
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                ScreenTimeStatusCard(
                    title: "Screen Time Access",
                    value: accessStatus.rawValue.capitalized,
                    subtitle: "Ritual uses Apple's Screen Time APIs for on-device activity rollups."
                )

                if accessStatus == .approved {
                    if hasSelection {
                        DeviceActivityReport(.dailyTotal, filter: filter)
                            .frame(minHeight: 260)
                            .background(Color.white)
                            .overlay(
                                Rectangle()
                                    .stroke(Color.black.opacity(0.1), lineWidth: 1)
                            )
                    } else {
                        ScreenTimeStatusCard(
                            title: "Pick Apps & Websites",
                            value: "Not Set",
                            subtitle: "Choose which apps and websites Ritual should roll up."
                        )
                    }

                    Button(action: { showingPicker = true }) {
                        HStack(spacing: 8) {
                            Image(systemName: "square.stack.3d.down.right")
                            Text(hasSelection ? "Edit selection" : "Choose apps to track")
                                .font(.system(size: 15, weight: .medium))
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                        .background(Color.black)
                        .foregroundColor(.white)
                    }

                    if snapshot != nil {
                        Button(action: syncToRitual) {
                            HStack(spacing: 8) {
                                if isSyncing {
                                    ProgressView().scaleEffect(0.8)
                                } else {
                                    Image(systemName: "arrow.up.circle")
                                }
                                Text(isSyncing ? "Syncing..." : "Sync to Ritual")
                                    .font(.system(size: 15, weight: .medium))
                            }
                            .frame(maxWidth: .infinity)
                            .frame(height: 46)
                            .foregroundColor(.black)
                            .overlay(
                                Rectangle()
                                    .stroke(Color.black.opacity(0.3), lineWidth: 1)
                            )
                        }
                        .disabled(isSyncing)

                        if let syncMessage {
                            Text(syncMessage)
                                .font(.system(size: 12))
                                .foregroundColor(.gray)
                                .frame(maxWidth: .infinity)
                        }
                    }
                }

                if let snapshot {
                    ScreenTimeSelectionCard(
                        apps: snapshot.apps,
                        websites: snapshot.websites
                    )
                }

                if accessStatus != .approved {
                    Button(action: requestAccess) {
                        HStack(spacing: 8) {
                            if isRequesting {
                                ProgressView().scaleEffect(0.8)
                            }
                            Text(isRequesting ? "Requesting..." : "Request Screen Time Access")
                                .font(.system(size: 15, weight: .medium))
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                        .background(Color.black)
                        .foregroundColor(.white)
                    }
                    .disabled(isRequesting)
                }
            }
            .padding(20)
        }
        .background(Color(.systemBackground))
        .navigationTitle("Screen Time")
        .navigationBarTitleDisplayMode(.inline)
        .familyActivityPicker(isPresented: $showingPicker, selection: $selection)
        .onChange(of: selection) { _, newValue in
            print("🕒 ScreenTimeView: selection changed apps=\(newValue.applicationTokens.count) categories=\(newValue.categoryTokens.count) sites=\(newValue.webDomainTokens.count)")
            do {
                try ScreenTimeManager.shared.saveSelection(newValue)
                print("🕒 ScreenTimeView: selection persisted to App Group")
            } catch {
                print("🕒 ScreenTimeView: saveSelection error=\(error)")
            }
        }
        .onAppear {
            accessStatus = ScreenTimeManager.shared.checkAuthorizationStatus()
            snapshot = ScreenTimeManager.shared.loadLatestSnapshot()
            if let stored = ScreenTimeManager.shared.loadSelection() {
                selection = stored
                print("🕒 ScreenTimeView: loaded stored selection apps=\(stored.applicationTokens.count) categories=\(stored.categoryTokens.count) sites=\(stored.webDomainTokens.count)")
            } else {
                print("🕒 ScreenTimeView: no stored selection on disk")
            }
            print("🕒 ScreenTimeView: snapshot=\(snapshot.map { "\($0.totalSeconds)s, \($0.apps.count) apps" } ?? "nil") access=\(accessStatus.rawValue)")
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
            let fresh = ScreenTimeManager.shared.loadLatestSnapshot()
            print("🕒 ScreenTimeView: didBecomeActive reload snapshot=\(fresh.map { "total=\($0.totalSeconds)s apps=\($0.apps.count)" } ?? "nil")")
            snapshot = fresh
            accessStatus = ScreenTimeManager.shared.checkAuthorizationStatus()
        }
    }

    private func requestAccess() {
        isRequesting = true
        Task { @MainActor in
            defer { isRequesting = false }
            do {
                let status = try await ScreenTimeManager.shared.requestAuthorization()
                print("🕒 ScreenTimeView: requestAccess resolved status=\(status.rawValue)")
                accessStatus = status
            } catch {
                print("🕒 ScreenTimeView: requestAccess error=\(error)")
                accessStatus = .denied
            }
        }
    }

    private func syncToRitual() {
        isSyncing = true
        syncMessage = nil
        Task {
            defer { isSyncing = false }
            do {
                let maybeSession = await MainActor.run { Clerk.shared.session }
                guard let session = maybeSession else {
                    syncMessage = "Sign in to Ritual before syncing."
                    return
                }
                let tokenResult = try await session.getToken(.init(template: "backend"))
                guard let token = tokenResult?.jwt, !token.isEmpty else {
                    syncMessage = "Could not fetch Ritual auth token."
                    return
                }
                try await ScreenTimeSyncManager.shared.syncLatestSnapshot(authToken: token)
                let formatter = DateFormatter()
                formatter.timeStyle = .short
                syncMessage = "Synced at \(formatter.string(from: Date()))"
            } catch {
                syncMessage = "Sync failed: \(error.localizedDescription)"
            }
        }
    }
}

extension DeviceActivityReport.Context {
    static let dailyTotal = Self(ScreenTimeContexts.dailyTotal)
}

#Preview {
    NavigationStack {
        ScreenTimeView()
    }
}
