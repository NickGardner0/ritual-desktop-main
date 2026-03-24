import Foundation
import CryptoKit
import Security
import UIKit
import Clerk

/// API client for communicating with Ritual backend
final class RitualAPIClient {
    
    // MARK: - Configuration
    
    /// Base URL for the API
    private let baseURL = AppConfig.apiBaseURL
    
    // Keychain keys
    private let deviceIdKey = "com.ritual.companion.deviceId"
    private let deviceSecretKey = "com.ritual.companion.deviceSecret"
    private let screenTimeDeviceIdKey = "com.ritual.companion.screenTimeDeviceId"
    private let screenTimeDeviceSecretKey = "com.ritual.companion.screenTimeDeviceSecret"
    private let authTokenKey = "com.ritual.companion.authToken"
    private let tokenExpiryKey = "com.ritual.companion.tokenExpiry"
    
    // MARK: - Properties
    
    private let session: URLSession
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    
    /// Track consecutive refresh failures
    private var consecutiveRefreshFailures = 0
    private let maxRefreshFailures = 3
    private var refreshTask: Task<Void, Error>?
    
    var hasStoredCredentials: Bool {
        deviceId != nil && deviceSecret != nil && authToken != nil
    }

    var hasStoredScreenTimeCredentials: Bool {
        screenTimeDeviceId != nil && screenTimeDeviceSecret != nil && authToken != nil
    }
    
    /// Check if token is expired or about to expire (within 5 minutes)
    var isTokenExpiredOrExpiring: Bool {
        guard let expiry = tokenExpiry else { return true }
        return expiry.timeIntervalSinceNow < 300 // 5 minutes buffer
    }
    
    private var tokenExpiry: Date? {
        get { UserDefaults.standard.object(forKey: tokenExpiryKey) as? Date }
        set { UserDefaults.standard.set(newValue, forKey: tokenExpiryKey) }
    }
    
    private var deviceId: String? {
        get { KeychainHelper.load(key: deviceIdKey) }
        set { 
            if let value = newValue {
                KeychainHelper.save(key: deviceIdKey, value: value)
            } else {
                KeychainHelper.delete(key: deviceIdKey)
            }
        }
    }
    
    private var deviceSecret: String? {
        get { KeychainHelper.load(key: deviceSecretKey) }
        set {
            if let value = newValue {
                KeychainHelper.save(key: deviceSecretKey, value: value)
            } else {
                KeychainHelper.delete(key: deviceSecretKey)
            }
        }
    }

    private var screenTimeDeviceId: String? {
        get { KeychainHelper.load(key: screenTimeDeviceIdKey) }
        set {
            if let value = newValue {
                KeychainHelper.save(key: screenTimeDeviceIdKey, value: value)
            } else {
                KeychainHelper.delete(key: screenTimeDeviceIdKey)
            }
        }
    }

    private var screenTimeDeviceSecret: String? {
        get { KeychainHelper.load(key: screenTimeDeviceSecretKey) }
        set {
            if let value = newValue {
                KeychainHelper.save(key: screenTimeDeviceSecretKey, value: value)
            } else {
                KeychainHelper.delete(key: screenTimeDeviceSecretKey)
            }
        }
    }
    
    private var authToken: String? {
        get { KeychainHelper.load(key: authTokenKey) }
        set {
            if let value = newValue {
                KeychainHelper.save(key: authTokenKey, value: value)
            } else {
                KeychainHelper.delete(key: authTokenKey)
            }
        }
    }
    
    // MARK: - Initialization
    
    init() {
        let config = URLSessionConfiguration.default
        // Increased timeouts for large batch syncs (125+ batches can take several minutes)
        config.timeoutIntervalForRequest = 120  // 2 minutes per request
        config.timeoutIntervalForResource = 600 // 10 minutes total
        self.session = URLSession(configuration: config)
        
        self.encoder = JSONEncoder()
        // Configure encoder to match Python's json.dumps with sort_keys=True
        self.encoder.outputFormatting = [.sortedKeys]
        
        self.decoder = JSONDecoder()
    }
    
    // MARK: - Public Methods
    
    /// Register this device with the backend
    func registerDevice(authToken: String) async throws {
        self.authToken = authToken
        if let jwtExpiry = decodeJWTExpiry(authToken) {
            tokenExpiry = jwtExpiry
        } else {
            tokenExpiry = Date().addingTimeInterval(3300)
        }
        
        let deviceName = await UIDevice.current.name
        let request = DeviceRegisterRequest(deviceName: deviceName, platform: "ios")
        
        let response: DeviceRegisterResponse = try await post(
            path: "/api/wearables/apple/register_device",
            body: request
        )
        
        // Store credentials in Keychain
        self.deviceId = response.deviceId
        self.deviceSecret = response.deviceSecret
        
        print("✅ Device registered: \(response.deviceId)")
    }
    
