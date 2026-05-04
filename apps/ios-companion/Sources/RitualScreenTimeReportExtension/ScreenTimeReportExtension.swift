import DeviceActivity
import Foundation
import SwiftUI

@main
struct ScreenTimeReportExtension: DeviceActivityReportExtension {
    init() {
        NSLog("🕒 RitualScreenTimeReportExt: @main struct initialized")
    }

    var body: some DeviceActivityReportScene {
        DailyTotalReport()
        FocusSelectionReport()
    }
}
