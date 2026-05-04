import DeviceActivity
import RitualScreenTimeShared
import SwiftUI

struct DailyTotalReport: DeviceActivityReportScene {
    let context: DeviceActivityReport.Context = .dailyTotal
    let content: (ScreenTimeReportConfiguration) -> DailyTotalReportView

    init() {
        self.content = { DailyTotalReportView(configuration: $0) }
    }

    func makeConfiguration(representing data: DeviceActivityResults<DeviceActivityData>) async -> ScreenTimeReportConfiguration {
        NSLog("🕒 DailyTotalReport: makeConfiguration running")
        var totalDuration: TimeInterval = 0
        var appTotals: [String: (label: String, seconds: TimeInterval)] = [:]
        var siteTotals: [String: (label: String, seconds: TimeInterval)] = [:]

        for await dataItem in data {
            for await segment in dataItem.activitySegments {
                totalDuration += segment.totalActivityDuration
                for await categoryActivity in segment.categories {
                    for await appActivity in categoryActivity.applications {
                        let app = appActivity.application
                        let key = app.bundleIdentifier ?? app.localizedDisplayName ?? "unknown.app"
                        let label = app.localizedDisplayName ?? app.bundleIdentifier ?? "Unknown app"
                        let previous = appTotals[key]?.seconds ?? 0
                        appTotals[key] = (label, previous + appActivity.totalActivityDuration)
                    }
                    for await webActivity in categoryActivity.webDomains {
                        let domain = webActivity.webDomain.domain ?? "unknown.domain"
                        let previous = siteTotals[domain]?.seconds ?? 0
                        siteTotals[domain] = (domain, previous + webActivity.totalActivityDuration)
                    }
                }
            }
        }

        let apps = appTotals
            .map { (key, value) in
                ScreenTimeBreakdownItem(
                    kind: .app,
                    key: key,
                    label: value.label,
                    activeSeconds: Int(value.seconds.rounded()),
                    sortSeconds: Int(value.seconds.rounded())
                )
            }
            .sorted { $0.activeSeconds > $1.activeSeconds }

        let websites = siteTotals
            .map { (key, value) in
                ScreenTimeBreakdownItem(
                    kind: .website,
                    key: key,
                    label: value.label,
                    activeSeconds: Int(value.seconds.rounded()),
                    sortSeconds: Int(value.seconds.rounded())
                )
            }
            .sorted { $0.activeSeconds > $1.activeSeconds }

        let snapshot = ScreenTimeSnapshot(
            day: Self.dayFormatter.string(from: Date()),
            timezone: TimeZone.current.identifier,
            totalSeconds: Int(totalDuration.rounded()),
            apps: apps,
            websites: websites
        )

        do {
            try ScreenTimeSharedStore.shared.saveSnapshot(snapshot)
            NSLog("🕒 DailyTotalReport: saved snapshot total=%ds apps=%d sites=%d", snapshot.totalSeconds, snapshot.apps.count, snapshot.websites.count)
        } catch {
            NSLog("🕒 DailyTotalReport: saveSnapshot error=%@", "\(error)")
        }

        return ScreenTimeReportConfiguration(
            title: "iPhone Active Time",
            subtitle: "Daily Screen Time rollup",
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

struct DailyTotalReportView: View {
    let configuration: ScreenTimeReportConfiguration

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(configuration.title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(.gray)

            Text(Self.durationString(seconds: configuration.snapshot.totalSeconds))
                .font(.system(size: 34, weight: .semibold))
                .foregroundColor(.black)

            if let subtitle = configuration.subtitle {
                Text(subtitle)
                    .font(.system(size: 12))
                    .foregroundColor(.gray)
            }

            if !configuration.snapshot.apps.isEmpty {
                Divider().padding(.vertical, 4)

                Text("Top apps")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.gray)

                VStack(spacing: 6) {
                    ForEach(configuration.snapshot.apps.prefix(5)) { item in
                        HStack {
                            Text(item.label)
                                .font(.system(size: 14))
                                .foregroundColor(.black)
                                .lineLimit(1)
                            Spacer()
                            Text(Self.durationString(seconds: item.activeSeconds))
                                .font(.system(size: 13, design: .monospaced))
                                .foregroundColor(.gray)
                        }
                    }
                }
            }

            if !configuration.snapshot.websites.isEmpty {
                Divider().padding(.vertical, 4)

                Text("Top websites")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.gray)

                VStack(spacing: 6) {
                    ForEach(configuration.snapshot.websites.prefix(5)) { item in
                        HStack {
                            Text(item.label)
                                .font(.system(size: 14))
                                .foregroundColor(.black)
                                .lineLimit(1)
                            Spacer()
                            Text(Self.durationString(seconds: item.activeSeconds))
                                .font(.system(size: 13, design: .monospaced))
                                .foregroundColor(.gray)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
    }

    private static func durationString(seconds: Int) -> String {
        let hours = seconds / 3600
        let minutes = (seconds % 3600) / 60
        if hours > 0 {
            return "\(hours)h \(minutes)m"
        }
        return "\(minutes)m"
    }
}

extension DeviceActivityReport.Context {
    static let dailyTotal = Self(ScreenTimeContexts.dailyTotal)
}
