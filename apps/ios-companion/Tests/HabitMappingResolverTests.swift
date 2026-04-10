import XCTest
@testable import RitualCompanion

@MainActor
final class HabitMappingResolverTests: XCTestCase {

    // MARK: - Fakes

    final class FakeAPI: HabitLogPosting {
        struct Call: Equatable {
            let habitId: String
            let amount: Double
            let date: String
            let status: HabitLogStatus
        }
        var calls: [Call] = []
        var shouldThrow = false
        func logHabit(
            habitId: String,
            amount: Double,
            date: String,
            status: HabitLogStatus,
            completedAt: Date,
            notes: String?
        ) async throws {
            if shouldThrow { throw NSError(domain: "test", code: 1) }
            calls.append(Call(habitId: habitId, amount: amount, date: date, status: status))
        }
    }

    final class FakeHK: HealthKitDailyFetching {
        var samplesByMetric: [String: [NormalizedMetric]] = [:]
        var shouldThrow = false
        func fetchDailyAggregatedMetrics(for metricType: String, startDate: Date, endDate: Date) async throws -> [NormalizedMetric] {
            if shouldThrow { throw NSError(domain: "hk", code: 1) }
            return samplesByMetric[metricType] ?? []
        }
    }

    // MARK: - Helpers

    private var utcCalendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        c.locale = Locale(identifier: "en_US_POSIX")
        return c
    }

    private func dayStart(_ key: String) -> Date {
        let f = DateFormatter()
        f.calendar = utcCalendar
        f.timeZone = utcCalendar.timeZone
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.date(from: key)!
    }

    private func sample(_ type: MetricType, value: Double, day: String) -> NormalizedMetric {
        let start = dayStart(day).addingTimeInterval(3600 * 8)
        let end = start.addingTimeInterval(3600)
        return NormalizedMetric(
            metricType: type,
            startTime: start,
            endTime: end,
            value: value,
            unit: .count
        )
    }

    private func mapping(
        id: String = "m1",
        habitId: String = "h1",
        metric: MetricType = .steps,
        agg: HabitMapping.Aggregation = .sum,
        target: Double? = nil,
        enabled: Bool = true
    ) -> HabitMapping {
        HabitMapping(
            id: id,
            habitId: habitId,
            habitName: "Walk",
            metricType: metric,
            aggregation: agg,
            window: .today,
            target: target,
            isEnabled: enabled,
            createdAt: Date(timeIntervalSince1970: 0)
        )
    }

    private func makeStore() -> HabitMappingStore {
        let suite = "HabitMappingResolverTests.\(UUID().uuidString)"
        let d = UserDefaults(suiteName: suite)!
        d.removePersistentDomain(forName: suite)
        return HabitMappingStore(defaults: d)
    }

    private func makeResolver(api: FakeAPI, hk: FakeHK, store: HabitMappingStore) -> HabitMappingResolver {
        HabitMappingResolver(apiClient: api, healthKit: hk, store: store, calendar: utcCalendar)
    }

    // MARK: - Aggregation

    func testSumAggregationPostsTotal() async {
        let api = FakeAPI()
        let hk = FakeHK()
        hk.samplesByMetric["steps"] = [
            sample(.steps, value: 3000, day: "2026-04-08"),
            sample(.steps, value: 5000, day: "2026-04-08"),
        ]
        let store = makeStore()
        let resolver = makeResolver(api: api, hk: hk, store: store)

        let result = await resolver.resolveAndPost(mappings: [mapping()], on: dayStart("2026-04-08"))

        XCTAssertEqual(result.posted, 1)
        XCTAssertEqual(api.calls, [.init(habitId: "h1", amount: 8000, date: "2026-04-08", status: .completed)])
    }

    func testMaxAggregationPicksLargest() async {
        let api = FakeAPI()
        let hk = FakeHK()
        hk.samplesByMetric["hr"] = [
            sample(.hr, value: 60, day: "2026-04-08"),
            sample(.hr, value: 140, day: "2026-04-08"),
            sample(.hr, value: 90, day: "2026-04-08"),
        ]
        let resolver = makeResolver(api: api, hk: hk, store: makeStore())

        await resolver.resolveAndPost(
            mappings: [mapping(metric: .hr, agg: .max)],
            on: dayStart("2026-04-08")
        )
        XCTAssertEqual(api.calls.first?.amount, 140)
    }

    func testAverageAggregation() async {
        let api = FakeAPI()
        let hk = FakeHK()
        hk.samplesByMetric["hrv"] = [
            sample(.hrv, value: 40, day: "2026-04-08"),
            sample(.hrv, value: 60, day: "2026-04-08"),
        ]
        let resolver = makeResolver(api: api, hk: hk, store: makeStore())
        await resolver.resolveAndPost(
            mappings: [mapping(metric: .hrv, agg: .average)],
            on: dayStart("2026-04-08")
        )
        XCTAssertEqual(api.calls.first?.amount, 50)
    }

    // MARK: - Target threshold

    func testTargetMetMarksCompleted() async {
        let api = FakeAPI()
        let hk = FakeHK()
        hk.samplesByMetric["steps"] = [sample(.steps, value: 9000, day: "2026-04-08")]
        let resolver = makeResolver(api: api, hk: hk, store: makeStore())

        await resolver.resolveAndPost(
            mappings: [mapping(target: 8000)],
            on: dayStart("2026-04-08")
        )
        XCTAssertEqual(api.calls.first?.status, .completed)
    }

    func testTargetMissedMarksMissed() async {
        let api = FakeAPI()
        let hk = FakeHK()
        hk.samplesByMetric["steps"] = [sample(.steps, value: 2000, day: "2026-04-08")]
        let resolver = makeResolver(api: api, hk: hk, store: makeStore())

        await resolver.resolveAndPost(
            mappings: [mapping(target: 8000)],
            on: dayStart("2026-04-08")
        )
        XCTAssertEqual(api.calls.first?.status, .missed)
    }

    // MARK: - Skip cases

    func testNoSamplesIsSkippedNotFailed() async {
        let api = FakeAPI()
        let hk = FakeHK() // empty
        let resolver = makeResolver(api: api, hk: hk, store: makeStore())

        let result = await resolver.resolveAndPost(mappings: [mapping()], on: dayStart("2026-04-08"))
        XCTAssertEqual(result.posted, 0)
        XCTAssertEqual(result.skipped, 1)
        XCTAssertEqual(result.failed, 0)
        XCTAssertTrue(api.calls.isEmpty)
    }

    func testDisabledMappingIgnored() async {
        let api = FakeAPI()
        let hk = FakeHK()
        hk.samplesByMetric["steps"] = [sample(.steps, value: 8000, day: "2026-04-08")]
        let resolver = makeResolver(api: api, hk: hk, store: makeStore())

        let result = await resolver.resolveAndPost(
            mappings: [mapping(enabled: false)],
            on: dayStart("2026-04-08")
        )
        XCTAssertEqual(result.posted, 0)
        XCTAssertTrue(api.calls.isEmpty)
    }

    func testDedupeSkipsUnchangedSecondRun() async {
        let api = FakeAPI()
        let hk = FakeHK()
        hk.samplesByMetric["steps"] = [sample(.steps, value: 8000, day: "2026-04-08")]
        let store = makeStore()
        let resolver = makeResolver(api: api, hk: hk, store: store)

        _ = await resolver.resolveAndPost(mappings: [mapping()], on: dayStart("2026-04-08"))
        let second = await resolver.resolveAndPost(mappings: [mapping()], on: dayStart("2026-04-08"))

        XCTAssertEqual(api.calls.count, 1)
        XCTAssertEqual(second.skipped, 1)
        XCTAssertEqual(second.posted, 0)
    }

    // MARK: - Error handling

    func testPostFailurePropagatesAsFailed() async {
        let api = FakeAPI(); api.shouldThrow = true
        let hk = FakeHK()
        hk.samplesByMetric["steps"] = [sample(.steps, value: 8000, day: "2026-04-08")]
        let resolver = makeResolver(api: api, hk: hk, store: makeStore())

        let result = await resolver.resolveAndPost(mappings: [mapping()], on: dayStart("2026-04-08"))
        XCTAssertEqual(result.failed, 1)
        XCTAssertEqual(result.posted, 0)
        XCTAssertEqual(result.errors.count, 1)
    }

    func testFetchFailureRecordsErrorAndSkipsMapping() async {
        let api = FakeAPI()
        let hk = FakeHK(); hk.shouldThrow = true
        let resolver = makeResolver(api: api, hk: hk, store: makeStore())

        let result = await resolver.resolveAndPost(mappings: [mapping()], on: dayStart("2026-04-08"))
        XCTAssertEqual(result.posted, 0)
        XCTAssertEqual(result.skipped, 1) // no samples → skip
        XCTAssertFalse(result.errors.isEmpty)
    }

    // MARK: - Day filter

    func testFilterToDayHonorsAttributedDate() {
        let start = dayStart("2026-04-07").addingTimeInterval(23 * 3600)
        let end = dayStart("2026-04-08").addingTimeInterval(6 * 3600)
        let overnight = NormalizedMetric(
            metricType: .sleepSession,
            startTime: start,
            endTime: end,
            value: 7.5,
            unit: .hours,
            attributedDate: dayStart("2026-04-08").addingTimeInterval(12 * 3600)
        )
        // startTime prefix is 2026-04-07 but attributedDate rolls it to the 8th.
        let kept = HabitMappingResolver.filterToDay([overnight], dayKey: "2026-04-08")
        XCTAssertEqual(kept.count, 1)

        let dropped = HabitMappingResolver.filterToDay([overnight], dayKey: "2026-04-07")
        XCTAssertEqual(dropped.count, 0)
    }

    func testFilterToDayFallsBackToStartTime() {
        let s = sample(.steps, value: 500, day: "2026-04-08")
        XCTAssertEqual(HabitMappingResolver.filterToDay([s], dayKey: "2026-04-08").count, 1)
        XCTAssertEqual(HabitMappingResolver.filterToDay([s], dayKey: "2026-04-07").count, 0)
    }
}
