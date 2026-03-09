import XCTest
@testable import RitualCompanion

@MainActor
final class LocalExportHistoryStoreTests: XCTestCase {
    private let store = LocalExportHistoryStore.shared

    override func setUp() async throws {
        store.clear()
    }

    override func tearDown() async throws {
        store.clear()
    }

    func testHistoryRetainsMaxFiftyEntries() {
        for index in 0..<55 {
            let entry = LocalExportHistoryEntry(
                id: "entry-\(index)",
                timestamp: Date().addingTimeInterval(TimeInterval(index)),
                startDate: Date(),
                endDate: Date(),
                format: .markdown,
                successDays: 1,
                attemptedDays: 1,
                failedDays: [],
                exportedMetricCount: 4,
                failureReason: nil,
                failureMessage: nil
            )
            _ = store.append(entry)
        }

        let loaded = store.load()
        XCTAssertEqual(loaded.count, 50)
        XCTAssertEqual(loaded.first?.id, "entry-54")
        XCTAssertEqual(loaded.last?.id, "entry-5")
    }
}
