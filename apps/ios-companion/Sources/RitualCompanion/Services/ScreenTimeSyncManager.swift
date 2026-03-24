import Foundation
import RitualScreenTimeShared

final class ScreenTimeSyncManager {
    static let shared = ScreenTimeSyncManager()

    private let apiClient = RitualAPIClient()
    private let store = ScreenTimeSharedStore.shared

    private init() {}

    func syncLatestSnapshot(authToken: String) async throws {
        guard let snapshot = store.loadSnapshot() else { return }

        if !apiClient.hasStoredScreenTimeCredentials {
            try await apiClient.registerScreenTimeDevice(authToken: authToken)
        }

        let rollups = makeRollups(snapshot: snapshot)
        _ = try await apiClient.ingestScreenTimeRollups(rollups)
    }

    private func makeRollups(snapshot: ScreenTimeSnapshot) -> [ScreenTimeRollupRequest] {
        var rollups: [ScreenTimeRollupRequest] = [
            ScreenTimeRollupRequest(
                day: snapshot.day,
                timezone: snapshot.timezone,
                breakdownKind: ScreenTimeBreakdownKind.total.rawValue,
                entityKey: "__total__",
                entityLabel: "Total Screen Time",
                activeSeconds: snapshot.totalSeconds,
                sortSeconds: snapshot.totalSeconds,
                metadataJSON: nil
            )
        ]

        rollups.append(contentsOf: snapshot.apps.map { item in
            ScreenTimeRollupRequest(
                day: snapshot.day,
                timezone: snapshot.timezone,
                breakdownKind: item.kind.rawValue,
                entityKey: item.key,
                entityLabel: item.label,
                activeSeconds: item.activeSeconds,
                sortSeconds: item.sortSeconds ?? item.activeSeconds,
                metadataJSON: nil
            )
        })

        rollups.append(contentsOf: snapshot.websites.map { item in
            ScreenTimeRollupRequest(
                day: snapshot.day,
                timezone: snapshot.timezone,
                breakdownKind: item.kind.rawValue,
                entityKey: item.key,
                entityLabel: item.label,
                activeSeconds: item.activeSeconds,
                sortSeconds: item.sortSeconds ?? item.activeSeconds,
                metadataJSON: nil
            )
        })

        return rollups
    }
}
