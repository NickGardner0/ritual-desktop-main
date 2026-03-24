import SwiftUI
import RitualScreenTimeShared

struct ScreenTimeView: View {
    @State private var accessStatus: ScreenTimeAccessStatus = ScreenTimeManager.shared.checkAuthorizationStatus()
    @State private var snapshot: ScreenTimeSnapshot? = ScreenTimeManager.shared.loadLatestSnapshot()
    @State private var isRequesting = false

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                ScreenTimeStatusCard(
                    title: "Screen Time Access",
                    value: accessStatus.rawValue.capitalized,
                    subtitle: "Ritual uses Apple’s Screen Time APIs for on-device activity rollups."
                )

                if let snapshot {
                    ScreenTimeStatusCard(
                        title: "Today",
                        value: durationString(seconds: snapshot.totalSeconds),
                        subtitle: "From \(snapshot.day) in \(snapshot.timezone)"
                    )

                    ScreenTimeSelectionCard(
                        apps: snapshot.apps,
                        websites: snapshot.websites
                    )
                } else {
                    ScreenTimeStatusCard(
                        title: "No Snapshot Yet",
                        value: "Waiting",
                        subtitle: "Launch the Screen Time report extension to generate app and website rollups."
                    )
                }

                Button(action: requestAccess) {
                    HStack(spacing: 8) {
                        if isRequesting {
                            ProgressView()
                                .scaleEffect(0.8)
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
            .padding(20)
        }
        .background(Color(.systemBackground))
        .navigationTitle("Screen Time")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            snapshot = ScreenTimeManager.shared.loadLatestSnapshot()
            accessStatus = ScreenTimeManager.shared.checkAuthorizationStatus()
        }
    }

    private func requestAccess() {
        isRequesting = true
        Task {
            defer { isRequesting = false }
            do {
                accessStatus = try await ScreenTimeManager.shared.requestAuthorization()
            } catch {
                accessStatus = .denied
            }
        }
    }

    private func durationString(seconds: Int) -> String {
        let hours = seconds / 3600
        let minutes = (seconds % 3600) / 60
        if hours > 0 {
            return "\(hours)h \(minutes)m"
        }
        return "\(minutes)m"
    }
}

#Preview {
    NavigationStack {
        ScreenTimeView()
    }
}
