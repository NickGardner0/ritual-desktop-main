import Foundation

/// A single location report from this iPhone to the backend.
///
/// Coding keys match the backend's `services/location/models.LocationPing`
/// Pydantic schema exactly. Do not rename without updating the backend.
struct LocationPing: Codable, Equatable {
    let lat: Double
    let lon: Double
    let horizontalAccuracyM: Double?
    let source: String  // "ios_scls" or "ios_one_shot"
    let deviceId: String?
    let clientTs: Int   // ms since Unix epoch
    let clientEventId: String

    enum CodingKeys: String, CodingKey {
        case lat
        case lon
        case source
        case horizontalAccuracyM = "horizontal_accuracy_m"
        case deviceId = "device_id"
        case clientTs = "client_ts"
        case clientEventId = "client_event_id"
    }
}

/// Request body shape for `POST /api/user/location-pings`.
struct LocationPingBatch: Codable {
    let pings: [LocationPing]
}

/// Response shape from the ingest endpoint.
struct LocationPingIngestResponse: Codable {
    let accepted: Int
    let rejected: Int
    let duplicates: Int
}
