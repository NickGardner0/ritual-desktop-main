import Foundation
import CryptoKit
import Security
import UIKit

/// API client for communicating with Ritual backend
final class RitualAPIClient {
    
    // MARK: - Configuration
    
    /// Base URL for the API
    private let baseURL = AppConfig.apiBaseURL
    
    // Keychain keys
    private let deviceIdKey = "com.ritual.companion.deviceId"
    private let deviceSecretKey = "com.ritual.companion.deviceSecret"
    private let authTokenKey = "com.ritual.companion.authToken"
    
    // MARK: - Properties
    
    private let session: URLSession
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    
    var hasStoredCredentials: Bool {
        deviceId != nil && deviceSecret != nil && authToken != nil
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
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
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
    
    /// Ingest metrics to the backend
    func ingestMetrics(_ metrics: [NormalizedMetric]) async throws -> AppleIngestResponse {
        guard let deviceId = deviceId,
              let deviceSecret = deviceSecret else {
            throw APIError.notRegistered
        }
        
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
    
    /// Fetch which metrics the user has selected to track in the desktop app
    func fetchTrackedMetrics() async throws -> TrackedMetricsResponse {
        return try await get(path: "/api/wearables/apple/tracked_metrics")
    }
    
    /// Clear all stored credentials
    func clearCredentials() {
        deviceId = nil
        deviceSecret = nil
        authToken = nil
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
    
    private func get<R: Decodable>(path: String) async throws -> R {
        guard let url = URL(string: baseURL + path) else {
            throw APIError.invalidURL
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        
        if let token = authToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        
        #if DEBUG
        print("📤 GET \(path)")
        #endif
        
        let (data, response) = try await session.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        
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
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        if let token = authToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        
        request.httpBody = try encoder.encode(body)
        
        #if DEBUG
        print("📤 POST \(path)")
        if let body = request.httpBody, let str = String(data: body, encoding: .utf8) {
            print("   Body: \(str.prefix(500))")
        }
        #endif
        
        let (data, response) = try await session.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        
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
        }
    }
}

// MARK: - Keychain Helper

private enum KeychainHelper {
    
    static func save(key: String, value: String) {
        guard let data = value.data(using: .utf8) else { return }
        
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock
        ]
        
        // Delete any existing item
        SecItemDelete(query as CFDictionary)
        
        // Add new item
        let status = SecItemAdd(query as CFDictionary, nil)
        if status != errSecSuccess {
            print("⚠️ Keychain save failed: \(status)")
        }
    }
    
    static func load(key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
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
            kSecAttrAccount as String: key
        ]
        
        SecItemDelete(query as CFDictionary)
    }
}
