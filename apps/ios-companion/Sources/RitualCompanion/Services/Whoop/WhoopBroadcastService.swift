import Clerk
import Foundation

@MainActor
final class WhoopBroadcastService: ObservableObject {
    @Published private(set) var devices: [BLEDevice] = []
    @Published private(set) var permissionState: BLEPermissionState = .unavailable
    @Published private(set) var liveBPM: Int?
    @Published private(set) var lastSampleAt: Date?
    @Published private(set) var recentSamples: [HeartRateSample] = []
    @Published private(set) var currentSession: HeartRateSession?
    @Published private(set) var connectedDevice: BLEDevice?

    private let bleManager = BLEManager()
    private let store = BiometricsLocalStore()
    private let syncService = BiometricsSyncService()
    private lazy var uploadQueue = BiometricsUploadQueue(store: store, syncService: syncService)
    private let preferredDeviceKey = "WhoopBroadcastService.preferredDeviceID"

    private var lastDisplayBPM: Double?
    private var lastMeasurementAt: Date?
    private var preferredDeviceID: UUID?
    private var shouldAutoReconnect = false
    private var manualDisconnectRequested = false

    init() {
        preferredDeviceID = Self.loadPreferredDeviceID(forKey: preferredDeviceKey)
        shouldAutoReconnect = preferredDeviceID != nil
        bindBLECallbacks()
        Task { [weak self] in
            guard let self else { return }
            self.currentSession = await self.store.latestSession()
            self.recentSamples = await self.store.fetchRecentSamples(minutes: 30)
            self.restoreConnectedDeviceFromSession()
        }
    }

    var isConnectedToPreferredDevice: Bool {
        guard let preferredDeviceID else { return false }
        return connectedDevice?.id == preferredDeviceID
    }

    func startScan(autoReconnect: Bool = false) {
        if autoReconnect {
            shouldAutoReconnect = preferredDeviceID != nil
        }
        bleManager.startScan()
    }

    func stopScan() {
        shouldAutoReconnect = false
        bleManager.stopScan()
    }

    func connect(to device: BLEDevice) {
        preferredDeviceID = device.id
        Self.persistPreferredDeviceID(device.id, forKey: preferredDeviceKey)
        shouldAutoReconnect = false
        manualDisconnectRequested = false
        connectedDevice = device
        bleManager.connect(to: device)
    }

    func disconnect() {
        shouldAutoReconnect = false
        manualDisconnectRequested = true
        bleManager.disconnectCurrentDevice()
        Task {
            await self.flushAndCloseCurrentSession(status: "disconnected")
        }
    }

    func clearLocalData() {
        Task {
            self.shouldAutoReconnect = false
            self.manualDisconnectRequested = true
            self.connectedDevice = nil
            self.preferredDeviceID = nil
            Self.clearPreferredDeviceID(forKey: self.preferredDeviceKey)
            self.bleManager.disconnectCurrentDevice()
            await self.flushAndCloseCurrentSession(status: "cleared")
            await store.clearAllHeartRateData()
            self.recentSamples = []
            self.liveBPM = nil
            self.lastSampleAt = nil
            self.currentSession = nil
        }
    }

    func handleAppDidBecomeActive() {
        if permissionState == .ready || permissionState == .disconnected {
            attemptAutoReconnectIfNeeded()
        }
    }

    func handleAppDidEnterBackground() {
        Task {
            await self.uploadQueue.flush()
        }
    }

    private func bindBLECallbacks() {
        bleManager.onDevicesUpdated = { [weak self] devices in
            guard let self else { return }
            self.devices = WhoopDeviceHeuristics.prioritize(devices, lastConnectedID: self.preferredDeviceID)
            self.attemptAutoReconnectIfNeeded()
        }

        bleManager.onStateUpdated = { [weak self] state in
            guard let self else { return }
            self.permissionState = state
            switch state {
            case .ready:
                self.attemptAutoReconnectIfNeeded()
            case .connected, .receiving:
                if self.connectedDevice == nil, let preferredDeviceID = self.preferredDeviceID {
                    self.connectedDevice = self.devices.first(where: { $0.id == preferredDeviceID })
                        ?? self.currentSession.flatMap(Self.deviceFromSession)
                }
            case .disconnected:
                let disconnectedDevice = self.connectedDevice
                let shouldReconnect = !self.manualDisconnectRequested && self.preferredDeviceID != nil
                self.manualDisconnectRequested = false
                self.connectedDevice = nil
                self.liveBPM = nil
                Task {
                    await self.flushAndCloseCurrentSession(status: "disconnected")
                    await MainActor.run {
                        if disconnectedDevice != nil && shouldReconnect {
                            self.shouldAutoReconnect = true
                            self.attemptAutoReconnectIfNeeded()
                        }
                    }
                }
            default:
                break
            }
        }

        bleManager.onMeasurement = { [weak self] measurement, device in
            guard let self else { return }
            Task {
                await self.handleMeasurement(measurement, from: device)
            }
        }
    }

