import DeviceActivity
import RitualScreenTimeShared
import SwiftUI

struct FocusSelectionReport: DeviceActivityReportScene {
    let context: DeviceActivityReport.Context = .topApps
    let content: (ScreenTimeReportConfiguration) -> FocusSelectionReportView

    init() {
        self.content = { FocusSelectionReportView(configuration: $0) }
    }

    func makeConfiguration(representing data: DeviceActivityResults<DeviceActivityData>) async -> ScreenTimeReportConfiguration {
        let snapshot = ScreenTimeSharedStore.shared.loadSnapshot()
            ?? ScreenTimeSnapshot(
                day: Self.dayFormatter.string(from: Date()),
                timezone: TimeZone.current.identifier,
                totalSeconds: 0
            )

        return ScreenTimeReportConfiguration(
            title: "Top iPhone Apps",
            subtitle: "Shared with Ritual desktop Activity Breakdown",
            snapshot: snapshot
        )
    }

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = TimeZone.current
        return formatter
    }()
}

private struct FocusSelectionReportView: View {
    let configuration: ScreenTimeReportConfiguration

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(configuration.title)
                .font(.headline)
            Text(configuration.subtitle ?? "")
                .font(.caption)
                .foregroundColor(.secondary)
            Text("\(configuration.snapshot.apps.count) app rollup(s)")
                .font(.title3.weight(.semibold))
        }
        .padding()
    }
}

extension DeviceActivityReport.Context {
    static let topApps = Self(ScreenTimeContexts.topApps)
}
