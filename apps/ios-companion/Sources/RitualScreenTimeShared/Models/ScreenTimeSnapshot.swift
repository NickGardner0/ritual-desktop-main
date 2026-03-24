import Foundation

public enum ScreenTimeBreakdownKind: String, Codable {
    case total
    case app
    case website
}

public struct ScreenTimeBreakdownItem: Codable, Hashable, Identifiable {
    public var id: String { "\(kind.rawValue):\(key)" }

    public let kind: ScreenTimeBreakdownKind
    public let key: String
    public let label: String
    public let activeSeconds: Int
    public let sortSeconds: Int?

    public init(
        kind: ScreenTimeBreakdownKind,
        key: String,
        label: String,
        activeSeconds: Int,
        sortSeconds: Int? = nil
    ) {
        self.kind = kind
        self.key = key
        self.label = label
        self.activeSeconds = activeSeconds
        self.sortSeconds = sortSeconds
    }
}

public struct ScreenTimeSnapshot: Codable {
    public let day: String
    public let timezone: String
    public let totalSeconds: Int
    public let generatedAt: Date
    public let apps: [ScreenTimeBreakdownItem]
    public let websites: [ScreenTimeBreakdownItem]

    public init(
        day: String,
        timezone: String,
        totalSeconds: Int,
        generatedAt: Date = Date(),
        apps: [ScreenTimeBreakdownItem] = [],
        websites: [ScreenTimeBreakdownItem] = []
    ) {
        self.day = day
        self.timezone = timezone
        self.totalSeconds = totalSeconds
        self.generatedAt = generatedAt
        self.apps = apps
        self.websites = websites
    }
}
