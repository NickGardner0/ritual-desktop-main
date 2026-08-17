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

struct ScreenTimeRollupRequest: Codable {
    let day: String
    let timezone: String?
    let breakdownKind: String
    let entityKey: String
    let entityLabel: String
    let activeSeconds: Int
    let sortSeconds: Int?
    let metadataJSON: [String: String]?

    enum CodingKeys: String, CodingKey {
        case day
        case timezone
        case breakdownKind = "breakdown_kind"
        case entityKey = "entity_key"
        case entityLabel = "entity_label"
        case activeSeconds = "active_seconds"
        case sortSeconds = "sort_seconds"
        case metadataJSON = "metadata_json"
    }
}

struct ScreenTimeIngestRequest: Codable {
    let deviceId: String
    let clientEventId: String
    let capturedAt: String
    let rollups: [ScreenTimeRollupRequest]
    let schemaVersion: Int
    let signature: String

    enum CodingKeys: String, CodingKey {
        case deviceId = "device_id"
        case clientEventId = "client_event_id"
        case capturedAt = "captured_at"
        case rollups
        case schemaVersion = "schema_version"
        case signature
    }
}

struct ScreenTimeIngestResult: Codable {
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

struct ScreenTimeIngestResponse: Codable {
    let success: Bool
    let results: [ScreenTimeIngestResult]
    let serverTime: String

    enum CodingKeys: String, CodingKey {
        case success
        case results
        case serverTime = "server_time"
    }
}

// MARK: - Metrics Ingestion

enum AppleIngestOutcome: String, Codable {
    case accepted
    case duplicate
    case rejected
}

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
    
    /// External IDs that should be removed from canonical wearable storage.
    /// For daily reconciliation these are stable rollup IDs like
    /// daily_steps_2026-02-26, not only raw HealthKit UUIDs.
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

// MARK: - Apple Sync Telemetry

struct AppleSyncTelemetryEvent: Codable {
    let eventType: String
    let timestamp: String
    let taskType: String?
    let metricType: String?
    let success: Bool?
    let recordCount: Int?
    let durationMs: Int?
    let windowDays: Int?
    let errorMessage: String?
    let queuePendingCount: Int?
    let queueReadyCount: Int?
    let queuedMetricCount: Int?
    let metadata: [String: AnyCodable]?

    enum CodingKeys: String, CodingKey {
        case eventType = "event_type"
        case timestamp
        case taskType = "task_type"
        case metricType = "metric_type"
        case success
        case recordCount = "record_count"
        case durationMs = "duration_ms"
        case windowDays = "window_days"
        case errorMessage = "error_message"
        case queuePendingCount = "queue_pending_count"
        case queueReadyCount = "queue_ready_count"
        case queuedMetricCount = "queued_metric_count"
        case metadata
    }

    init(
        eventType: String,
        timestamp: Date = Date(),
        taskType: String? = nil,
        metricType: String? = nil,
        success: Bool? = nil,
        recordCount: Int? = nil,
        durationMs: Int? = nil,
        windowDays: Int? = nil,
        errorMessage: String? = nil,
        queuePendingCount: Int? = nil,
        queueReadyCount: Int? = nil,
        queuedMetricCount: Int? = nil,
        metadata: [String: AnyCodable]? = nil
    ) {
        self.eventType = eventType
        self.timestamp = ISO8601DateFormatter().string(from: timestamp)
        self.taskType = taskType
        self.metricType = metricType
        self.success = success
        self.recordCount = recordCount
        self.durationMs = durationMs
        self.windowDays = windowDays
        self.errorMessage = errorMessage
        self.queuePendingCount = queuePendingCount
        self.queueReadyCount = queueReadyCount
        self.queuedMetricCount = queuedMetricCount
        self.metadata = metadata
    }
}

struct AppleSyncTelemetryRequest: Codable {
    let deviceId: String?
    let platform: String
    let sdkVersion: String?
    let events: [AppleSyncTelemetryEvent]