    private func handleMeasurement(_ measurement: BLEHeartRateMeasurement, from device: BLEDevice) async {
        guard let userID = Clerk.shared.user?.id else { return }
        let session = await ensureSession(for: device, userID: userID)

        let bpmDisplay = smoothedDisplayValue(for: measurement)
        let sample = HeartRateSample(
            id: UUID(),
            userId: userID,
            sourceType: .whoopBLEIOS,
            sourceDeviceId: device.id.uuidString,
            sessionId: session.id,
            bpmRaw: measurement.bpm,
            bpmDisplay: bpmDisplay,
            qualityScore: measurement.contactDetected == false ? 0.25 : 0.9,
            isOutlier: isOutlier(measurement),
            rrIntervalsMs: measurement.rrIntervalsMs.isEmpty ? nil : measurement.rrIntervalsMs,
            contactDetected: measurement.contactDetected,
            receivedAt: measurement.receivedAt,
            createdAt: Date(),
            syncState: .pending
        )

        await store.insertHeartRateSample(sample)
        let recent = await store.fetchRecentSamples(minutes: 30)

        self.connectedDevice = device
        self.liveBPM = sample.bpmDisplay
        self.lastSampleAt = sample.receivedAt
        self.recentSamples = recent

        await uploadQueue.enqueueSync()
    }

    private func ensureSession(for device: BLEDevice, userID: String) async -> HeartRateSession {
        if let currentSession, currentSession.status == "active", currentSession.sourceDeviceId == device.id.uuidString {
            return currentSession
        }

        if currentSession?.status == "active" {
            await flushAndCloseCurrentSession(status: "replaced")
        }

        let session = HeartRateSession(
            id: UUID(),
            userId: userID,
            sourceType: .whoopBLEIOS,
            sourceDeviceId: device.id.uuidString,
            startedAt: Date(),
            endedAt: nil,
            status: "active",
            appVersion: AppConfig.appVersion,
            deviceModel: device.name
        )
        await store.createSession(session)
        try? await syncService.createHeartRateSession(session)
        currentSession = session
        return session
    }

    private func attemptAutoReconnectIfNeeded() {
        guard shouldAutoReconnect,
              let preferredDeviceID,
              permissionState == .ready || permissionState == .disconnected else {
            return
        }

        if let preferredDevice = devices.first(where: { $0.id == preferredDeviceID }) {
            shouldAutoReconnect = false
            connectedDevice = preferredDevice
            bleManager.connect(to: preferredDevice)
            return
        }

        if bleManager.reconnect(to: preferredDeviceID) {
            shouldAutoReconnect = false
            connectedDevice = devices.first(where: { $0.id == preferredDeviceID }) ?? connectedDevice
            return
        }

        if !bleManager.isScanning {
            bleManager.startScan()
        }
    }

    private func flushAndCloseCurrentSession(status: String) async {
        await uploadQueue.flush()

        guard let session = currentSession else { return }
        await store.endSession(sessionId: session.id, endedAt: Date(), status: status)
        try? await syncService.endHeartRateSession(sessionId: session.id, endedAt: Date())
        currentSession = nil
    }

    private func restoreConnectedDeviceFromSession() {
        guard connectedDevice == nil,
              let restored = currentSession.flatMap(Self.deviceFromSession) else {
            return
        }
        connectedDevice = restored
    }

    private static func deviceFromSession(_ session: HeartRateSession) -> BLEDevice? {
        guard let uuid = UUID(uuidString: session.sourceDeviceId) else { return nil }
        return BLEDevice(
            id: uuid,
            name: session.deviceModel ?? "Heart Rate Device",
            rssi: 0,
            isLikelyWhoop: (session.deviceModel ?? "").localizedCaseInsensitiveContains("whoop")
        )
    }

    private static func loadPreferredDeviceID(forKey key: String) -> UUID? {
        guard let rawValue = UserDefaults.standard.string(forKey: key) else { return nil }
        return UUID(uuidString: rawValue)
    }

    private static func persistPreferredDeviceID(_ id: UUID, forKey key: String) {
        UserDefaults.standard.set(id.uuidString, forKey: key)
    }

    private static func clearPreferredDeviceID(forKey key: String) {
        UserDefaults.standard.removeObject(forKey: key)
    }

    private func smoothedDisplayValue(for measurement: BLEHeartRateMeasurement) -> Int {
        let raw = Double(measurement.bpm)
        let nextValue: Double
        if let lastDisplayBPM {
            nextValue = (BiometricsConfig.displayEMAAlpha * raw) + ((1 - BiometricsConfig.displayEMAAlpha) * lastDisplayBPM)
        } else {
            nextValue = raw
        }
        lastDisplayBPM = nextValue
        lastMeasurementAt = measurement.receivedAt
        return Int(nextValue.rounded())
    }

    private func isOutlier(_ measurement: BLEHeartRateMeasurement) -> Bool {
        guard measurement.bpm >= BiometricsConfig.hrMinBPM,
              measurement.bpm <= BiometricsConfig.hrMaxBPM else {
            return true
        }

        guard let lastMeasurementAt, let lastDisplayBPM else {
            return false
        }

        let seconds = max(measurement.receivedAt.timeIntervalSince(lastMeasurementAt), 1)
        let deltaPerSecond = abs(Double(measurement.bpm) - lastDisplayBPM) / seconds
        return deltaPerSecond > Double(BiometricsConfig.maxJumpPerSecond)
    }
}
