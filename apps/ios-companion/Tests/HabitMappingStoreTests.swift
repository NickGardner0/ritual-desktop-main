import XCTest
@testable import RitualCompanion

@MainActor
final class HabitMappingStoreTests: XCTestCase {

    private var defaults: UserDefaults!
    private var store: HabitMappingStore!

    override func setUp() async throws {
        let suiteName = "HabitMappingStoreTests.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        store = HabitMappingStore(defaults: defaults)
    }

    private func mapping(
        id: String = UUID().uuidString,
        habitId: String = "habit-1",
        habitName: String = "Walk",
        metric: MetricType = .steps,
        agg: HabitMapping.Aggregation = .sum,
        target: Double? = nil,
        enabled: Bool = true
    ) -> HabitMapping {
        HabitMapping(
            id: id,
            habitId: habitId,
            habitName: habitName,
            metricType: metric,
            aggregation: agg,
            window: .today,
            target: target,
            isEnabled: enabled,
            createdAt: Date(timeIntervalSince1970: 0)
        )
    }

    // MARK: - CRUD

    func testUpsertInsertsAndPersists() {
        let m = mapping()
        store.upsert(m)
        XCTAssertEqual(store.loadMappings().map(\.id), [m.id])
    }

    func testUpsertReplacesSameHabitMetricPair() {
        let first = mapping(id: "a", habitName: "Walk", target: 5000)
        let second = mapping(id: "b", habitName: "Walk", target: 10000)
        store.upsert(first)
        store.upsert(second)
        let all = store.loadMappings()
        XCTAssertEqual(all.count, 1)
        XCTAssertEqual(all.first?.id, "b")
        XCTAssertEqual(all.first?.target, 10000)
    }

    func testUpsertAllowsDifferentMetricForSameHabit() {
        store.upsert(mapping(id: "a", habitName: "Walk", metric: .steps))
        store.upsert(mapping(id: "b", habitName: "Walk", metric: .distance))
        XCTAssertEqual(store.loadMappings().count, 2)
    }

    func testDeleteRemovesMappingAndLedger() {
        let m = mapping(id: "del")
        store.upsert(m)
        store.recordPost(mappingId: "del", day: "2026-04-08", amount: 1000, status: "completed")
        XCTAssertNotNil(store.loadLedger()["del"])
        store.delete(id: "del")
        XCTAssertTrue(store.loadMappings().isEmpty)
        XCTAssertNil(store.loadLedger()["del"])
    }

    func testClearAllWipesBothKeys() {
        store.upsert(mapping())
        store.recordPost(mappingId: "x", day: "2026-04-08", amount: 1, status: "completed")
        store.clearAll()
        XCTAssertTrue(store.loadMappings().isEmpty)
        XCTAssertTrue(store.loadLedger().isEmpty)
    }

    // MARK: - Dedupe ledger

    func testShouldPostTrueWhenNoPriorEntry() {
        XCTAssertTrue(store.shouldPost(mappingId: "m", day: "2026-04-08", newAmount: 100, newStatus: "completed"))
    }

    func testShouldPostTrueOnNewDay() {
        store.recordPost(mappingId: "m", day: "2026-04-07", amount: 100, status: "completed")
        XCTAssertTrue(store.shouldPost(mappingId: "m", day: "2026-04-08", newAmount: 100, newStatus: "completed"))
    }

    func testShouldPostTrueOnStatusChange() {
        store.recordPost(mappingId: "m", day: "2026-04-08", amount: 5000, status: "missed")
        XCTAssertTrue(store.shouldPost(mappingId: "m", day: "2026-04-08", newAmount: 5000, newStatus: "completed"))
    }

    func testShouldPostFalseOnSubOnePercentDrift() {
        store.recordPost(mappingId: "m", day: "2026-04-08", amount: 10000, status: "completed")
        // +50 (0.5%) — below threshold
        XCTAssertFalse(store.shouldPost(mappingId: "m", day: "2026-04-08", newAmount: 10050, newStatus: "completed"))
    }

    func testShouldPostTrueOnOverOnePercentDrift() {
        store.recordPost(mappingId: "m", day: "2026-04-08", amount: 10000, status: "completed")
        // +200 (2%) — above threshold
        XCTAssertTrue(store.shouldPost(mappingId: "m", day: "2026-04-08", newAmount: 10200, newStatus: "completed"))
    }

    func testShouldPostHandlesZeroPriorAmount() {
        store.recordPost(mappingId: "m", day: "2026-04-08", amount: 0, status: "missed")
        // denom clamped to 1.0 → 2.0 drift, clearly over threshold
        XCTAssertTrue(store.shouldPost(mappingId: "m", day: "2026-04-08", newAmount: 2, newStatus: "missed"))
    }
}
