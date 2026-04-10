import Foundation

/// Status values recognized by the backend habit log endpoint.
/// Mirrors the `status` Literal in `apps/backend/models/habit_models.py::HabitLogBase`.
enum HabitLogStatus: String, Codable {
    case completed
    case missed
    case skipped
}

/// Minimal abstraction over the subset of `RitualAPIClient` that the resolver
/// needs, so tests can run the resolver against a fake without booting Clerk,
/// Keychain, or the network.
protocol HabitLogPosting: AnyObject {
    func logHabit(
        habitId: String,
        amount: Double,
        date: String,
        status: HabitLogStatus,
        completedAt: Date,
        notes: String?
    ) async throws
}

/// Minimal abstraction over `HealthKitManagerV2.fetchDailyAggregatedMetrics`,
/// also for testability.
protocol HealthKitDailyFetching: AnyObject {
    func fetchDailyAggregatedMetrics(for metricType: String, startDate: Date, endDate: Date) async throws -> [NormalizedMetric]
}

extension HealthKitManagerV2: HealthKitDailyFetching {}

/// Given a set of `HabitMapping` rules, resolves each to an aggregated value
/// for the target day and posts the result to the backend as a habit log —
/// unless the dedupe ledger says nothing has meaningfully changed since the
/// last post.
///
/// The resolver is intentionally stateless aside from the ledger it reads
/// through the store. Callers invoke `resolveAndPost` whenever there's new
/// HealthKit data (typically right after a successful sync).
///
/// Data flow:
///
///     mappings ──┐
///                ▼
///     ┌──────────────────┐   per metric type   ┌──────────────────────┐
///     │  unique metrics  │────────────────────▶│ fetchDailyAggregated │
///     └──────────────────┘                     │  (HealthKitManagerV2)│
///                                              └──────────┬───────────┘
///                                                         │
///                                                         ▼
///                                               group samples by day
///                                                         │
///                                                         ▼
///                                              aggregate(values, .sum|…)
///                                                         │
///                                                         ▼
///                                     ┌───────────────────┴───────────────┐
///                                     │ ledger.shouldPost? yes → POST     │
///                                     │                        no → skip  │
///                                     └───────────────────────────────────┘
@MainActor
final class HabitMappingResolver {

    struct Result {
        let posted: Int
        let skipped: Int
        let failed: Int
        let errors: [String]
    }

    private let apiClient: HabitLogPosting
    private let healthKit: HealthKitDailyFetching
    private let store: HabitMappingStore
    private let calendar: Calendar

    init(
        apiClient: HabitLogPosting,
        healthKit: HealthKitDailyFetching,
        store: HabitMappingStore,
        calendar: Calendar = .current
    ) {
        self.apiClient = apiClient
        self.healthKit = healthKit
        self.store = store
        self.calendar = calendar
    }

    /// Resolve all enabled mappings for the given day (default: today in the
    /// user's local calendar) and post any that have meaningfully changed.
    @discardableResult
    func resolveAndPost(mappings: [HabitMapping], on day: Date = Date()) async -> Result {
        let enabled = mappings.filter { $0.isEnabled }
        guard !enabled.isEmpty else {
            return Result(posted: 0, skipped: 0, failed: 0, errors: [])
        }

        let dayStart = calendar.startOfDay(for: day)
        guard let dayEnd = calendar.date(byAdding: .day, value: 1, to: dayStart) else {
            return Result(posted: 0, skipped: 0, failed: 0, errors: ["Could not compute day window"])
        }
        let dayKey = Self.isoDayKey(for: dayStart, calendar: calendar)

        // Batch HealthKit reads by metric type so multiple mappings over the
        // same metric only pay the cost of one fetch.
        let uniqueMetricTypes = Set(enabled.map { $0.metricType.rawValue })
        var samplesByMetricType: [String: [NormalizedMetric]] = [:]
        var errors: [String] = []

        for rawMetric in uniqueMetricTypes {
            do {
                let samples = try await healthKit.fetchDailyAggregatedMetrics(
                    for: rawMetric,
                    startDate: dayStart,
                    endDate: dayEnd
                )
                samplesByMetricType[rawMetric] = samples
            } catch {
                errors.append("fetch \(rawMetric): \(error.localizedDescription)")
            }
        }

        var posted = 0
        var skipped = 0
        var failed = 0

        for mapping in enabled {
            let samples = samplesByMetricType[mapping.metricType.rawValue] ?? []
            let todays = Self.filterToDay(samples, dayKey: dayKey)
            let values = todays.map { $0.value }

            guard let aggregated = HabitMapping.aggregate(values: values, using: mapping.aggregation) else {
                // No data for today — skip without logging a failure. The day
                // may simply not have happened yet (early morning, no steps).
                skipped += 1
                continue
            }

            let status: HabitLogStatus
            if let target = mapping.target {
                status = aggregated >= target ? .completed : .missed
            } else {
                status = .completed
            }

            guard store.shouldPost(
                mappingId: mapping.id,
                day: dayKey,
                newAmount: aggregated,
                newStatus: status.rawValue
            ) else {
                skipped += 1
                continue
            }

            do {
                try await apiClient.logHabit(
                    habitId: mapping.habitId,
                    amount: aggregated,
                    date: dayKey,
                    status: status,
                    completedAt: Date(),
                    notes: "ritual-auto:apple_health:\(mapping.metricType.rawValue)"
                )
                store.recordPost(
                    mappingId: mapping.id,
                    day: dayKey,
                    amount: aggregated,
                    status: status.rawValue
                )
                posted += 1
            } catch {
                failed += 1
                errors.append("post \(mapping.habitName): \(error.localizedDescription)")
            }
        }

        return Result(posted: posted, skipped: skipped, failed: failed, errors: errors)
    }

    // MARK: - Helpers

    /// Keep only samples whose `attributedDate` (preferred) or `startTime` falls
    /// on the target day. This matches the same convention used by `LocalExportManager`,
    /// which honors `attributedDate` so overnight sleep sessions land on the wake day.
    static func filterToDay(_ samples: [NormalizedMetric], dayKey: String) -> [NormalizedMetric] {
        samples.filter { sample in
            if let attributed = sample.attributedDate, !attributed.isEmpty {
                return String(attributed.prefix(10)) == dayKey
            }
            guard sample.startTime.count >= 10 else { return false }
            return String(sample.startTime.prefix(10)) == dayKey
        }
    }

    static func isoDayKey(for date: Date, calendar: Calendar) -> String {
        let f = DateFormatter()
        f.calendar = calendar
        f.timeZone = calendar.timeZone
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }
}
