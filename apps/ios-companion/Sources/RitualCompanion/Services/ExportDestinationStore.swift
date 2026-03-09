import Foundation

@MainActor
final class ExportDestinationStore: ObservableObject {
    static let shared = ExportDestinationStore()

    @Published private(set) var destinationURL: URL?
    @Published private(set) var destinationName: String = "No folder selected"

    private let bookmarkKey = "LocalExport.destinationBookmark"

    private init() {
        loadDestination()
    }

    func selectDestination(_ url: URL) {
        guard url.startAccessingSecurityScopedResource() else {
            return
        }
        defer { url.stopAccessingSecurityScopedResource() }

        do {
            let bookmark = try url.bookmarkData(
                options: [],
                includingResourceValuesForKeys: nil,
                relativeTo: nil
            )
            UserDefaults.standard.set(bookmark, forKey: bookmarkKey)
            destinationURL = url
            destinationName = url.lastPathComponent
        } catch {
            print("⚠️ Failed to save export destination bookmark: \(error)")
        }
    }

    func clearDestination() {
        UserDefaults.standard.removeObject(forKey: bookmarkKey)
        destinationURL = nil
        destinationName = "No folder selected"
    }

    func withAccess<T>(_ work: (URL) throws -> T) throws -> T {
        guard let url = destinationURL else {
            throw ExportDestinationError.noDestination
        }

        guard url.startAccessingSecurityScopedResource() else {
            throw ExportDestinationError.accessDenied
        }
        defer { url.stopAccessingSecurityScopedResource() }

        return try work(url)
    }

    private func loadDestination() {
        guard let data = UserDefaults.standard.data(forKey: bookmarkKey) else { return }

        do {
            var isStale = false
            let url = try URL(
                resolvingBookmarkData: data,
                options: [],
                relativeTo: nil,
                bookmarkDataIsStale: &isStale
            )

            if isStale {
                let refreshed = try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
                UserDefaults.standard.set(refreshed, forKey: bookmarkKey)
            }

            destinationURL = url
            destinationName = url.lastPathComponent
        } catch {
            print("⚠️ Failed to resolve export destination bookmark: \(error)")
            clearDestination()
        }
    }
}

enum ExportDestinationError: LocalizedError {
    case noDestination
    case accessDenied

    var errorDescription: String? {
        switch self {
        case .noDestination:
            return "No export destination selected"
        case .accessDenied:
            return "Could not access selected export folder"
        }
    }
}
