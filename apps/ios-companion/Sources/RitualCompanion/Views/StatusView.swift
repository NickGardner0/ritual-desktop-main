import SwiftUI
import Clerk
import UniformTypeIdentifiers

/// Main status view showing connection state and sync controls
struct StatusView: View {
    @EnvironmentObject var appState: AppState
    @EnvironmentObject var whoopService: WhoopBroadcastService
    @State private var showingPermissions = false
    @State private var showingDisconnectAlert = false
    @State private var lastBackgroundSyncInfo: String? = nil
    @State private var retryStartDate: Date = Calendar.current.date(byAdding: .day, value: -7, to: Date()) ?? Date()
    @State private var retryEndDate: Date = Date()
    @State private var exportStartDate: Date = Calendar.current.date(byAdding: .day, value: -7, to: Date()) ?? Date()
    @State private var exportEndDate: Date = Date()
    @State private var showingExportFolderPicker = false
    @State private var showRecoveryTools = false
    @State private var showExportTools = false
    @State private var showActivity = false
    
    // Access Clerk user directly
    private var clerkUser: User? {
        Clerk.shared.user
    }

    private let backgroundColor = CompanionPalette.background

    private var whoopCardTitle: String {
        if let connectedDevice = whoopService.connectedDevice,
           whoopService.permissionState == .connected || whoopService.permissionState == .receiving {
            return "Connected to \(connectedDevice.name)"
        }
        return "Connect a BLE heart-rate source"
    }

    private var whoopCardDetail: String {
        if whoopService.permissionState == .receiving, let bpm = whoopService.liveBPM {
            return "Receiving live heart rate at \(bpm) bpm."
        }
        if let connectedDevice = whoopService.connectedDevice {
            return "Connected to \(connectedDevice.name)."
        }
        return "Optional live heart-rate source."
    }

    private var whoopCardTint: Color {
        whoopService.permissionState.tint
    }

    private var whoopBadgeText: String {
        whoopService.permissionState.statusText
    }
    
    var body: some View {
        ScrollView {
            VStack(spacing: 28) {
                header
                summaryCard
                setupNotice
                sourcesSection
                footerActions
            }
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 20)
            .padding(.top, 32)
            .padding(.bottom, 36)
        }
        .background(backgroundColor.ignoresSafeArea())
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