    /// Ingest metrics to the backend (V1 - legacy)
    func ingestMetrics(_ metrics: [NormalizedMetric]) async throws -> AppleIngestResponse {
        guard let deviceId = deviceId,
              let deviceSecret = deviceSecret else {
            throw APIError.notRegistered
        }
        
        // Ensure token is valid before making request
        try await ensureValidToken()
        
        let clientEventId = UUID().uuidString
        let capturedAt = ISO8601DateFormatter().string(from: Date())
        
        // Compute signature (excludes metrics due to cross-platform serialization differences)
        let signature = try computeSignature(
            deviceId: deviceId,
            clientEventId: clientEventId,
            capturedAt: capturedAt,
            deviceSecret: deviceSecret
        )
        
        let request = AppleIngestRequest(
            deviceId: deviceId,
            clientEventId: clientEventId,
            capturedAt: capturedAt,
            metrics: metrics,
            hkAnchor: nil,
            schemaVersion: 1,
            signature: signature
        )
        
        return try await post(
            path: "/api/wearables/apple/ingest",
            body: request
        )
    }
    
    /// Ingest metrics to the backend (V2 - incremental with added/deleted/modified)
    func ingestMetricsV2(
        added: [NormalizedMetric],
        deleted: [String],
        modified: [NormalizedMetric],
        anchors: [String: String]? = nil
    ) async throws -> AppleIngestResponseV2 {
        guard let deviceId = deviceId,
              let deviceSecret = deviceSecret else {
            throw APIError.notRegistered
        }
        
        // Ensure token is valid before making request
        try await ensureValidToken()
        
        let clientEventId = UUID().uuidString
        let capturedAt = ISO8601DateFormatter().string(from: Date())
        
        let signature = try computeSignature(
            deviceId: deviceId,
            clientEventId: clientEventId,
            capturedAt: capturedAt,
            deviceSecret: deviceSecret
        )
        
        let request = AppleIngestRequestV2(
            deviceId: deviceId,
            clientEventId: clientEventId,
            capturedAt: capturedAt,
            added: added,
            deleted: deleted,
            modified: modified,
            anchors: anchors,
            schemaVersion: 2,
            signature: signature
        )
        
        return try await post(
            path: "/api/wearables/apple/ingest/v2",
            body: request
        )
    }
    
    // MARK: - Silent Token Refresh
    
    /// Ensure we have a valid token, refreshing silently if needed
    func ensureValidToken() async throws {
        // If token is not expired, we're good
        guard isTokenExpiredOrExpiring else { return }

        if let refreshTask {
            try await refreshTask.value
            return
        }
        
        print("🔄 Token expired or expiring, attempting silent refresh...")

        let task = Task { [weak self] in
            guard let self else { return }
            do {
                try await self.refreshToken()
                self.consecutiveRefreshFailures = 0
                print("✅ Token refreshed successfully")
            } catch {
                self.consecutiveRefreshFailures += 1
                print("❌ Token refresh failed (attempt \(self.consecutiveRefreshFailures)): \(error)")

                if self.consecutiveRefreshFailures >= self.maxRefreshFailures {
                    throw APIError.tokenRefreshFailed
                }

                throw error
            }
        }

        refreshTask = task

        do {
            try await task.value
            refreshTask = nil
        } catch {
            refreshTask = nil
            throw error
        }
    }
    
    /// Refresh the auth token using Clerk session
    private func refreshToken() async throws {
        // Access MainActor-isolated session property
        let session = await MainActor.run { Clerk.shared.session }
        
        guard let session = session else {
            throw APIError.noSession
        }
        
        // Get a fresh token from Clerk
        let tokenResult = try await session.getToken()
        guard let jwt = tokenResult?.jwt, !jwt.isEmpty else {
            throw APIError.tokenRefreshFailed
        }
        
        // Update stored token
        authToken = jwt
        
        // Derive token expiry from JWT exp claim when available.
        if let jwtExpiry = decodeJWTExpiry(jwt) {
            tokenExpiry = jwtExpiry
        } else {
            // Safe fallback if token payload parsing fails.
            tokenExpiry = Date().addingTimeInterval(3300)
        }
    }
    
