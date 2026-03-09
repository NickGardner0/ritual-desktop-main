import Foundation
import UserNotifications

enum SyncActionRequiredReason: String, Codable {
    case authExpired
    case networkQueued
    case partialFailure
    case noMetricsConfigured
}

extension Notification.Name {
    static let syncActionRequired = Notification.Name("SyncActionRequired")
    static let syncRetryCompleted = Notification.Name("SyncRetryCompleted")
}

@MainActor
final class NotificationManager {
    static let shared = NotificationManager()

    private let center = UNUserNotificationCenter.current()
    private let requestedKey = "SyncNotifications.permissionRequested"

    private init() {}

    func requestPermissionsIfNeeded() async -> Bool {
        if UserDefaults.standard.bool(forKey: requestedKey) {
            let settings = await center.notificationSettings()
            return settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
        }

        do {
            let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])
            UserDefaults.standard.set(true, forKey: requestedKey)
            return granted
        } catch {
            return false
        }
    }

    func sendActionRequired(_ reason: SyncActionRequiredReason, message: String? = nil) {
        let content = UNMutableNotificationContent()
        switch reason {
        case .authExpired:
            content.title = "Sign-In Required"
            content.body = message ?? "Ritual needs you to sign in again to continue syncing."
        case .networkQueued:
            content.title = "Sync Delayed"
            content.body = message ?? "Network is unavailable. Data is queued and will retry automatically."
        case .partialFailure:
            content.title = "Sync Needs Attention"
            content.body = message ?? "Some days failed to sync. Open Ritual to retry failed dates."
        case .noMetricsConfigured:
            content.title = "No Metrics Selected"
            content.body = message ?? "Select Apple Health metrics in Ritual desktop to enable sync."
        }
        enqueue(content: content)
    }

    func sendRetryCompleted(remainingFailedDays: Int, syncedMetricCount: Int) {
        guard remainingFailedDays > 0 else { return }

        let content = UNMutableNotificationContent()
        content.title = "Retry Partially Completed"
        content.body = "Synced \(syncedMetricCount) metrics. \(remainingFailedDays) day(s) still need retry."
        enqueue(content: content)
    }

    private func enqueue(content: UNMutableNotificationContent) {
        Task {
            let settings = await center.notificationSettings()
            guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else {
                return
            }

            let request = UNNotificationRequest(
                identifier: UUID().uuidString,
                content: content,
                trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
            )
            do {
                try await center.add(request)
            } catch {
                print("⚠️ Failed to send notification: \(error.localizedDescription)")
            }
        }
    }
}
