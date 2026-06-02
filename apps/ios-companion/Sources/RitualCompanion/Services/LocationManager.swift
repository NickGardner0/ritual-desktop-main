import CoreLocation
import Combine
import Foundation
import OSLog
import UIKit

/// Drives iPhone location tracking for the Ritual habit-log enrichment pipeline.
///
/// Architecture:
/// - Uses `startMonitoringSignificantLocationChanges` (SCLS) as primary signal.
///   SCLS fires when the device moves ~500m / changes cell towers. It can
///   wake the app from termination on iOS.
/// - Falls back to one-shot `requestLocation()` calls for on-demand fixes
///   (e.g. when the user opens the app — guarantees a fresh ping even if
///   they haven't moved).
/// - All fixes flow through a disk-backed outbox that flushes opportunistically.
///
/// Permissions: requires "Always" authorization for background SCLS to work
/// across app launches. "While Using" works only when app is foregrounded.
@MainActor
final class LocationManager: NSObject, ObservableObject {
    static let shared = LocationManager()

    // MARK: - Published state (observable from SwiftUI)

    @Published private(set) var authorizationStatus: CLAuthorizationStatus = .notDetermined
    @Published private(set) var lastKnownLocation: CLLocation?
    @Published private(set) var lastFlushAt: Date?
    @Published private(set) var pendingCount: Int = 0
    @Published private(set) var isMonitoringSCLS: Bool = false
    @Published private(set) var isEnabled: Bool = UserDefaults.standard.bool(forKey: enabledKey)

    // MARK: - Private state

    private let logger = Logger(subsystem: "com.ritual.companion", category: "LocationManager")
    private let locationManager = CLLocationManager()
    private let outbox = LocationPingOutbox()
    private let api: RitualAPIClient
    private static let enabledKey = "ritual_location_enabled"
    private var pendingOneShotRequests = 0

    private var isPaused: Bool {
        !isEnabled || UserDefaults.standard.bool(forKey: "ritual_location_paused")
    }

    // MARK: - Init

    init(api: RitualAPIClient = .shared) {
        self.api = api
        super.init()
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        locationManager.allowsBackgroundLocationUpdates = true
        locationManager.pausesLocationUpdatesAutomatically = false
        authorizationStatus = locationManager.authorizationStatus

        if isEnabled && authorizationStatus == .authorizedAlways {
            startMonitoring()
        }

        // Refresh the published pending count on init
        Task { await refreshPendingCount() }
    }

    // MARK: - Public API

    /// Request location permission. Escalates from notDetermined → whileInUse → always
    /// in two prompts (iOS doesn't allow asking for Always directly).
    func requestAuthorization() {
        guard isEnabled else { return }
        switch authorizationStatus {
        case .notDetermined:
            logger.info("Requesting WhenInUse authorization")
            locationManager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse:
            logger.info("Escalating to Always authorization")
            locationManager.requestAlwaysAuthorization()
        case .authorizedAlways:
            startMonitoring()
        case .denied, .restricted:
            logger.warning("Location authorization denied/restricted — feature disabled")
        @unknown default:
            break
        }
    }

    /// Begin monitoring significant location changes. No-op if SCLS already on
    /// or if location services unavailable.
    func startMonitoring() {
        guard CLLocationManager.significantLocationChangeMonitoringAvailable() else {
            logger.error("SCLS not available on this device")
            return
        }
        guard !isMonitoringSCLS else { return }
        locationManager.startMonitoringSignificantLocationChanges()
        isMonitoringSCLS = true
        logger.info("Started SCLS monitoring")
    }

    /// Stop SCLS. Idempotent.
    func stopMonitoring() {
        locationManager.stopMonitoringSignificantLocationChanges()
        isMonitoringSCLS = false
        logger.info("Stopped SCLS monitoring")
    }

    /// Request a one-shot location fix. Useful when the user opens the app
    /// — guarantees a fresh ping even if they haven't moved enough for SCLS.
    func requestOneShot() {
        guard isEnabled else { return }
        guard authorizationStatus == .authorizedAlways || authorizationStatus == .authorizedWhenInUse else {
            return
        }
        pendingOneShotRequests += 1
        locationManager.requestLocation()
    }

