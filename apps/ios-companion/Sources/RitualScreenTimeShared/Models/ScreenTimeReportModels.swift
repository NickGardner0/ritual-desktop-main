import Foundation

public struct ScreenTimeReportConfiguration: Codable {
    public let title: String
    public let subtitle: String?
    public let snapshot: ScreenTimeSnapshot

    public init(title: String, subtitle: String? = nil, snapshot: ScreenTimeSnapshot) {
        self.title = title
        self.subtitle = subtitle
        self.snapshot = snapshot
    }
}
