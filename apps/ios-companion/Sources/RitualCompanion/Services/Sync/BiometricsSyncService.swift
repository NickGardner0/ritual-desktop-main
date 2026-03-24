import Foundation

actor BiometricsSyncService {
    func createHeartRateSession(_ session: HeartRateSession) async throws {
        // WHOOP live heart-rate broadcasting is currently local-only to the companion app.
        // Keep the desktop/backend path disabled until the product flow is reintroduced.
    }

    func endHeartRateSession(sessionId: UUID, endedAt: Date = Date()) async throws {
        // Intentionally no-op while backend live biometrics sync is disabled.
    }

    func uploadHeartRateSamples(_ samples: [HeartRateSample]) async throws {
        guard !samples.isEmpty else { return }
        // Intentionally no-op while backend live biometrics sync is disabled.
    }
}
