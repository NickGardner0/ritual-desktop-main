import SwiftUI
import RitualScreenTimeShared

struct ScreenTimeSelectionCard: View {
    let apps: [ScreenTimeBreakdownItem]
    let websites: [ScreenTimeBreakdownItem]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Current Snapshot")
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(.gray)

            Text("\(apps.count) app(s) • \(websites.count) site(s)")
                .font(.system(size: 15, weight: .medium))
                .foregroundColor(.black)

            Text("Detailed app and website rankings are generated inside the Screen Time report extension and shared with Ritual locally.")
                .font(.system(size: 12))
                .foregroundColor(.gray)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Color.white)
        .overlay(
            Rectangle()
                .stroke(Color.black.opacity(0.1), lineWidth: 1)
        )
    }
}
