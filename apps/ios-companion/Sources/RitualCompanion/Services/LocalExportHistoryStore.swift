import Foundation

@MainActor
final class LocalExportHistoryStore {
    static let shared = LocalExportHistoryStore()

    private let storageKey = "LocalExport.history"
    private let maxEntries = 50

    private init() {}

    func load() -> [LocalExportHistoryEntry] {
        guard let data = UserDefaults.standard.data(forKey: storageKey),
              let entries = try? JSONDecoder().decode([LocalExportHistoryEntry].self, from: data) else {
            return []
        }
        return entries
    }

    func append(_ entry: LocalExportHistoryEntry) -> [LocalExportHistoryEntry] {
        var entries = load()
        entries.insert(entry, at: 0)
        if entries.count > maxEntries {
            entries = Array(entries.prefix(maxEntries))
        }

        if let data = try? JSONEncoder().encode(entries) {
            UserDefaults.standard.set(data, forKey: storageKey)
        }

        return entries
    }

    func clear() {
        UserDefaults.standard.removeObject(forKey: storageKey)
    }
}