    /// Check if Clerk session is valid and token can be refreshed
    @MainActor
    func canRefreshToken() -> Bool {
        return Clerk.shared.session != nil
    }
    
    /// Fetch which metrics the user has selected to track in the desktop app
    func fetchTrackedMetrics() async throws -> TrackedMetricsResponse {
        return try await get(path: "/api/wearables/apple/tracked_metrics")
    }

    func registerScreenTimeDevice(authToken: String) async throws {
        self.authToken = authToken
        if let jwtExpiry = decodeJWTExpiry(authToken) {
            tokenExpiry = jwtExpiry
        } else {
            tokenExpiry = Date().addingTimeInterval(3300)
        }

        let deviceName = await UIDevice.current.name
        let request = DeviceRegisterRequest(deviceName: deviceName, platform: "ios")

        let response: DeviceRegisterResponse = try await post(
            path: "/api/screen-time/register_device",
            body: request
        )

        screenTimeDeviceId = response.deviceId
        screenTimeDeviceSecret = response.deviceSecret
    }

    func ingestScreenTimeRollups(_ rollups: [ScreenTimeRollupRequest]) async throws -> ScreenTimeIngestResponse {
        guard let deviceId = screenTimeDeviceId,
              let deviceSecret = screenTimeDeviceSecret else {
            throw APIError.notRegistered
        }

        try await ensureValidToken()

        let clientEventId = UUID().uuidString
        let capturedAt = ISO8601DateFormatter().string(from: Date())
        let signature = try computeSignature(
            deviceId: deviceId,
            clientEventId: clientEventId,
            capturedAt: capturedAt,
            deviceSecret: deviceSecret
        )

        let request = ScreenTimeIngestRequest(
            deviceId: deviceId,
            clientEventId: clientEventId,
            capturedAt: capturedAt,
            rollups: rollups,
            schemaVersion: 1,
            signature: signature
        )

        return try await post(
            path: "/api/screen-time/ingest",
            body: request
        )
    }

    func createHeartRateSession(_ session: HeartRateSession) async throws -> HeartRateSessionResponse {
        try await ensureValidToken()

        let formatter = ISO8601DateFormatter()
        let request = HeartRateSessionCreateRequest(
            id: session.id.uuidString,
            sourceType: session.sourceType.rawValue,
            sourceDeviceId: session.sourceDeviceId,
            startedAt: formatter.string(from: session.startedAt),
            status: session.status,
            appVersion: session.appVersion,
            deviceModel: session.deviceModel
        )

        return try await post(
            path: "/api/v1/biometrics/heart-rate/sessions",
            body: request
        )
    }

    func endHeartRateSession(sessionId: UUID, endedAt: Date) async throws -> HeartRateSessionResponse {
        try await ensureValidToken()

        let formatter = ISO8601DateFormatter()
        let request = HeartRateSessionEndRequest(
            endedAt: formatter.string(from: endedAt),
            status: "ended"
        )

        return try await patch(
            path: "/api/v1/biometrics/heart-rate/sessions/\(sessionId.uuidString)/end",
            body: request
        )
    }

    func uploadHeartRateSamples(_ samples: [HeartRateSample]) async throws -> HeartRateBatchUploadResponse {
        try await ensureValidToken()

        let formatter = ISO8601DateFormatter()
        let payload = HeartRateSampleBatchUploadRequest(
            samples: samples.map { sample in
                HeartRateSampleUploadRequest(
                    id: sample.id.uuidString,
                    sessionId: sample.sessionId.uuidString,
                    sourceType: sample.sourceType.rawValue,
                    sourceDeviceId: sample.sourceDeviceId,
                    bpmRaw: sample.bpmRaw,
                    bpmDisplay: sample.bpmDisplay,
                    qualityScore: sample.qualityScore,
                    isOutlier: sample.isOutlier,
                    rrIntervalsMs: sample.rrIntervalsMs,
                    contactDetected: sample.contactDetected,
                    receivedAt: formatter.string(from: sample.receivedAt)
                )
            }
        )

        return try await post(
            path: "/api/v1/biometrics/heart-rate/samples:batch",
            body: payload
        )
    }

    func fetchLiveBiometrics() async throws -> LiveBiometricsResponse {
        try await ensureValidToken()
        return try await get(path: "/api/v1/biometrics/live")
    }
    
    /// Clear all stored credentials
    func clearCredentials() {
        deviceId = nil
        deviceSecret = nil
        screenTimeDeviceId = nil
        screenTimeDeviceSecret = nil
        authToken = nil
        tokenExpiry = nil
    }

    // MARK: - JWT Helpers

