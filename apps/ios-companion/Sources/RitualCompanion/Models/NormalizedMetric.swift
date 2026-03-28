import Foundation

/// Wearable data source identifier
enum WearableSource: String, Codable {
    case whoop = "whoop"
    case appleHealth = "apple_health"
    case appleScreenTime = "apple_screen_time"
    case oura = "oura"
    case garmin = "garmin"
    case fitbit = "fitbit"
}

/// Type of metric being recorded
enum MetricType: String, Codable, CaseIterable {
    // Activity
    case steps = "steps"
    case activeEnergy = "active_energy"
    case basalEnergy = "basal_energy"
    case distance = "distance"
    case flightsClimbed = "flights_climbed"
    case exerciseTime = "exercise_time"
    case standTime = "stand_time"
    
    // Heart
    case hr = "hr"
    case hrv = "hrv"
    case restingHr = "resting_hr"
    case walkingHr = "walking_hr"
    
    // Respiratory & Blood
    case respiratoryRate = "respiratory_rate"
    case oxygenSaturation = "oxygen_saturation"
    
    // Sleep & Recovery
    case sleepSession = "sleep_session"
    case sleepAsleep = "sleep_asleep"
    case sleepAwake = "sleep_awake"
    case sleepREM = "sleep_rem"
    case sleepDeep = "sleep_deep"
    case sleepCore = "sleep_core"
    
    // Workouts & Mindfulness
    case workout = "workout"
    case mindfulMinutes = "mindful_minutes"

    // Screen Time
    case screenTimeTotal = "screen_time_total"
    case screenTimeAppUsage = "screen_time_app_usage"
    case screenTimeWebDomainUsage = "screen_time_web_domain_usage"
}

/// Unit of measurement
enum MetricUnit: String, Codable {
    case count = "count"
    case bpm = "bpm"
    case ms = "ms"
    case kcal = "kcal"
    case seconds = "seconds"
    case minutes = "minutes"
    case hours = "hours"
    case meters = "meters"
    case kilometers = "km"
    case miles = "miles"
    case percent = "percent"
    case breathsPerMinute = "breaths_per_minute"
}

/// Canonical normalized metric format for all wearable data sources
struct NormalizedMetric: Codable {
    // Identity
    let source: WearableSource
    let metricType: MetricType
    
    // Time window
    let startTime: String  // ISO8601
    let endTime: String    // ISO8601
    let timezone: String?
    
    // Value
    let value: Double
    let unit: MetricUnit
    
    // Optional context
    let confidence: Double?
    let deviceId: String?
    let externalId: String?  // HealthKit sample UUID - CRITICAL for incremental sync
    
    // Source tracking for multi-source filtering
    let sourceBundleId: String?  // e.g., "com.apple.health.XXX"
    let sourceDeviceName: String?  // e.g., "Apple Watch Series 9"
    
    // Sleep-specific: attributed date (wake day for overnight sleep)
    let attributedDate: String?  // YYYY-MM-DD - the day this metric "belongs to" in the UI
    
    // Metadata
    let recordedAt: String?  // ISO8601
    let rawPayload: [String: AnyCodable]?
    
    enum CodingKeys: String, CodingKey {
        case source
        case metricType = "metric_type"
        case startTime = "start_time"
        case endTime = "end_time"
        case timezone
        case value
        case unit
        case confidence
        case deviceId = "device_id"
        case externalId = "external_id"
        case sourceBundleId = "source_bundle_id"
        case sourceDeviceName = "source_device_name"
        case attributedDate = "attributed_date"
        case recordedAt = "recorded_at"
        case rawPayload = "raw_payload"
    }
    
    init(
        source: WearableSource = .appleHealth,
        metricType: MetricType,
        startTime: Date,
        endTime: Date,
        timezone: String? = nil,
        value: Double,
        unit: MetricUnit,
        confidence: Double? = nil,
        deviceId: String? = nil,
        externalId: String? = nil,
        sourceBundleId: String? = nil,
        sourceDeviceName: String? = nil,
        attributedDate: Date? = nil,
        recordedAt: Date? = nil,
        rawPayload: [String: AnyCodable]? = nil
    ) {
        self.source = source
        self.metricType = metricType
        self.startTime = ISO8601DateFormatter().string(from: startTime)
        self.endTime = ISO8601DateFormatter().string(from: endTime)
        self.timezone = timezone ?? TimeZone.current.identifier
        self.value = value
        self.unit = unit
        self.confidence = confidence
        self.deviceId = deviceId
        self.externalId = externalId
        self.sourceBundleId = sourceBundleId
        self.sourceDeviceName = sourceDeviceName
        
        // Format attributed date as YYYY-MM-DD
        if let attrDate = attributedDate {
            let formatter = DateFormatter()
            formatter.dateFormat = "yyyy-MM-dd"
            formatter.timeZone = TimeZone.current
            self.attributedDate = formatter.string(from: attrDate)
        } else {
            self.attributedDate = nil
        }
        
        self.recordedAt = recordedAt.map { ISO8601DateFormatter().string(from: $0) }
        self.rawPayload = rawPayload
    }
}

/// Workout-specific metric with additional details
struct WorkoutMetric: Codable {
    let metric: NormalizedMetric
    let activityType: String  // e.g., "running", "cycling", "strength_training"
    let totalDistance: Double?  // meters
    let totalEnergyBurned: Double?  // kcal
    let averageHeartRate: Double?  // bpm
    let maxHeartRate: Double?  // bpm
    
    enum CodingKeys: String, CodingKey {
        case metric
        case activityType = "activity_type"
        case totalDistance = "total_distance"
        case totalEnergyBurned = "total_energy_burned"
        case averageHeartRate = "average_heart_rate"
        case maxHeartRate = "max_heart_rate"
    }
}

/// Type-erased Codable wrapper for raw_payload
struct AnyCodable: Codable {
    let value: Any
    
    init(_ value: Any) {
        self.value = value
    }
    
    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        
        if let bool = try? container.decode(Bool.self) {
            value = bool
        } else if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let string = try? container.decode(String.self) {
            value = string
        } else if let array = try? container.decode([AnyCodable].self) {
            value = array.map { $0.value }
        } else if let dict = try? container.decode([String: AnyCodable].self) {
            value = dict.mapValues { $0.value }
        } else {
            value = NSNull()
        }
    }
    
    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        
        switch value {
        case let bool as Bool:
            try container.encode(bool)
        case let int as Int:
            try container.encode(int)
        case let double as Double:
            try container.encode(double)
        case let string as String:
            try container.encode(string)
        case let array as [Any]:
            try container.encode(array.map { AnyCodable($0) })
        case let dict as [String: Any]:
            try container.encode(dict.mapValues { AnyCodable($0) })
        default:
            try container.encodeNil()
        }
    }
}