    /// Manually trigger an outbox flush. Used by Settings UI "Sync now" button.
    func flushNow() {
        Task {
            let flushed = await outbox.flush(via: api)
            await MainActor.run {
                self.lastFlushAt = Date()
            }
            await refreshPendingCount()
            logger.info("Manual flush submitted \(flushed) pings")
        }
    }

    var statusText: String {
        if !isEnabled {
            return "Tap to enable place tagging"
        }
        switch authorizationStatus {
        case .authorizedAlways:
            return isMonitoringSCLS ? "Background place tagging is on" : "Enabled"
        case .authorizedWhenInUse:
            return "Allow Always access for background tagging"
        case .notDetermined:
            return "Permission not requested"
        case .denied, .restricted:
            return "Permission denied"
        @unknown default:
            return "Unknown permission status"
        }
    }

    func enableTracking() {
        UserDefaults.standard.set(true, forKey: Self.enabledKey)
        isEnabled = true
        requestAuthorization()
    }

    func disableTracking() {
        UserDefaults.standard.set(false, forKey: Self.enabledKey)
        isEnabled = false
        stopMonitoring()
    }

    func resumeIfEnabled() {
        guard isEnabled else { return }
        if authorizationStatus == .authorizedAlways {
            startMonitoring()
        } else if authorizationStatus == .authorizedWhenInUse {
            requestOneShot()
        }
    }

    // MARK: - Internal helpers

    private func handleNewLocation(_ loc: CLLocation, fromSCLS: Bool) async {
        guard !isPaused else {
            logger.debug("Location tracking paused; dropping fix")
            return
        }

        let ping = LocationPing(
            lat: loc.coordinate.latitude,
            lon: loc.coordinate.longitude,
            horizontalAccuracyM: loc.horizontalAccuracy >= 0 ? loc.horizontalAccuracy : nil,
            source: fromSCLS ? "ios_scls" : "ios_one_shot",
            deviceId: Self.deviceIdentifier,
            clientTs: Int(loc.timestamp.timeIntervalSince1970 * 1000),
            clientEventId: UUID().uuidString
        )

        await outbox.enqueue(ping)
        let flushed = await outbox.flush(via: api)
        await MainActor.run {
            self.lastFlushAt = Date()
        }
        await refreshPendingCount()
        if flushed > 0 {
            logger.debug("Submitted \(flushed) pings after new fix")
        }
    }

    private func refreshPendingCount() async {
        let n = await outbox.count()
        await MainActor.run {
            self.pendingCount = n
        }
    }

    /// Stable device identifier for backend attribution. iOS doesn't expose
    /// a hardware UUID to third parties; identifierForVendor is per-vendor
    /// and stable across app launches but resets on uninstall — that's
    /// acceptable for our use case.
    private static var deviceIdentifier: String? {
        return UIDevice.current.identifierForVendor?.uuidString
    }
}

// MARK: - CLLocationManagerDelegate

extension LocationManager: CLLocationManagerDelegate {
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            self.authorizationStatus = manager.authorizationStatus
            self.logger.info("Authorization changed: \(manager.authorizationStatus.rawValue)")
            switch manager.authorizationStatus {
            case .authorizedWhenInUse:
                if self.isEnabled {
                    manager.requestAlwaysAuthorization()
                }
            case .authorizedAlways:
                if self.isEnabled {
                    self.startMonitoring()
                    // Get an immediate fix on first grant
                    self.requestOneShot()
                }
            default:
                break
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        Task { @MainActor in
            self.lastKnownLocation = loc
            let fromSCLS: Bool
            if self.pendingOneShotRequests > 0 {
                self.pendingOneShotRequests -= 1
                fromSCLS = false
            } else {
                fromSCLS = self.isMonitoringSCLS
            }
            await self.handleNewLocation(loc, fromSCLS: fromSCLS)
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in
            if self.pendingOneShotRequests > 0 {
                self.pendingOneShotRequests -= 1
            }
            self.logger.error("Location error: \(error.localizedDescription, privacy: .public)")
        }
    }
}