    /// Decode JWT payload and extract exp as an absolute date.
    private func decodeJWTExpiry(_ jwt: String) -> Date? {
        let segments = jwt.split(separator: ".")
        guard segments.count > 1 else { return nil }

        var payload = String(segments[1])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")

        let remainder = payload.count % 4
        if remainder > 0 {
            payload += String(repeating: "=", count: 4 - remainder)
        }

        guard let data = Data(base64Encoded: payload),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }

        if let exp = json["exp"] as? TimeInterval {
            return Date(timeIntervalSince1970: exp)
        }
        if let expInt = json["exp"] as? Int {
            return Date(timeIntervalSince1970: TimeInterval(expInt))
        }
        return nil
    }
    
    // MARK: - Signature Computation
    
    /// Compute HMAC-SHA256 signature for request
    /// Note: We intentionally exclude metrics from the signature because float serialization
    /// differs between iOS (259) and Python (259.0). The signature still provides security
    /// via device_secret verification, and captured_at provides replay protection.
    private func computeSignature(
        deviceId: String,
        clientEventId: String,
        capturedAt: String,
        deviceSecret: String
    ) throws -> String {
        // Build canonical string (excludes metrics due to cross-platform serialization differences)
        let canonicalString = "\(deviceId)\n\(clientEventId)\n\(capturedAt)"
        
        #if DEBUG
        print("📝 Canonical string: \(canonicalString)")
        #endif
        
        // Decode device secret from base64
        guard let secretData = Data(base64Encoded: deviceSecret) else {
            throw APIError.invalidSecret
        }
        
        // Compute HMAC-SHA256
        let key = SymmetricKey(data: secretData)
        let signature = HMAC<SHA256>.authenticationCode(for: Data(canonicalString.utf8), using: key)
        
        let signatureB64 = Data(signature).base64EncodedString()
        
        #if DEBUG
        print("📝 Computed signature: \(signatureB64)")
        #endif
        
        // Return base64-encoded signature
        return signatureB64
    }
    
    // MARK: - HTTP Methods

    private func mapTransportError(_ error: Error) -> Error {
        if let apiError = error as? APIError {
            return apiError
        }

        if let urlError = error as? URLError {
            switch urlError.code {
            case .notConnectedToInternet,
                 .networkConnectionLost,
                 .cannotFindHost,
                 .cannotConnectToHost,
                 .dnsLookupFailed,
                 .timedOut,
                 .internationalRoamingOff,
                 .dataNotAllowed,
                 .callIsActive:
                return APIError.networkUnavailable
            default:
                break
            }
        }

        return error
    }

    private func authorizedRequest(url: URL, method: String, contentType: String? = nil) -> URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        if let contentType {
            request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        }

        if let token = authToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        return request
    }

    private func performRequest(_ request: URLRequest, retryOnUnauthorized: Bool = true) async throws -> (Data, HTTPURLResponse) {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw mapTransportError(error)
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        if httpResponse.statusCode == 401 && retryOnUnauthorized && authToken != nil {
            try await refreshToken()
            var retryRequest = request
            if let refreshedToken = authToken {
                retryRequest.setValue("Bearer \(refreshedToken)", forHTTPHeaderField: "Authorization")
            } else {
                retryRequest.setValue(nil, forHTTPHeaderField: "Authorization")
            }
            return try await performRequest(retryRequest, retryOnUnauthorized: false)
        }

        return (data, httpResponse)
    }
    
    private func get<R: Decodable>(path: String) async throws -> R {
        guard let url = URL(string: baseURL + path) else {
            throw APIError.invalidURL
        }

        let request = authorizedRequest(url: url, method: "GET")
        
        #if DEBUG
        print("📤 GET \(path)")
        #endif

        let (data, httpResponse) = try await performRequest(request)
        
        #if DEBUG
        print("📥 Response: \(httpResponse.statusCode)")
        if let str = String(data: data, encoding: .utf8) {
            print("   Body: \(str.prefix(500))")
        }
        #endif
        
        guard 200..<300 ~= httpResponse.statusCode else {
            if let errorResponse = try? decoder.decode(APIErrorResponse.self, from: data) {
                throw APIError.serverError(httpResponse.statusCode, errorResponse.detail)
            }
            throw APIError.httpError(httpResponse.statusCode)
        }
        
        return try decoder.decode(R.self, from: data)
    }
    
    private func post<T: Encodable, R: Decodable>(path: String, body: T) async throws -> R {
        guard let url = URL(string: baseURL + path) else {
            throw APIError.invalidURL
        }

        var request = authorizedRequest(url: url, method: "POST", contentType: "application/json")
        request.httpBody = try encoder.encode(body)
        
        #if DEBUG
        print("📤 POST \(path)")
        if let body = request.httpBody, let str = String(data: body, encoding: .utf8) {
            print("   Body: \(str.prefix(500))")
        }
        #endif

        let (data, httpResponse) = try await performRequest(request)
        
        #if DEBUG
        print("📥 Response: \(httpResponse.statusCode)")
        if let str = String(data: data, encoding: .utf8) {
            print("   Body: \(str.prefix(500))")
        }
        #endif
        
        guard 200..<300 ~= httpResponse.statusCode else {
            if let errorResponse = try? decoder.decode(APIErrorResponse.self, from: data) {
                throw APIError.serverError(httpResponse.statusCode, errorResponse.detail)
            }
            throw APIError.httpError(httpResponse.statusCode)
        }
        
        return try decoder.decode(R.self, from: data)
    }

    private func patch<T: Encodable, R: Decodable>(path: String, body: T) async throws -> R {
        guard let url = URL(string: baseURL + path) else {
            throw APIError.invalidURL
        }

        var request = authorizedRequest(url: url, method: "PATCH", contentType: "application/json")
        request.httpBody = try encoder.encode(body)

        let (data, httpResponse) = try await performRequest(request)

        guard 200..<300 ~= httpResponse.statusCode else {
            if let errorResponse = try? decoder.decode(APIErrorResponse.self, from: data) {
                throw APIError.serverError(httpResponse.statusCode, errorResponse.detail)
            }
            throw APIError.httpError(httpResponse.statusCode)
        }

        return try decoder.decode(R.self, from: data)
    }
}

