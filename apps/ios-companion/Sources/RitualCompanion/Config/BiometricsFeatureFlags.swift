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
