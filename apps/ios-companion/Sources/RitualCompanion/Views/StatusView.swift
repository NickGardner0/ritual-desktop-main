import SwiftUI
import Clerk
import UniformTypeIdentifiers

/// Main status view showing connection state and sync controls
struct StatusView: View {
    @EnvironmentObject var appState: AppState
    @State private var showingPermissions = false
    @State private var showingDisconnectAlert = false
    @State private var lastBackgroundSyncInfo: String? = nil
    @State private var retryStartDate: Date = Calendar.current.date(byAdding: .day, value: -7, to: Date()) ?? Date()
    @State private var retryEndDate: Date = Date()
    @State private var exportStartDate: Date = Calendar.current.date(byAdding: .day, value: -7, to: Date()) ?? Date()
    @State private var exportEndDate: Date = Date()
    @State private var showingExportFolderPicker = false
    
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
                    // Sphere logo icon
                    RitualLogoShape()
                        .fill(Color.black)
                        .frame(width: 40, height: 40)
                    
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

                if appState.isConnected {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Retry Queue")
                            .font(.system(size: 13))
                            .foregroundColor(.gray)

                        HStack(spacing: 10) {
                            Image(systemName: appState.queueTelemetry.pendingCount > 0 ? "tray.full" : "tray")
                                .font(.system(size: 14))
                                .foregroundColor(.black)
                            Text(appState.retryQueueDescription)
                                .font(.system(size: 12))
                                .foregroundColor(.black)
                            Spacer()
                        }

                        if !appState.latestFailedDays.isEmpty {
                            Button(action: { retryFailedDays(appState.latestFailedDays) }) {
                                HStack(spacing: 6) {
                                    Image(systemName: "arrow.clockwise")
                                        .font(.system(size: 12))
                                    Text("Retry \(appState.latestFailedDays.count) failed day(s)")
                                        .font(.system(size: 12, weight: .medium))
                                }
                                .foregroundColor(.black)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 8)
                                .overlay(
                                    Rectangle()
                                        .stroke(Color.black.opacity(0.2), lineWidth: 1)
                                )
                            }
                            .disabled(appState.isSyncing)
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

                if appState.isConnected {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Backfill & Recovery")
                            .font(.system(size: 13))
                            .foregroundColor(.gray)

                        HStack(spacing: 8) {
                            DatePicker("Start", selection: $retryStartDate, displayedComponents: .date)
                                .labelsHidden()
                                .datePickerStyle(.compact)
                            Text("to")
                                .font(.system(size: 11))
                                .foregroundColor(.gray)
                            DatePicker("End", selection: $retryEndDate, displayedComponents: .date)
                                .labelsHidden()
                                .datePickerStyle(.compact)
                        }

                        Button(action: retryDateRange) {
                            HStack(spacing: 6) {
                                Image(systemName: "calendar.badge.clock")
                                    .font(.system(size: 12))
                                Text("Retry Date Range")
                                    .font(.system(size: 12, weight: .medium))
                            }
                            .foregroundColor(.black)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 8)
                            .overlay(
                                Rectangle()
                                    .stroke(Color.black.opacity(0.2), lineWidth: 1)
                            )
                        }
                        .disabled(appState.isSyncing)

                        if let summary = appState.dateRangeRetrySummary, !summary.isEmpty {
                            Text(summary)
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

                if appState.isConnected {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text("Local Export")
                                .font(.system(size: 13))
                                .foregroundColor(.gray)
                            Spacer()
                            Button(action: { showingExportFolderPicker = true }) {
                                Text("Select Folder")
                                    .font(.system(size: 11, weight: .medium))
                                    .foregroundColor(.black)
                            }
                        }

                        Text("Destination: \(appState.exportDestinationName)")
                            .font(.system(size: 12))
                            .foregroundColor(.black)

                        HStack(spacing: 8) {
                            Text("Format")
                                .font(.system(size: 12))
                                .foregroundColor(.gray)
                            Picker("Format", selection: exportFormatBinding) {
                                ForEach(LocalExportFormat.allCases, id: \.self) { format in
                                    Text(format.displayName).tag(format)
                                }
                            }
                            .pickerStyle(.segmented)
                        }

                        HStack(spacing: 8) {
                            Text("Write")
                                .font(.system(size: 12))
                                .foregroundColor(.gray)
                            Picker("Write Mode", selection: exportWriteModeBinding) {
                                ForEach(LocalExportWriteMode.allCases, id: \.self) { mode in
                                    Text(mode.displayName).tag(mode)
                                }
                            }
                            .pickerStyle(.segmented)
                        }

                        VStack(alignment: .leading, spacing: 6) {
                            Text("Filename Template")
                                .font(.system(size: 11))
                                .foregroundColor(.gray)
                            TextField("{date}", text: exportFilenameTemplateBinding)
                                .font(.system(size: 12))
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled(true)
                                .padding(8)
                                .overlay(
                                    Rectangle().stroke(Color.black.opacity(0.15), lineWidth: 1)
                                )
                        }

                        VStack(alignment: .leading, spacing: 6) {
                            Text("Folder Structure (optional)")
                                .font(.system(size: 11))
                                .foregroundColor(.gray)
                            TextField("e.g. {year}/{month}", text: exportFolderStructureBinding)
                                .font(.system(size: 12))
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled(true)
                                .padding(8)
                                .overlay(
                                    Rectangle().stroke(Color.black.opacity(0.15), lineWidth: 1)
                                )
                        }

                        HStack(spacing: 8) {
                            DatePicker("Export Start", selection: $exportStartDate, displayedComponents: .date)
                                .labelsHidden()
                                .datePickerStyle(.compact)
                            Text("to")
                                .font(.system(size: 11))
                                .foregroundColor(.gray)
                            DatePicker("Export End", selection: $exportEndDate, displayedComponents: .date)
                                .labelsHidden()
                                .datePickerStyle(.compact)
                        }

                        HStack(spacing: 10) {
                            Button(action: exportDateRange) {
                                HStack(spacing: 6) {
                                    if appState.isExporting {
                                        ProgressView()
                                            .progressViewStyle(CircularProgressViewStyle(tint: .black))
                                            .scaleEffect(0.7)
                                    } else {
                                        Image(systemName: "square.and.arrow.down")
                                            .font(.system(size: 12))
                                    }
                                    Text(appState.isExporting ? "Exporting..." : "Export Date Range")
                                        .font(.system(size: 12, weight: .medium))
                                }
                                .foregroundColor(.black)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 8)
                                .overlay(
                                    Rectangle()
                                        .stroke(Color.black.opacity(0.2), lineWidth: 1)
                                )
                            }
                            .disabled(!appState.canExport)

                            Button(action: requestNotificationPermissions) {
                                Text(appState.notificationsEnabled ? "Notifications On" : "Enable Notifications")
                                    .font(.system(size: 11))
                                    .foregroundColor(.black)
                            }
                        }

                        if let status = appState.exportStatusMessage, !status.isEmpty {
                            Text(status)
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

                if !appState.syncHistory.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Recent Syncs")
                            .font(.system(size: 13))
                            .foregroundColor(.gray)

                        ForEach(Array(appState.syncHistory.prefix(5)), id: \.id) { entry in
                            VStack(alignment: .leading, spacing: 6) {
                                HStack(spacing: 8) {
                                    Image(systemName: entry.succeeded ? "checkmark.circle.fill" : "xmark.circle.fill")
                                        .font(.system(size: 12))
                                        .foregroundColor(entry.succeeded ? .green : .red)
                                    Text(syncHistoryTitle(for: entry))
                                        .font(.system(size: 12, weight: .medium))
                                        .foregroundColor(.black)
                                    Spacer()
                                }

                                Text(syncHistoryDetail(for: entry))
                                    .font(.system(size: 11))
                                    .foregroundColor(.gray)

                                if !entry.failedDays.isEmpty {
                                    Button(action: { retryFailedDays(entry.failedDays) }) {
                                        Text("Retry \(entry.failedDays.count) failed day(s)")
                                            .font(.system(size: 11, weight: .medium))
                                            .foregroundColor(.black)
                                    }
                                    .disabled(appState.isSyncing)
                                }
                            }
                            .padding(.vertical, 6)
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

                if !appState.exportHistory.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text("Recent Exports")
                                .font(.system(size: 13))
                                .foregroundColor(.gray)
                            Spacer()
                            Button(action: appState.clearExportHistory) {
                                Text("Clear")
                                    .font(.system(size: 11))
                                    .foregroundColor(.black)
                            }
                        }

                        ForEach(Array(appState.exportHistory.prefix(5)), id: \.id) { entry in
                            VStack(alignment: .leading, spacing: 6) {
                                HStack(spacing: 8) {
                                    Image(systemName: entry.isSuccess ? "checkmark.circle.fill" : "xmark.circle.fill")
                                        .font(.system(size: 12))
                                        .foregroundColor(entry.isSuccess ? .green : .red)
                                    Text(entry.summary)
                                        .font(.system(size: 12, weight: .medium))
                                        .foregroundColor(.black)
                                    Spacer()
                                    Text(entry.format.displayName)
                                        .font(.system(size: 10))
                                        .foregroundColor(.gray)
                                }

                                Text("Days \(entry.successDays)/\(entry.attemptedDays) | Metrics \(entry.exportedMetricCount)")
                                    .font(.system(size: 11))
                                    .foregroundColor(.gray)

                                if !entry.failedDays.isEmpty {
                                    Button(action: { retryExportHistory(entry) }) {
                                        Text("Retry \(entry.failedDays.count) failed day(s)")
                                            .font(.system(size: 11, weight: .medium))
                                            .foregroundColor(.black)
                                    }
                                }
                            }
                            .padding(.vertical, 6)
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

                VStack(alignment: .leading, spacing: 12) {
                    Text("Local Pairing (Future)")
                        .font(.system(size: 13))
                        .foregroundColor(.gray)

                    Text("Any future iPhone-to-device local sync request must be explicitly approved before data is shared.")
                        .font(.system(size: 12))
                        .foregroundColor(.black)

                    Text("Trusted peers: \(appState.trustedPeers.count)")
                        .font(.system(size: 11))
                        .foregroundColor(.gray)

                    #if DEBUG
                    Button(action: simulatePairingRequest) {
                        Text("Simulate Pair Request")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(.black)
                    }
                    #endif
                }
                .padding(16)
                .background(Color.white)
                .overlay(
                    Rectangle()
                        .stroke(Color.black.opacity(0.1), lineWidth: 1)
                )
                .padding(.horizontal, 20)
                .padding(.top, 16)
                
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
                            Image(systemName: "minus.circle")
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
        .onAppear {
            appState.refreshSyncDiagnostics()
        }
        .sheet(isPresented: $showingPermissions) {
            PermissionsView()
        }
        .sheet(item: $appState.pendingPairingRequest) { request in
            pairingConfirmationSheet(for: request)
        }
        .fileImporter(
            isPresented: $showingExportFolderPicker,
            allowedContentTypes: [.folder],
            allowsMultipleSelection: false
        ) { result in
            switch result {
            case .success(let urls):
                if let url = urls.first {
                    appState.selectExportDestination(url)
                }
            case .failure(let error):
                appState.errorMessage = "Folder selection failed: \(error.localizedDescription)"
                appState.showError = true
            }
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
                await MainActor.run {
                    appState.refreshSyncDiagnostics()
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: NSNotification.Name("BackgroundSyncCompleted"))) { notification in
            if let userInfo = notification.userInfo,
               let time = userInfo["time"] as? Date {
                let addedCount = userInfo["addedCount"] as? Int
                let deletedCount = userInfo["deletedCount"] as? Int
                let legacyCount = userInfo["count"] as? Int
                let displayCount = addedCount ?? legacyCount ?? 0

                let formatter = DateFormatter()
                formatter.timeStyle = .short

                if let deletedCount {
                    lastBackgroundSyncInfo = "\(displayCount) added, \(deletedCount) deleted at \(formatter.string(from: time))"
                } else {
                    lastBackgroundSyncInfo = "\(displayCount) metrics synced at \(formatter.string(from: time))"
                }
                
                Task {
                    await appState.fetchTrackedMetrics()
                    await MainActor.run {
                        appState.refreshSyncDiagnostics()
                    }
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
            Text("This will stop syncing health data and sign you out on this iPhone.")
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

    private func retryFailedDays(_ dayKeys: [String]) {
        Task {
            await appState.retryFailedDays(dayKeys)
        }
    }

    private func retryDateRange() {
        Task {
            await appState.retryDateRange(startDate: retryStartDate, endDate: retryEndDate)
        }
    }

    private func exportDateRange() {
        Task {
            await appState.exportDateRange(startDate: exportStartDate, endDate: exportEndDate)
        }
    }

    private func retryExportHistory(_ entry: LocalExportHistoryEntry) {
        Task {
            await appState.exportFailedDays(entry.failedDays)
        }
    }

    private func requestNotificationPermissions() {
        Task {
            await appState.requestSyncNotificationPermissions()
        }
    }

    private var exportFormatBinding: Binding<LocalExportFormat> {
        Binding(
            get: { appState.exportSettings.format },
            set: { newValue in
                appState.updateExportSettings { $0.format = newValue }
            }
        )
    }

    private var exportWriteModeBinding: Binding<LocalExportWriteMode> {
        Binding(
            get: { appState.exportSettings.writeMode },
            set: { newValue in
                appState.updateExportSettings { $0.writeMode = newValue }
            }
        )
    }

    private var exportFilenameTemplateBinding: Binding<String> {
        Binding(
            get: { appState.exportSettings.filenameTemplate },
            set: { newValue in
                appState.updateExportSettings { $0.filenameTemplate = newValue }
            }
        )
    }

    private var exportFolderStructureBinding: Binding<String> {
        Binding(
            get: { appState.exportSettings.folderStructure },
            set: { newValue in
                appState.updateExportSettings { $0.folderStructure = newValue }
            }
        )
    }

    private func syncHistoryTitle(for entry: BackgroundSyncManagerV2.SyncHistoryEntry) -> String {
        let mode = entry.isRetry ? "Retry" : (entry.isBackground ? "Background" : "Manual")
        return "\(mode) | \(entry.addedCount) metric(s)"
    }

    private func syncHistoryDetail(for entry: BackgroundSyncManagerV2.SyncHistoryEntry) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        let finished = formatter.localizedString(for: entry.finishedAt, relativeTo: Date())

        if let error = entry.errorMessage, !error.isEmpty {
            return "\(finished) | \(error)"
        }

        if entry.failedBatchCount > 0 {
            return "\(finished) | \(entry.failedBatchCount) failed batch(es), \(entry.queuedBatchCount) queued"
        }

        return "\(finished) | \(entry.metricTypes.count) metric type(s)"
    }

    private func pairingConfirmationSheet(for request: PeerPairingRequest) -> some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("Pair with \(request.peerName)?")
                    .font(.system(size: 22, weight: .semibold))

                Text("Only approve if you initiated this connection on a trusted local network.")
                    .font(.system(size: 14))
                    .foregroundColor(.gray)

                VStack(alignment: .leading, spacing: 6) {
                    Text("Peer Fingerprint")
                        .font(.system(size: 12))
                        .foregroundColor(.gray)
                    Text(request.peerFingerprint)
                        .font(.system(size: 12, weight: .medium, design: .monospaced))
                        .foregroundColor(.black)
                }
                .padding(12)
                .background(Color(.systemGray6))
                .overlay(
                    Rectangle()
                        .stroke(Color.black.opacity(0.1), lineWidth: 1)
                )

                Spacer()

                VStack(spacing: 10) {
                    Button(action: {
                        appState.confirmPendingPairing()
                    }) {
                        Text("Approve Pairing")
                            .font(.system(size: 15, weight: .medium))
                            .frame(maxWidth: .infinity)
                            .frame(height: 48)
                            .background(Color.black)
                            .foregroundColor(.white)
                    }

                    Button(action: {
                        appState.declinePendingPairing()
                    }) {
                        Text("Decline")
                            .font(.system(size: 15, weight: .medium))
                            .frame(maxWidth: .infinity)
                            .frame(height: 44)
                            .foregroundColor(.black)
                    }
                }
            }
            .padding(20)
            .navigationTitle("Pairing Request")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    #if DEBUG
    private func simulatePairingRequest() {
        appState.receivePairingRequest(
            peerName: "Example MacBook",
            peerFingerprint: "F6:17:32:AA:8C:90:1D:44"
        )
    }
    #endif
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