    private var header: some View {
        VStack(spacing: 14) {
            RitualLogoMark()
                .frame(width: 30, height: 30)

            Text("Ritual Companion")
                .font(.system(size: 32, weight: .semibold))
                .kerning(-0.7)
                .foregroundColor(.black)
                .multilineTextAlignment(.center)

            Text("Apple Health sync and optional WHOOP live heart rate.")
                .font(.system(size: 17))
                .foregroundColor(CompanionPalette.secondaryText)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
    }

    private var summaryCard: some View {
        CompanionCard {
            VStack(spacing: 16) {
                VStack(spacing: 6) {
                    Text(overviewTitle)
                        .font(.system(size: 24, weight: .semibold))
                        .kerning(-0.5)
                        .foregroundColor(.black)
                        .multilineTextAlignment(.center)

                    Text(overviewSubtitle)
                        .font(.system(size: 16))
                        .foregroundColor(CompanionPalette.secondaryText)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if appState.hasTrackedMetrics {
                    CompanionPrimaryButton(
                        title: appState.isSyncing ? "Syncing..." : "Sync now",
                        systemImage: "arrow.triangle.2.circlepath",
                        isLoading: appState.isSyncing,
                        isDisabled: !appState.canSync,
                        action: syncNow
                    )
                }

                if appState.hasTrackedMetrics, let lastSyncTime = appState.lastSyncTime {
                    Text("Last sync \(RelativeDateTimeFormatter().localizedString(for: lastSyncTime, relativeTo: Date()))")
                        .font(.system(size: 12))
                        .foregroundColor(CompanionPalette.secondaryText)
                        .multilineTextAlignment(.center)
                } else if appState.hasTrackedMetrics, let syncInfo = lastBackgroundSyncInfo {
                    Text(syncInfo)
                        .font(.system(size: 12))
                        .foregroundColor(CompanionPalette.secondaryText)
                        .multilineTextAlignment(.center)
                }
            }
            .frame(maxWidth: .infinity)
        }
    }

    @ViewBuilder
    private var setupNotice: some View {
        if !appState.hasHealthAccess {
            noticeCard(
                icon: "heart.slash.fill",
                title: "Grant Apple Health access",
                message: "Finish the on-device permission step to start syncing."
            )
            .onTapGesture { showingPermissions = true }
        }
    }

    private var sourcesSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            CompanionSectionTitle("Sources")

            CompanionGroupedCard {
                Button(action: { showingPermissions = true }) {
                    CompanionSourceRow(
                        icon: "heart.text.square.fill",
                        tint: .black,
                        title: "Apple Health",
                        detail: healthCardDetail,
                        badgeText: nil
                    )
                }
                .buttonStyle(.plain)

                Divider().padding(.leading, 74)

                NavigationLink(destination: WhoopConnectView()) {
                    CompanionSourceRow(
                        icon: "bolt.heart.fill",
                        tint: .black,
                        title: "WHOOP broadcast",
                        detail: whoopCardDetail,
                        badgeText: nil
                    )
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var toolsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            CompanionSectionTitle("Tools")

            CompanionCard {
                VStack(spacing: 18) {
                    DisclosureGroup(isExpanded: $showRecoveryTools) {
                        VStack(alignment: .leading, spacing: 14) {
                            Text(appState.retryQueueDescription)
                                .font(.system(size: 14))
                                .foregroundColor(CompanionPalette.secondaryText)

                            if !appState.latestFailedDays.isEmpty {
                                CompanionSecondaryButton(
                                    title: "Retry \(appState.latestFailedDays.count) failed day(s)",
                                    action: { retryFailedDays(appState.latestFailedDays) }
                                )
                            }

                            HStack(spacing: 8) {
                                DatePicker("Start", selection: $retryStartDate, displayedComponents: .date)
                                    .labelsHidden()
                                    .datePickerStyle(.compact)
                                Text("to")
                                    .font(.system(size: 12))
                                    .foregroundColor(CompanionPalette.secondaryText)
                                DatePicker("End", selection: $retryEndDate, displayedComponents: .date)
                                    .labelsHidden()
                                    .datePickerStyle(.compact)
                            }

                            CompanionSecondaryButton(
                                title: "Retry date range",
                                action: retryDateRange
                            )

                            if let summary = appState.dateRangeRetrySummary, !summary.isEmpty {
                                Text(summary)
                                    .font(.system(size: 12))
                                    .foregroundColor(CompanionPalette.secondaryText)
                            }
                        }
                        .padding(.top, 14)
                    } label: {
                        toolLabel(title: "Recovery", detail: syncQueueCardTitle)
                    }

                    Divider()

                    DisclosureGroup(isExpanded: $showExportTools) {
                        VStack(alignment: .leading, spacing: 14) {
                            HStack {
                                Text("Destination")
                                    .font(.system(size: 13, weight: .medium))
                                    .foregroundColor(CompanionPalette.secondaryText)
                                Spacer()
                                Button("Select folder") {
                                    showingExportFolderPicker = true
                                }
                                .font(.system(size: 13, weight: .medium))
                            }

                            Text(appState.exportDestinationName)
                                .font(.system(size: 14))
                                .foregroundColor(.black)

                            Picker("Format", selection: exportFormatBinding) {
                                ForEach(LocalExportFormat.allCases, id: \.self) { format in
                                    Text(format.displayName).tag(format)
                                }
                            }
                            .pickerStyle(.segmented)

                            Picker("Write Mode", selection: exportWriteModeBinding) {
                                ForEach(LocalExportWriteMode.allCases, id: \.self) { mode in
                                    Text(mode.displayName).tag(mode)
                                }
                            }
                            .pickerStyle(.segmented)

                            TextField("{date}", text: exportFilenameTemplateBinding)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled(true)
                                .padding(.horizontal, 16)
                                .frame(height: 46)
                                .background(CompanionPalette.elevatedSurface)
                                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                                        .stroke(CompanionPalette.separator, lineWidth: 1)
                                )

                            TextField("Folder structure (optional)", text: exportFolderStructureBinding)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled(true)
                                .padding(.horizontal, 16)
                                .frame(height: 46)
                                .background(CompanionPalette.elevatedSurface)
                                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                                        .stroke(CompanionPalette.separator, lineWidth: 1)
                                )

                            HStack(spacing: 8) {
                                DatePicker("Export Start", selection: $exportStartDate, displayedComponents: .date)
                                    .labelsHidden()
                                    .datePickerStyle(.compact)
                                Text("to")
                                    .font(.system(size: 12))
                                    .foregroundColor(CompanionPalette.secondaryText)
                                DatePicker("Export End", selection: $exportEndDate, displayedComponents: .date)
                                    .labelsHidden()
                                    .datePickerStyle(.compact)
                            }

                            CompanionPrimaryButton(
                                title: appState.isExporting ? "Exporting..." : "Export date range",
                                systemImage: "square.and.arrow.down",
                                isLoading: appState.isExporting,
                                isDisabled: !appState.canExport,
                                action: exportDateRange
                            )

                            if let status = appState.exportStatusMessage, !status.isEmpty {
                                Text(status)
                                    .font(.system(size: 12))
                                    .foregroundColor(CompanionPalette.secondaryText)
                            }
                        }
                        .padding(.top, 14)
                    } label: {
                        toolLabel(title: "Local export", detail: appState.exportDestinationName)
                    }

                    Divider()

                    DisclosureGroup(isExpanded: $showActivity) {
                        VStack(alignment: .leading, spacing: 18) {
                            if !appState.syncHistory.isEmpty {
                                VStack(alignment: .leading, spacing: 12) {
                                    Text("Recent syncs")
                                        .font(.system(size: 13, weight: .semibold))
                                    ForEach(Array(appState.syncHistory.prefix(3)), id: \.id) { entry in
                                        VStack(alignment: .leading, spacing: 4) {
                                            Text(syncHistoryTitle(for: entry))
                                                .font(.system(size: 14, weight: .medium))
                                            Text(syncHistoryDetail(for: entry))
                                                .font(.system(size: 12))
                                                .foregroundColor(CompanionPalette.secondaryText)
                                        }
                                    }
                                }
                            }

                            if !appState.exportHistory.isEmpty {
                                VStack(alignment: .leading, spacing: 12) {
                                    HStack {
                                        Text("Recent exports")
                                            .font(.system(size: 13, weight: .semibold))
                                        Spacer()
                                        Button("Clear") {
                                            appState.clearExportHistory()
                                        }
                                        .font(.system(size: 12, weight: .medium))
                                    }

                                    ForEach(Array(appState.exportHistory.prefix(3)), id: \.id) { entry in
                                        VStack(alignment: .leading, spacing: 4) {
                                            Text(entry.summary)
                                                .font(.system(size: 14, weight: .medium))
                                            Text("Days \(entry.successDays)/\(entry.attemptedDays) · Metrics \(entry.exportedMetricCount)")
                                                .font(.system(size: 12))
                                                .foregroundColor(CompanionPalette.secondaryText)
                                        }
                                    }
                                }
                            }
                        }
                        .padding(.top, 14)
                    } label: {
                        toolLabel(title: "Recent activity", detail: activitySummary)
                    }
                }
            }
        }
    }

