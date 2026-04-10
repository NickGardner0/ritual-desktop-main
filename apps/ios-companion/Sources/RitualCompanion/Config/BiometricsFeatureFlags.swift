import Foundation

enum BiometricsConfig {
    static let hrMinBPM = 30
    static let hrMaxBPM = 220
    static let maxJumpPerSecond = 35
    static let displayEMAAlpha = 0.35
    static let uploadBatchSize = 12
    static let uploadIntervalSeconds = 2.0
    static let restorationIdentifier = "com.ritual.companion.ble.central"
}

/// User-facing feature flags for the companion app. These are compile-time
/// constants for now; flip to runtime-configurable once we introduce a
/// dashboard-controlled flag service.
enum CompanionFeatureFlags {
    /// When true, HabitMappingResolver runs after each successful sync to
    /// translate HealthKit metrics into Ritual habit logs per user-configured
    /// mappings. Safe to leave on: no-op when the user has zero mappings.
    static let habitMappingEnabled = true

    /// Reserved for Stage 2 (scheduled background export). Off until the new
    /// BGTask identifier is added to Info.plist and Apple has approved it.
    static let scheduledExportEnabled = false

    /// Reserved for Stage 3 (direct iPhone↔Mac P2P sync over Multipeer
    /// Connectivity). Off until the multicast networking entitlement is granted.
    static let p2pSyncEnabled = false
}
