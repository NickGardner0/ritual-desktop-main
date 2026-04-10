import Foundation

/// Renders a day's worth of NormalizedMetric data into human-readable Markdown.
///
/// Two variants are supported, selected by `MarkdownStyle`:
///   - `.plain`      — legacy format, a top heading + a metrics table. Matches
///                     the output LocalExportManager produced before this refactor
///                     so that existing exports and tests keep working unchanged.
///   - `.frontmatter` — YAML frontmatter block followed by a categorized
///                     Markdown body. Designed to drop cleanly into Obsidian
///                     or any Markdown note-taker that recognizes frontmatter.
///
/// Metrics are grouped into readable sections (Activity / Heart / Sleep /
/// Respiratory / Workouts / Mindfulness / Other). The exporter is deterministic:
/// given the same inputs it produces byte-identical output, which lets us write
/// golden-file tests for both variants.
enum MarkdownStyle: String, Codable, CaseIterable {
    case plain
    case frontmatter

    var displayName: String {
        switch self {
        case .plain: return "Plain"
        case .frontmatter: return "Frontmatter"
        }
    }
}

struct MarkdownExporter {
    let style: MarkdownStyle
    let generatedAt: Date

    init(style: MarkdownStyle, generatedAt: Date = Date()) {
        self.style = style
        self.generatedAt = generatedAt
    }

    /// Render the full Markdown document for a single day.
    func render(date: Date, metrics: [NormalizedMetric]) -> String {
        let isoDate = Self.isoDateString(from: date)
        let generatedIso = Self.iso8601Formatter.string(from: generatedAt)

        switch style {
        case .plain:
            return renderPlain(isoDate: isoDate, generatedIso: generatedIso, metrics: metrics)
        case .frontmatter:
            return renderFrontmatter(isoDate: isoDate, generatedIso: generatedIso, metrics: metrics)
        }
    }

    // MARK: - Plain

    private func renderPlain(isoDate: String, generatedIso: String, metrics: [NormalizedMetric]) -> String {
        var lines: [String] = []
        lines.append("# Ritual Health Export \(isoDate)")
        lines.append("")
        lines.append("Generated at \(generatedIso)")
        lines.append("")
        lines.append("| Metric | Value | Unit | Start | End |")
        lines.append("|---|---:|---|---|---|")
        for metric in metrics {
            lines.append("| \(metric.metricType.rawValue) | \(formatValue(metric.value)) | \(metric.unit.rawValue) | \(metric.startTime) | \(metric.endTime) |")
        }
        return lines.joined(separator: "\n")
    }

    // MARK: - Frontmatter

    private func renderFrontmatter(isoDate: String, generatedIso: String, metrics: [NormalizedMetric]) -> String {
        var lines: [String] = []
        lines.append("---")
        lines.append("date: \(isoDate)")
        lines.append("source: ritual")
        lines.append("generated_at: \(generatedIso)")
        lines.append("metric_count: \(metrics.count)")
        lines.append("tags: [ritual, health, \(isoDate)]")
        lines.append("---")
        lines.append("")
        lines.append("# Health \(isoDate)")
        lines.append("")

        if metrics.isEmpty {
            lines.append("_No metrics recorded._")
            return lines.joined(separator: "\n")
        }

        let grouped = Self.group(metrics: metrics)
        for section in Self.sectionOrder {
            guard let items = grouped[section], !items.isEmpty else { continue }
            lines.append("## \(section.displayName)")
            lines.append("")
            for metric in items {
                lines.append("- **\(Self.displayName(for: metric.metricType))**: \(formatValue(metric.value)) \(metric.unit.rawValue)")
            }
            lines.append("")
        }

        // Trim trailing blank line for deterministic output.
        while lines.last == "" { lines.removeLast() }
        return lines.joined(separator: "\n")
    }

    // MARK: - Grouping

    enum Section: String, CaseIterable {
        case activity
        case heart
        case sleep
        case respiratory
        case body
        case nutrition
        case vitals
        case mobility
        case workouts
        case mindfulness
        case other

        var displayName: String {
            switch self {
            case .activity: return "Activity"
            case .heart: return "Heart"
            case .sleep: return "Sleep"
            case .respiratory: return "Respiratory"
            case .body: return "Body Measurements"
            case .nutrition: return "Nutrition"
            case .vitals: return "Vitals"
            case .mobility: return "Mobility"
            case .workouts: return "Workouts"
            case .mindfulness: return "Mindfulness"
            case .other: return "Other"
            }
        }
    }

