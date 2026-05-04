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
        let raw = AuthorizationCenter.shared.authorizationStatus
        print("🕒 ScreenTime: authorizationStatus=\(raw)")
        switch raw {
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
        print("🕒 ScreenTime: requesting authorization (.individual)…")
        do {
            try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
        } catch {
            print("🕒 ScreenTime: requestAuthorization threw \(error)")
            throw error
        }
        // If requestAuthorization returned without throwing, the user approved.
        // `authorizationStatus` can lag behind the dialog result, so don't rely on it here.
        print("🕒 ScreenTime: grant succeeded; reported status=\(AuthorizationCenter.shared.authorizationStatus)")
        return .approved
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
