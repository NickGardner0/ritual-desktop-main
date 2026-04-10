import Foundation

/// User-configured rule that binds a HealthKit metric type to a Ritual habit.
///
/// Example: `HabitMapping(habitId: "h_walk", metricType: .steps, aggregation: .sum, target: 8000)`
/// means "look at today's step count; if it's ≥ 8000, mark the Walk habit complete
/// for today; otherwise record progress toward the goal."
///
/// MVP constraints:
///   - Window is always `.today` (daily). Weekly/monthly deferred.
///   - Source is always Apple Health (HealthKit). Whoop/Oura etc. can come later
///     as a new field once the same plumbing is reused.
///   - One mapping per (habitId, metricType) pair. The store enforces this.
struct HabitMapping: Codable, Identifiable, Equatable {
    /// Stable identifier for this mapping, independent of habit/metric so the
    /// user can edit the bound metric without losing dedupe state.
    let id: String

    /// Server-side habit id (from TrackedHabit.id).
    var habitId: String

    /// Human-readable habit name, cached at edit-time so the list view doesn't
    /// need to cross-reference server data to render.
    var habitName: String

    /// Which Ritual `MetricType` feeds this mapping. We use Ritual's enum rather
    /// than `HKQuantityTypeIdentifier` because Ritual already normalizes HK data
    /// through `NormalizedMetric`/`MetricType`, and the resolver consumes normalized
    /// metrics — there's no need to introduce a parallel HealthKit-typed surface.
    var metricType: MetricType

    /// How multiple samples inside the window are collapsed into one value.
    var aggregation: Aggregation

    /// Window over which samples are aggregated.
    var window: Window

    /// Optional completion threshold. If set, mapping logs `status: .completed`
    /// when the aggregated value meets or exceeds target, otherwise `.missed`.
    /// If nil, every successful aggregation logs `.completed` with the amount.
    var target: Double?

    /// Whether the resolver should act on this mapping. UI-level toggle;
    /// disabled mappings are preserved so users can re-enable without losing config.
    var isEnabled: Bool

    /// ISO date string "yyyy-MM-dd" when this mapping was created (diagnostic).
    let createdAt: Date

    init(
        id: String = UUID().uuidString,
        habitId: String,
        habitName: String,
        metricType: MetricType,
        aggregation: Aggregation = .sum,
        window: Window = .today,
        target: Double? = nil,
        isEnabled: Bool = true,
        createdAt: Date = Date()
    ) {
        self.id = id
        self.habitId = habitId
        self.habitName = habitName
        self.metricType = metricType
        self.aggregation = aggregation
        self.window = window
        self.target = target
        self.isEnabled = isEnabled
        self.createdAt = createdAt
    }

    enum Aggregation: String, Codable, CaseIterable {
        case sum
        case average
        case max
        case min
        case latest

        var displayName: String {
            switch self {
            case .sum: return "Sum"
            case .average: return "Average"
            case .max: return "Maximum"
            case .min: return "Minimum"
            case .latest: return "Latest"
            }
        }

        /// Recommended default for a given metric type. Used by the editor UI
        /// to pre-populate the aggregation picker so users get a sensible value.
        static func recommended(for metricType: MetricType) -> Aggregation {
            switch metricType {
            case .steps, .activeEnergy, .basalEnergy, .distance, .flightsClimbed,
                 .exerciseTime, .standTime, .mindfulMinutes,
                 .sleepSession, .sleepAsleep, .sleepREM, .sleepDeep, .sleepCore:
                return .sum
            case .hr, .hrv, .restingHr, .walkingHr, .respiratoryRate, .oxygenSaturation:
                return .average
            case .sleepAwake:
                return .sum
            case .workout:
                return .sum
            case .screenTimeTotal, .screenTimeAppUsage, .screenTimeWebDomainUsage:
                return .sum
            // Body measurements — latest reading for the day
            case .bodyMass, .bodyMassIndex, .bodyFatPercentage, .leanBodyMass,
                 .height, .waistCircumference:
                return .latest
            // Nutrition — daily totals
            case .dietaryEnergy, .dietaryProtein, .dietaryCarbs, .dietaryFat,
                 .dietaryFiber, .dietarySugar, .dietaryWater, .dietaryCaffeine:
                return .sum
            // Vitals — averages
            case .bloodPressureSystolic, .bloodPressureDiastolic, .bloodGlucose, .bodyTemperature:
                return .average
            // Mobility — averages
            case .walkingSpeed, .walkingStepLength, .walkingAsymmetry:
                return .average
            }
        }
    }

    enum Window: String, Codable, CaseIterable {
        case today

        var displayName: String {
            switch self {
            case .today: return "Today"
            }
        }
    }
}

extension HabitMapping {
    /// Compute the aggregated value for a single mapping from a pre-filtered
    /// set of samples. Returns nil if there are no samples to aggregate.
    ///
    /// Pure function — no dates, no I/O — so it is trivially unit-testable.
    /// The caller is responsible for filtering samples to the correct window.
    static func aggregate(values: [Double], using aggregation: Aggregation) -> Double? {
        guard !values.isEmpty else { return nil }
        switch aggregation {
        case .sum:
            return values.reduce(0, +)
        case .average:
            return values.reduce(0, +) / Double(values.count)
        case .max:
            return values.max()
        case .min:
            return values.min()
        case .latest:
            // Samples arrive in order from the caller (start-time ascending).
            return values.last
        }
    }
}