    static let sectionOrder: [Section] = [.activity, .heart, .sleep, .respiratory, .body, .nutrition, .vitals, .mobility, .workouts, .mindfulness, .other]

    static func section(for metricType: MetricType) -> Section {
        switch metricType {
        case .steps, .activeEnergy, .basalEnergy, .distance, .flightsClimbed, .exerciseTime, .standTime:
            return .activity
        case .hr, .hrv, .restingHr, .walkingHr:
            return .heart
        case .sleepSession, .sleepAsleep, .sleepAwake, .sleepREM, .sleepDeep, .sleepCore:
            return .sleep
        case .respiratoryRate, .oxygenSaturation:
            return .respiratory
        case .bodyMass, .bodyMassIndex, .bodyFatPercentage, .leanBodyMass, .height, .waistCircumference:
            return .body
        case .dietaryEnergy, .dietaryProtein, .dietaryCarbs, .dietaryFat,
             .dietaryFiber, .dietarySugar, .dietaryWater, .dietaryCaffeine:
            return .nutrition
        case .bloodPressureSystolic, .bloodPressureDiastolic, .bloodGlucose, .bodyTemperature:
            return .vitals
        case .walkingSpeed, .walkingStepLength, .walkingAsymmetry:
            return .mobility
        case .workout:
            return .workouts
        case .mindfulMinutes:
            return .mindfulness
        case .screenTimeTotal, .screenTimeAppUsage, .screenTimeWebDomainUsage:
            return .other
        }
    }

    private static func group(metrics: [NormalizedMetric]) -> [Section: [NormalizedMetric]] {
        var out: [Section: [NormalizedMetric]] = [:]
        for metric in metrics {
            out[section(for: metric.metricType), default: []].append(metric)
        }
        for key in out.keys {
            out[key]?.sort { $0.metricType.rawValue < $1.metricType.rawValue }
        }
        return out
    }

    static func displayName(for metricType: MetricType) -> String {
        switch metricType {
        case .steps: return "Steps"
        case .activeEnergy: return "Active energy"
        case .basalEnergy: return "Basal energy"
        case .distance: return "Distance"
        case .flightsClimbed: return "Flights climbed"
        case .exerciseTime: return "Exercise time"
        case .standTime: return "Stand time"
        case .hr: return "Heart rate"
        case .hrv: return "HRV"
        case .restingHr: return "Resting heart rate"
        case .walkingHr: return "Walking heart rate"
        case .respiratoryRate: return "Respiratory rate"
        case .oxygenSaturation: return "Oxygen saturation"
        case .sleepSession: return "Sleep session"
        case .sleepAsleep: return "Asleep"
        case .sleepAwake: return "Awake"
        case .sleepREM: return "REM"
        case .sleepDeep: return "Deep sleep"
        case .sleepCore: return "Core sleep"
        case .workout: return "Workout"
        case .mindfulMinutes: return "Mindful minutes"
        // Body Measurements
        case .bodyMass: return "Weight"
        case .bodyMassIndex: return "BMI"
        case .bodyFatPercentage: return "Body fat"
        case .leanBodyMass: return "Lean body mass"
        case .height: return "Height"
        case .waistCircumference: return "Waist circumference"
        // Nutrition
        case .dietaryEnergy: return "Calories consumed"
        case .dietaryProtein: return "Protein"
        case .dietaryCarbs: return "Carbohydrates"
        case .dietaryFat: return "Fat"
        case .dietaryFiber: return "Fiber"
        case .dietarySugar: return "Sugar"
        case .dietaryWater: return "Water"
        case .dietaryCaffeine: return "Caffeine"
        // Vitals
        case .bloodPressureSystolic: return "Blood pressure (systolic)"
        case .bloodPressureDiastolic: return "Blood pressure (diastolic)"
        case .bloodGlucose: return "Blood glucose"
        case .bodyTemperature: return "Body temperature"
        // Mobility
        case .walkingSpeed: return "Walking speed"
        case .walkingStepLength: return "Step length"
        case .walkingAsymmetry: return "Walking asymmetry"
        // Screen Time
        case .screenTimeTotal: return "Screen time total"
        case .screenTimeAppUsage: return "App usage"
        case .screenTimeWebDomainUsage: return "Web usage"
        }
    }

    // MARK: - Formatting helpers

    private func formatValue(_ value: Double) -> String {
        if value.rounded() == value && abs(value) < 1e12 {
            return String(Int64(value))
        }
        return String(format: "%.2f", value)
    }

    private static let iso8601Formatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    private static func isoDateString(from date: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone.current
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }
}
