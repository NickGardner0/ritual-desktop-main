import SwiftUI
import RitualScreenTimeShared

struct ScreenTimeSelectionCard: View {
    let apps: [ScreenTimeBreakdownItem]
    let websites: [ScreenTimeBreakdownItem]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Current Snapshot")
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(.gray)

            if apps.isEmpty && websites.isEmpty {
                Text("No app or website rollups yet. Render the Screen Time report to populate this card.")
                    .font(.system(size: 13))
                    .foregroundColor(.gray)
            }

            if !apps.isEmpty {
                Text("Top apps")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.black)

                VStack(spacing: 6) {
                    ForEach(apps.prefix(5)) { item in
                        HStack {
                            Text(item.label)
                                .font(.system(size: 13))
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

            if !websites.isEmpty {
                if !apps.isEmpty {
                    Divider().padding(.vertical, 4)
                }

                Text("Top websites")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.black)

                VStack(spacing: 6) {
                    ForEach(websites.prefix(5)) { item in
                        HStack {
                            Text(item.label)
                                .font(.system(size: 13))
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
        .background(Color.white)
        .overlay(
            Rectangle()
                .stroke(Color.black.opacity(0.1), lineWidth: 1)
        )
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
