import Foundation

public final class ScreenTimeSharedStore {
    public static let shared = ScreenTimeSharedStore()

    public static let appGroupIdentifier = "group.com.ritual.companion"
    public static let selectionFilename = "screen-time-selection.bin"
    public static let snapshotFilename = "screen-time-snapshot.json"

    private let fileManager = FileManager.default
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    private init() {
        encoder.outputFormatting = [.sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        decoder.dateDecodingStrategy = .iso8601
    }

    private var containerURL: URL? {
        fileManager.containerURL(forSecurityApplicationGroupIdentifier: Self.appGroupIdentifier)
    }

    public func saveSelectionData(_ data: Data) throws {
        guard let containerURL else { throw CocoaError(.fileNoSuchFile) }
        try data.write(to: containerURL.appendingPathComponent(Self.selectionFilename), options: .atomic)
    }

    public func loadSelectionData() -> Data? {
        guard let containerURL else { return nil }
        return try? Data(contentsOf: containerURL.appendingPathComponent(Self.selectionFilename))
    }

    public func saveSnapshot(_ snapshot: ScreenTimeSnapshot) throws {
        guard let containerURL else { throw CocoaError(.fileNoSuchFile) }
        let url = containerURL.appendingPathComponent(Self.snapshotFilename)
        let data = try encoder.encode(snapshot)
        try data.write(to: url, options: .atomic)
    }

    public func loadSnapshot() -> ScreenTimeSnapshot? {
        guard let containerURL else { return nil }
        let url = containerURL.appendingPathComponent(Self.snapshotFilename)
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? decoder.decode(ScreenTimeSnapshot.self, from: data)
    }
}