// MARK: - Tracked Metrics Response

struct TrackedMetricsResponse: Decodable {
    let metricTypes: [String]
    let habits: [TrackedHabit]
    
    enum CodingKeys: String, CodingKey {
        case metricTypes = "metric_types"
        case habits
    }
}

struct TrackedHabit: Decodable {
    let id: String
    let name: String
    let metricType: String
    let unitType: String?
    
    enum CodingKeys: String, CodingKey {
        case id, name
        case metricType = "metric_type"
        case unitType = "unit_type"
    }
}

// MARK: - API Errors

enum APIError: LocalizedError {
    case invalidURL
    case invalidResponse
    case httpError(Int)
    case serverError(Int, String)
    case notRegistered
    case invalidSecret
    case tokenRefreshFailed
    case noSession
    case networkUnavailable
    
    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid API URL"
        case .invalidResponse:
            return "Invalid response from server"
        case .httpError(let code):
            return "HTTP error: \(code)"
        case .serverError(_, let message):
            return message
        case .notRegistered:
            return "Device not registered"
        case .invalidSecret:
            return "Invalid device secret"
        case .tokenRefreshFailed:
            return "Failed to refresh authentication. Please sign in again."
        case .noSession:
            return "No active session. Please sign in."
        case .networkUnavailable:
            return "Network unavailable. Will retry when connection is restored."
        }
    }
    
    /// Whether this error should trigger queuing for later retry
    var shouldQueue: Bool {
        switch self {
        case .networkUnavailable:
            return true
        case .httpError(let code) where code >= 500:
            return true
        default:
            return false
        }
    }
    
    /// Whether this error means the user needs to re-authenticate
    var requiresReauth: Bool {
        switch self {
        case .tokenRefreshFailed, .noSession, .httpError(401):
            return true
        default:
            return false
        }
    }
}

// MARK: - Keychain Helper

private enum KeychainHelper {
    private static let service = "com.ritual.companion"
    
    static func save(key: String, value: String) {
        guard let data = value.data(using: .utf8) else { return }
        
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock
        ]

        let attributes: [String: Any] = [
            kSecValueData as String: data
        ]

        let existingStatus = SecItemCopyMatching(query as CFDictionary, nil)
        let status: OSStatus

        if existingStatus == errSecSuccess {
            status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        } else {
            var createQuery = query
            createQuery[kSecValueData as String] = data
            status = SecItemAdd(createQuery as CFDictionary, nil)
        }

        if status != errSecSuccess {
            print("⚠️ Keychain save failed: \(status)")
        }
    }
    
    static func load(key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        
        guard status == errSecSuccess,
              let data = result as? Data,
              let value = String(data: data, encoding: .utf8) else {
            return nil
        }
        
        return value
    }
    
    static func delete(key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]
        
        SecItemDelete(query as CFDictionary)
    }
}
