import Foundation

enum LocalExportFormat: String, CaseIterable, Codable {
    case markdown = "markdown"
    case json = "json"
    case csv = "csv"

    var displayName: String {
        switch self {
        case .markdown: return "Markdown"
        case .json: return "JSON"
        case .csv: return "CSV"
        }
    }

    var fileExtension: String {
        switch self {
        case .markdown: return "md"
        case .json: return "json"
        case .csv: return "csv"
        }
    }
}

enum LocalExportWriteMode: String, CaseIterable, Codable {
    case overwrite = "overwrite"
    case append = "append"

    var displayName: String {
        switch self {
        case .overwrite: return "Overwrite"
        case .append: return "Append"
        }
    }
}

enum LocalExportFailureReason: String, Codable {
    case noDestination
    case noMetricsSelected
    case noData
    case healthAccessMissing
    case fileWriteFailed
    case unknown

    var description: String {
        switch self {
        case .noDestination:
            return "No export destination selected"
        case .noMetricsSelected:
            return "No tracked metrics available"
        case .noData:
            return "No data found for selected dates"
        case .healthAccessMissing:
            return "Health access is required"
        case .fileWriteFailed:
            return "Failed to write export files"
        case .unknown:
            return "Export failed"
        }
    }
}

struct LocalExportSettings: Codable {
    var format: LocalExportFormat
    var writeMode: LocalExportWriteMode
    var filenameTemplate: String
    var folderStructure: String

    static let defaults = LocalExportSettings(
        format: .markdown,
        writeMode: .overwrite,
        filenameTemplate: "{date}",
        folderStructure: ""
    )

    private static let storageKey = "LocalExport.settings"

    static func load() -> LocalExportSettings {
        guard let data = UserDefaults.standard.data(forKey: storageKey),
              let decoded = try? JSONDecoder().decode(LocalExportSettings.self, from: data) else {
            return .defaults
        }
        return decoded
    }

    func save() {
        if let data = try? JSONEncoder().encode(self) {
            UserDefaults.standard.set(data, forKey: Self.storageKey)
        }
    }
}

struct LocalExportResult {
    let successDays: Int
    let attemptedDays: Int
    let failedDays: [String]
    let exportedMetricCount: Int
    let failureReason: LocalExportFailureReason?
    let failureMessage: String?

    var succeeded: Bool {
        successDays > 0 && failedDays.isEmpty && failureReason == nil
    }

    var partiallySucceeded: Bool {
        successDays > 0 && (!failedDays.isEmpty || failureReason != nil)
    }
}

struct LocalExportHistoryEntry: Codable, Identifiable {
    let id: String
    let timestamp: Date
    let startDate: Date
    let endDate: Date
    let format: LocalExportFormat
    let successDays: Int
    let attemptedDays: Int
    let failedDays: [String]
    let exportedMetricCount: Int
    let failureReason: LocalExportFailureReason?
    let failureMessage: String?

    var isSuccess: Bool {
        failureReason == nil && failedDays.isEmpty && successDays == attemptedDays
    }

    var isPartial: Bool {
        successDays > 0 && !isSuccess
    }

    var summary: String {
        if isSuccess {
            return "Exported \(successDays) day(s)"
        }
        if isPartial {
            return "Partial export \(successDays)/\(attemptedDays)"
        }
        return failureReason?.description ?? "Export failed"
    }
}