    private var footerActions: some View {
        VStack(spacing: 12) {
            CompanionSecondaryButton(title: "Disconnect device", style: .destructive) {
                showingDisconnectAlert = true
            }
        }
        .frame(maxWidth: 360)
        .frame(maxWidth: .infinity)
    }

    private func toolLabel(title: String, detail: String) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.black)

                Text(detail)
                    .font(.system(size: 13))
                    .foregroundColor(CompanionPalette.secondaryText)
                    .lineLimit(2)
            }

            Spacer()
        }
    }

    private var activitySummary: String {
        let syncCount = appState.syncHistory.count
        let exportCount = appState.exportHistory.count
        if syncCount == 0 && exportCount == 0 {
            return "No recent sync or export history."
        }
        return "\(syncCount) syncs · \(exportCount) exports"
    }

    private var overviewTitle: String {
        if appState.canSync {
            return "Ready to sync"
        }
        if !appState.hasHealthAccess {
            return "Allow Apple Health"
        }
        if !appState.hasTrackedMetrics {
            return "Choose desktop metrics"
        }
        return "Connect this iPhone"
    }

    private var overviewSubtitle: String {
        if appState.canSync {
            return "Sync Apple Health to Ritual whenever you want."
        }
        if !appState.hasHealthAccess {
            return "Approve Apple Health access to finish setup."
        }
        if !appState.hasTrackedMetrics {
            return "Select the metrics you want to sync in the desktop app."
        }
        return "Sign in and connect this iPhone to Ritual."
    }

    private var healthCardTitle: String {
        appState.hasHealthAccess ? "Apple Health connected" : "Apple Health needs permission"
    }

    private var healthCardDetail: String {
        if appState.hasHealthAccess {
            return "Connected."
        }
        return "Permission needed."
    }

    private var syncQueueCardTitle: String {
        if appState.queueTelemetry.pendingCount == 0 {
            return "No pending retries"
        }
        return "\(appState.queueTelemetry.pendingCount) payloads waiting"
    }

    private var syncQueueCardDetail: String {
        if appState.queueTelemetry.pendingCount == 0 {
            return "Queue is clear."
        }
        return appState.retryQueueDescription
    }
    
    // MARK: - Notice Card
    
    private func noticeCard(icon: String, title: String, message: String) -> some View {
        CompanionCard {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.black)

                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(.black)
                    Text(message)
                        .font(.system(size: 13))
                        .foregroundColor(CompanionPalette.secondaryText)
                }

                Spacer()
            }
        }
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
    let whoopService = WhoopBroadcastService()
    state.connectionStatus = .connected
    state.healthAccessStatus = .authorized
    
    return StatusView()
        .environmentObject(state)
        .environmentObject(whoopService)
}