    enum CodingKeys: String, CodingKey {
        case deviceId = "device_id"
        case platform
        case sdkVersion = "sdk_version"
        case events
    }
}

/// Response for V2 ingest - includes anchor confirmation
struct AppleIngestResponseV2: Codable {
    let success: Bool
    let outcome: AppleIngestOutcome?
    let errorCode: String?
    let addedResults: [AppleIngestResult]
    let deletedResults: [DeleteResult]
    let modifiedResults: [AppleIngestResult]
    let serverTime: String
    let nextPollSeconds: Int?
    /// Confirmed anchors - only update local anchors after receiving this
    let confirmedAnchors: [String: String]?
    
    enum CodingKeys: String, CodingKey {
        case success
        case outcome
        case errorCode = "error_code"
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
    let outcome: AppleIngestOutcome?
    let errorCode: String?
    let results: [AppleIngestResult]
    let serverTime: String
    let nextPollSeconds: Int?
    
    enum CodingKeys: String, CodingKey {
        case success
        case outcome
        case errorCode = "error_code"
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

// MARK: - Biometrics / WHOOP BLE

struct HeartRateSessionCreateRequest: Codable {
    let id: String
    let sourceType: String
    let sourceDeviceId: String
    let startedAt: String
    let status: String
    let appVersion: String?
    let deviceModel: String?

    enum CodingKeys: String, CodingKey {
        case id
        case sourceType = "source_type"
        case sourceDeviceId = "source_device_id"
        case startedAt = "started_at"
        case status
        case appVersion = "app_version"
        case deviceModel = "device_model"
    }
}

struct HeartRateSessionEndRequest: Codable {
    let endedAt: String
    let status: String

    enum CodingKeys: String, CodingKey {
        case endedAt = "ended_at"
        case status
    }
}

struct HeartRateSessionResponse: Codable {
    let id: String
    let userId: String
    let sourceType: String
    let sourceDeviceId: String
    let status: String
    let startedAt: String
    let endedAt: String?
    let appVersion: String?
    let deviceModel: String?

    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case sourceType = "source_type"
        case sourceDeviceId = "source_device_id"
        case status
        case startedAt = "started_at"
        case endedAt = "ended_at"
        case appVersion = "app_version"
        case deviceModel = "device_model"
    }
}

struct HeartRateSampleUploadRequest: Codable {
    let id: String
    let sessionId: String
    let sourceType: String
    let sourceDeviceId: String
    let bpmRaw: Int
    let bpmDisplay: Int
    let qualityScore: Double?
    let isOutlier: Bool
    let rrIntervalsMs: [Double]?
    let contactDetected: Bool?
    let receivedAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case sessionId = "session_id"
        case sourceType = "source_type"
        case sourceDeviceId = "source_device_id"
        case bpmRaw = "bpm_raw"
        case bpmDisplay = "bpm_display"
        case qualityScore = "quality_score"
        case isOutlier = "is_outlier"
        case rrIntervalsMs = "rr_intervals_ms"
        case contactDetected = "contact_detected"
        case receivedAt = "received_at"
    }
}

struct HeartRateSampleBatchUploadRequest: Codable {
    let samples: [HeartRateSampleUploadRequest]
}

struct LiveBiometricsResponse: Codable {
    let currentBpm: Int?
    let currentSourceType: String?
    let latestSampleAt: String?
    let connectionState: String
    let isStale: Bool

    enum CodingKeys: String, CodingKey {
        case currentBpm = "current_bpm"
        case currentSourceType = "current_source_type"
        case latestSampleAt = "latest_sample_at"
        case connectionState = "connection_state"
        case isStale = "is_stale"
    }
}

struct HeartRateBatchUploadResponse: Codable {
    let success: Bool
    let insertedCount: Int
    let duplicateCount: Int
    let rollupBucketsUpdated: Int
    let live: LiveBiometricsResponse

    enum CodingKeys: String, CodingKey {
        case success
        case insertedCount = "inserted_count"
        case duplicateCount = "duplicate_count"
        case rollupBucketsUpdated = "rollup_buckets_updated"
        case live
    }
}

// MARK: - Error Response

struct APIErrorResponse: Codable {
    let detail: String
}
