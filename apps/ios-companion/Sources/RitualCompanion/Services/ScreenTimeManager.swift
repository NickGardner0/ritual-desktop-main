import FamilyControls
import Foundation
import RitualScreenTimeShared

enum ScreenTimeAccessStatus: String {
    case notDetermined
    case approved
    case denied
}

final class ScreenTimeManager {
    static let shared = ScreenTimeManager()

    private let store = ScreenTimeSharedStore.shared

    private init() {}

    func checkAuthorizationStatus() -> ScreenTimeAccessStatus {
        switch AuthorizationCenter.shared.authorizationStatus {
        case .approved:
            return .approved
        case .denied:
            return .denied
        case .notDetermined:
            return .notDetermined
        @unknown default:
            return .notDetermined
        }
    }

    @discardableResult
    func requestAuthorization() async throws -> ScreenTimeAccessStatus {
        try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
        return checkAuthorizationStatus()
    }

    func saveSelection(_ selection: FamilyActivitySelection) throws {
        let data = try PropertyListEncoder().encode(selection)
        try store.saveSelectionData(data)
    }

    func loadSelection() -> FamilyActivitySelection? {
        guard let data = store.loadSelectionData() else { return nil }
        return try? PropertyListDecoder().decode(FamilyActivitySelection.self, from: data)
    }

    func loadLatestSnapshot() -> ScreenTimeSnapshot? {
        store.loadSnapshot()
    }
}
