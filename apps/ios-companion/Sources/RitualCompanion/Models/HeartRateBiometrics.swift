import Foundation

enum HeartRateSourceType: String, Codable {
    case whoopBLEIOS = "whoop_ble_ios"
    case whoopBLEMac = "whoop_ble_mac"
}

enum HeartRateSyncState: String, Codable {
    case pending
    case synced
    case failed
}

struct HeartRateSample: Codable, Identifiable, Hashable {
    let id: UUID
    let userId: String
    let sourceType: HeartRateSourceType
    let sourceDeviceId: String
    let sessionId: UUID
    let bpmRaw: Int
    let bpmDisplay: Int
    let qualityScore: Double?
    let isOutlier: Bool
    let rrIntervalsMs: [Double]?
    let contactDetected: Bool?
    let receivedAt: Date
    let createdAt: Date
    var syncState: HeartRateSyncState
}

struct HeartRateSession: Codable, Identifiable, Hashable {
    let id: UUID
    let userId: String
    let sourceType: HeartRateSourceType
    let sourceDeviceId: String
    let startedAt: Date
    var endedAt: Date?
    var status: String
    let appVersion: String?
    let deviceModel: String?
}

struct HeartRateLiveSnapshot: Codable, Hashable {
    let currentBpm: Int?
    let currentSourceType: String?
    let latestSampleAt: Date?
    let connectionState: String
    let isStale: Bool
}

struct BLEHeartRateMeasurement: Hashable {
    let bpm: Int
    let rrIntervalsMs: [Double]
    let contactDetected: Bool?
    let receivedAt: Date
}

