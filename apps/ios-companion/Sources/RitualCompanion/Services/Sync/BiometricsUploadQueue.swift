import Foundation

actor BiometricsUploadQueue {
    private let store: BiometricsLocalStore
    private let syncService: BiometricsSyncService
    private var scheduledTask: Task<Void, Never>?
    private var isFlushing = false

    init(store: BiometricsLocalStore, syncService: BiometricsSyncService) {
        self.store = store
        self.syncService = syncService
    }

    func enqueueSync() {
        guard scheduledTask == nil else { return }
        scheduledTask = Task {
            try? await Task.sleep(nanoseconds: UInt64(BiometricsConfig.uploadIntervalSeconds * 1_000_000_000))
            await flush()
        }
    }

    func flush() async {
        guard !isFlushing else { return }
        isFlushing = true
        scheduledTask = nil
        defer { isFlushing = false }

        while true {
            let pending = await store.fetchUnsyncedHeartRateSamples(limit: BiometricsConfig.uploadBatchSize)
            guard !pending.isEmpty else { return }

            do {
                try await syncService.uploadHeartRateSamples(pending)
                await store.markHeartRateSamplesSynced(ids: pending.map(\.id))
            } catch {
                print("⚠️ Biometrics upload failed: \(error)")
                return
            }
        }
    }
}
