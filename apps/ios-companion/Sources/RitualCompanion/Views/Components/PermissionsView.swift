import SwiftUI

/// Sheet showing current permissions status - clean minimal design
struct PermissionsView: View {
    @EnvironmentObject var appState: AppState
    @Environment(\.dismiss) var dismiss
    @State private var isRequestingAccess = false
    
    var body: some View {
        NavigationStack {
            List {
                Section {
                    PermissionRow(
                        title: "Step Count",
                        description: "Track your daily steps",
                        icon: "figure.walk",
                        status: appState.healthAccessStatus
                    )
                    
                    PermissionRow(
                        title: "Active Energy",
                        description: "Calories burned during activity",
                        icon: "flame",
                        status: appState.healthAccessStatus
                    )
                    
                    PermissionRow(
                        title: "Distance",
                        description: "Walking + running distance",
                        icon: "figure.run",
                        status: appState.healthAccessStatus
                    )
                    
                    PermissionRow(
                        title: "Exercise Time",
                        description: "Apple Watch exercise minutes",
                        icon: "timer",
                        status: appState.healthAccessStatus
                    )
                } header: {
                    Text("Activity")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.gray)
                }
                
                Section {
                    PermissionRow(
                        title: "Heart Rate",
                        description: "Average daily heart rate",
                        icon: "heart",
                        status: appState.healthAccessStatus
                    )
                    
                    PermissionRow(
                        title: "Heart Rate Variability",
                        description: "HRV for recovery tracking",
                        icon: "waveform.path.ecg",
                        status: appState.healthAccessStatus
                    )
                    
                    PermissionRow(
                        title: "Resting Heart Rate",
                        description: "Your resting HR trend",
                        icon: "heart.circle",
                        status: appState.healthAccessStatus
                    )
                } header: {
                    Text("Heart")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.gray)
                }
                
                Section {
                    PermissionRow(
                        title: "Sleep Analysis",
                        description: "Sleep duration & stages",
                        icon: "bed.double",
                        status: appState.healthAccessStatus
                    )
                    
                    PermissionRow(
                        title: "Blood Oxygen",
                        description: "SpO2 measurements",
                        icon: "drop",
                        status: appState.healthAccessStatus
                    )
                    
                    PermissionRow(
                        title: "Respiratory Rate",
                        description: "Breathing rate tracking",
                        icon: "lungs",
                        status: appState.healthAccessStatus
                    )
                } header: {
                    Text("Sleep & Recovery")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.gray)
                }
                
                Section {
                    PermissionRow(
                        title: "Mindful Minutes",
                        description: "Meditation & breathing sessions",
                        icon: "brain.head.profile",
                        status: appState.healthAccessStatus
                    )
                    
                    PermissionRow(
                        title: "Workouts",
                        description: "All workout types",
                        icon: "figure.mixed.cardio",
                        status: appState.healthAccessStatus
                    )
                } header: {
                    Text("Mindfulness & Workouts")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.gray)
                } footer: {
                    Text("Ritual syncs these metrics to help you track your wellness habits alongside your other tracked behaviors.")
                        .font(.system(size: 12))
                        .foregroundColor(.gray)
                }
                
                Section {
                    if appState.healthAccessStatus != .authorized {
                        Button(action: requestHealthAccess) {
                            HStack(spacing: 10) {
                                if isRequestingAccess {
                                    ProgressView()
                                        .scaleEffect(0.8)
                                } else {
                                    Image(systemName: "heart.text.square")
                                        .font(.system(size: 16))
                                }
                                Text(isRequestingAccess ? "Requesting..." : "Request Health Access")
                                    .font(.system(size: 15))
                            }
                            .foregroundColor(.black)
                        }
                        .disabled(isRequestingAccess)
                    }
                    
                    Button(action: openHealthSettings) {
                        HStack(spacing: 10) {
                            Image(systemName: "gear")
                                .font(.system(size: 16))
                            Text("Open Health Settings")
                                .font(.system(size: 15))
                        }
                        .foregroundColor(.black)
                    }
                } header: {
                    Text("Actions")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.gray)
                } footer: {
                    if appState.healthAccessStatus == .denied {
                        Text("If you've already granted access in Health settings but still see 'Denied', try tapping 'Request Health Access' again or restart the app.")
                            .font(.system(size: 12))
                            .foregroundColor(.gray)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Permissions")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                    .foregroundColor(.black)
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
                Task {
                    await appState.refreshHealthStatus()
                }
            }
        }
    }
    
    private func requestHealthAccess() {
        isRequestingAccess = true
        Task {
            await appState.requestHealthAccess()
            await appState.refreshHealthStatus()
            await MainActor.run {
                isRequestingAccess = false
            }
        }
    }
    
    private func openHealthSettings() {
        if let url = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(url)
        }
    }
}

struct PermissionRow: View {
    let title: String
    let description: String
    let icon: String
    let status: HealthAccessStatus
    
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 18))
                .foregroundColor(.black.opacity(0.7))
                .frame(width: 28)
            
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundColor(.black)
                
                Text(description)
                    .font(.system(size: 12))
                    .foregroundColor(.gray)
            }
            
            Spacer()
            
            // Simple check or dash
            Image(systemName: status == .authorized ? "checkmark" : "minus")
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(status == .authorized ? .black : .gray)
        }
        .padding(.vertical, 4)
    }
}

#Preview {
    PermissionsView()
        .environmentObject(AppState())
}
