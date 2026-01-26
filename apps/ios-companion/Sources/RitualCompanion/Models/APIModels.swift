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

/// V1 request format (legacy - sends all metrics)
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

/// V2 request format - supports incremental sync with added/deleted/modified
struct AppleIngestRequestV2: Codable {
    let deviceId: String
    let clientEventId: String
    let capturedAt: String
    
    /// New/updated metrics since last anchor
    let added: [NormalizedMetric]
    
    /// HealthKit UUIDs of deleted samples
    let deleted: [String]
    
    /// Modified metrics (same external_id, new values) - rare but real
    let modified: [NormalizedMetric]
    
    /// Anchors per metric type after this sync
    let anchors: [String: String]?
    
    let schemaVersion: Int
    let signature: String
    
    enum CodingKeys: String, CodingKey {
        case deviceId = "device_id"
        case clientEventId = "client_event_id"
        case capturedAt = "captured_at"
        case added
        case deleted
        case modified
        case anchors
        case schemaVersion = "schema_version"
        case signature
    }
    
    init(
        deviceId: String,
        clientEventId: String,
        capturedAt: String,
        added: [NormalizedMetric] = [],
        deleted: [String] = [],
        modified: [NormalizedMetric] = [],
        anchors: [String: String]? = nil,
        schemaVersion: Int = 2,
        signature: String
    ) {
        self.deviceId = deviceId
        self.clientEventId = clientEventId
        self.capturedAt = capturedAt
        self.added = added
        self.deleted = deleted
        self.modified = modified
        self.anchors = anchors
        self.schemaVersion = schemaVersion
        self.signature = signature
    }
}

/// Response for V2 ingest - includes anchor confirmation
struct AppleIngestResponseV2: Codable {
    let success: Bool
    let addedResults: [AppleIngestResult]
    let deletedResults: [DeleteResult]
    let modifiedResults: [AppleIngestResult]
    let serverTime: String
    let nextPollSeconds: Int?
    /// Confirmed anchors - only update local anchors after receiving this
    let confirmedAnchors: [String: String]?
    
    enum CodingKeys: String, CodingKey {
        case success
        case addedResults = "added_results"
        case deletedResults = "deleted_results"
        case modifiedResults = "modified_results"
        case serverTime = "server_time"
        case nextPollSeconds = "next_poll_seconds"
        case confirmedAnchors = "confirmed_anchors"
    }
}

/// Result of a deletion operation
struct DeleteResult: Codable {
    let externalId: String
    let success: Bool
    let error: String?
    
    enum CodingKeys: String, CodingKey {
        case externalId = "external_id"
        case success
        case error
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
