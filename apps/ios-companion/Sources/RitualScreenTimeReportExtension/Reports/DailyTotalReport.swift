import DeviceActivity
import RitualScreenTimeShared
import SwiftUI

struct DailyTotalReport: DeviceActivityReportScene {
    let context: DeviceActivityReport.Context = .dailyTotal
    let content: (ScreenTimeReportConfiguration) -> ScreenTimeReportContentView

    init() {
        self.content = { ScreenTimeReportContentView(configuration: $0) }
    }

    func makeConfiguration(representing data: DeviceActivityResults<DeviceActivityData>) async -> ScreenTimeReportConfiguration {
        let snapshot = ScreenTimeSnapshot(
            day: DateFormatter.screenTimeDayFormatter.string(from: Date()),
            timezone: TimeZone.current.identifier,
            totalSeconds: 0
        )
        try? ScreenTimeSharedStore.shared.saveSnapshot(snapshot)
        return ScreenTimeReportConfiguration(
            title: "iPhone Active Time",
            subtitle: "Daily Screen Time rollup",
            snapshot: snapshot
        )
    }
}

private struct ScreenTimeReportContentView: View {
    let configuration: ScreenTimeReportConfiguration

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(configuration.title)
                .font(.headline)
            if let subtitle = configuration.subtitle {
                Text(subtitle)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            Text("Total: \(configuration.snapshot.totalSeconds / 60)m")
                .font(.title3.weight(.semibold))
        }
        .padding()
    }
}

private extension DateFormatter {
    static let screenTimeDayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = TimeZone.current
        return formatter
    }()
}

extension DeviceActivityReport.Context {
    static let dailyTotal = Self(ScreenTimeContexts.dailyTotal)
}
