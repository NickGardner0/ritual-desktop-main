import Foundation

// MARK: - Device Registration

struct DeviceRegisterRequest: Codable {
    let deviceName: String
    let platform: String
    
    enum CodingKeys: String, CodingKey {
        case deviceName = "device_name"
        case platform
    }
}

struct DeviceRegisterResponse: Codable {
    let deviceId: String
    let deviceSecret: String
    let registeredAt: String
    
    enum CodingKeys: String, CodingKey {
        case deviceId = "device_id"
        case deviceSecret = "device_secret"
        case registeredAt = "registered_at"
    }
}

// MARK: - Metrics Ingestion

struct AppleIngestRequest: Codable {
    let deviceId: String
    let clientEventId: String
    let capturedAt: String
    let metrics: [NormalizedMetric]
    let hkAnchor: String?
    let schemaVersion: Int
    let signature: String
    
    enum CodingKeys: String, CodingKey {
        case deviceId = "device_id"
        case clientEventId = "client_event_id"
        case capturedAt = "captured_at"
        case metrics
        case hkAnchor = "hk_anchor"
        case schemaVersion = "schema_version"
        case signature
    }
}

struct AppleIngestResult: Codable {
    let index: Int
    let success: Bool
    let storedId: String?
    let error: String?
    
    enum CodingKeys: String, CodingKey {
        case index
        case success
        case storedId = "stored_id"
        case error
    }
}

struct AppleIngestResponse: Codable {
    let success: Bool
    let results: [AppleIngestResult]
    let serverTime: String
    let nextPollSeconds: Int?
    
    enum CodingKeys: String, CodingKey {
        case success
        case results
        case serverTime = "server_time"
        case nextPollSeconds = "next_poll_seconds"
    }
}

// MARK: - Device Status

struct DeviceStatusResponse: Codable {
    let deviceId: String
    let deviceName: String
    let platform: String
    let registeredAt: String
    let lastSyncAt: String?
    let isActive: Bool
    
    enum CodingKeys: String, CodingKey {
        case deviceId = "device_id"
        case deviceName = "device_name"
        case platform
        case registeredAt = "registered_at"
        case lastSyncAt = "last_sync_at"
        case isActive = "is_active"
    }
}

// MARK: - Error Response

struct APIErrorResponse: Codable {
    let detail: String
}
