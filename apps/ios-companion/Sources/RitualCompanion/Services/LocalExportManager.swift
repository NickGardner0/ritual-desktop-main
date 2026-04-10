import Foundation

@MainActor
final class LocalExportManager {
    static let shared = LocalExportManager()

    private let isoDateFormatter: DateFormatter
    private let isoDateTimeFormatter: ISO8601DateFormatter

    private init() {
        isoDateFormatter = DateFormatter()
        isoDateFormatter.dateFormat = "yyyy-MM-dd"
        isoDateTimeFormatter = ISO8601DateFormatter()
    }

    func exportDateRange(
        startDate: Date,
        endDate: Date,
        metricTypes: [String],
        settings: LocalExportSettings,
        destinationStore: ExportDestinationStore,
        healthKitManager: HealthKitManagerV2
    ) async -> LocalExportResult {
        let calendar = Calendar.current
        let start = calendar.startOfDay(for: min(startDate, endDate))
        let end = calendar.startOfDay(for: max(startDate, endDate))
        let dayKeys = makeDayKeys(startDate: start, endDate: end)

        return await exportDayKeys(
            dayKeys,
            startDate: start,
            endDate: end,
            metricTypes: metricTypes,
            settings: settings,
            destinationStore: destinationStore,
            healthKitManager: healthKitManager
        )
    }

    func exportDayKeys(
        _ dayKeys: [String],
        startDate: Date,
        endDate: Date,
        metricTypes: [String],
        settings: LocalExportSettings,
        destinationStore: ExportDestinationStore,
        healthKitManager: HealthKitManagerV2
    ) async -> LocalExportResult {
        let targetDayKeys = Set(dayKeys)

        guard destinationStore.destinationURL != nil else {
            return LocalExportResult(
                successDays: 0,
                attemptedDays: dayKeys.count,
                failedDays: dayKeys,
                exportedMetricCount: 0,
                failureReason: .noDestination,
                failureMessage: LocalExportFailureReason.noDestination.description
            )
        }

        guard !metricTypes.isEmpty else {
            return LocalExportResult(
                successDays: 0,
                attemptedDays: dayKeys.count,
                failedDays: dayKeys,
                exportedMetricCount: 0,
                failureReason: .noMetricsSelected,
                failureMessage: LocalExportFailureReason.noMetricsSelected.description
            )
        }

        var metricsByDay: [String: [NormalizedMetric]] = [:]
        var fetchErrors: [String] = []

        for metricType in metricTypes {
            do {
                let metrics = try await healthKitManager.fetchDailyAggregatedMetrics(
                    for: metricType,
                    startDate: startDate,
                    endDate: endDate
                )

                for metric in metrics {
                    guard let dayKey = dayKey(for: metric), targetDayKeys.contains(dayKey) else { continue }
                    metricsByDay[dayKey, default: []].append(metric)
                }
            } catch {
                fetchErrors.append("\(metricType): \(error.localizedDescription)")
            }
        }

        if metricsByDay.isEmpty {
            let reason: LocalExportFailureReason = fetchErrors.isEmpty ? .noData : .unknown
            return LocalExportResult(
                successDays: 0,
                attemptedDays: dayKeys.count,
                failedDays: dayKeys,
                exportedMetricCount: 0,
                failureReason: reason,
                failureMessage: fetchErrors.first ?? reason.description
            )
        }

        var failedDays: [String] = []
        var successDays = 0
        var exportedMetricCount = 0
        var writeErrorMessage: String?

        for dayKey in dayKeys.sorted() {
            guard let date = parseDayKey(dayKey) else {
                failedDays.append(dayKey)
                continue
            }

            guard let metrics = metricsByDay[dayKey], !metrics.isEmpty else {
                failedDays.append(dayKey)
                continue
            }

            do {
                try write(metrics: metrics, for: date, settings: settings, destinationStore: destinationStore)
                successDays += 1
                exportedMetricCount += metrics.count
            } catch {
                failedDays.append(dayKey)
                if writeErrorMessage == nil {
                    writeErrorMessage = error.localizedDescription
                }
            }
        }

        let failureReason: LocalExportFailureReason?
        if successDays == 0 {
            failureReason = .fileWriteFailed
        } else if !failedDays.isEmpty {
            failureReason = .unknown
        } else {
            failureReason = nil
        }

        return LocalExportResult(
            successDays: successDays,
            attemptedDays: dayKeys.count,
            failedDays: failedDays,
            exportedMetricCount: exportedMetricCount,
            failureReason: failureReason,
            failureMessage: writeErrorMessage ?? fetchErrors.first
        )
    }

    private func write(
        metrics: [NormalizedMetric],
        for date: Date,
        settings: LocalExportSettings,
        destinationStore: ExportDestinationStore
    ) throws {
        try destinationStore.withAccess { baseURL in
            var targetFolder = baseURL

            // Sanitized folder components (nil = path traversal / invalid template).
            guard let folderComponents = FilenameTemplate.renderFolderComponents(settings.folderStructure, date: date) else {
                throw NSError(
                    domain: "LocalExportManager",
                    code: 2,
                    userInfo: [NSLocalizedDescriptionKey: "Invalid folder template"]
                )
            }
            for component in folderComponents {
                targetFolder = targetFolder.appendingPathComponent(component, isDirectory: true)
            }

            let fileManager = FileManager.default
            if !fileManager.fileExists(atPath: targetFolder.path) {
                try fileManager.createDirectory(at: targetFolder, withIntermediateDirectories: true)
            }

            let baseName = FilenameTemplate.renderFilename(settings.filenameTemplate, date: date)
            let fileURL = targetFolder.appendingPathComponent("\(baseName).\(settings.format.fileExtension)")

            let sortedMetrics = metrics.sorted { lhs, rhs in
                if lhs.metricType.rawValue == rhs.metricType.rawValue {
                    return lhs.startTime < rhs.startTime
                }
                return lhs.metricType.rawValue < rhs.metricType.rawValue
            }

            switch settings.format {
            case .markdown:
                let exporter = MarkdownExporter(style: settings.markdownStyle)
                let content = exporter.render(date: date, metrics: sortedMetrics)
                try writeText(content, to: fileURL, writeMode: settings.writeMode, separator: "\n\n")
            case .json:
                try writeJSON(sortedMetrics, to: fileURL, writeMode: settings.writeMode)
            case .csv:
                try writeCSV(sortedMetrics, to: fileURL, writeMode: settings.writeMode)
            }
        }
    }

    private func writeText(_ text: String, to fileURL: URL, writeMode: LocalExportWriteMode, separator: String) throws {
        let fileManager = FileManager.default
        if writeMode == .append, fileManager.fileExists(atPath: fileURL.path) {
            let existing = (try? String(contentsOf: fileURL, encoding: .utf8)) ?? ""
            let merged = existing.isEmpty ? text : existing + separator + text
            try merged.write(to: fileURL, atomically: true, encoding: .utf8)
            return
        }

        try text.write(to: fileURL, atomically: true, encoding: .utf8)
    }

    private func writeJSON(_ metrics: [NormalizedMetric], to fileURL: URL, writeMode: LocalExportWriteMode) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]

        var outputMetrics = metrics
        if writeMode == .append,
           let existingData = try? Data(contentsOf: fileURL),
           let existingMetrics = try? JSONDecoder().decode([NormalizedMetric].self, from: existingData) {
            outputMetrics = existingMetrics + metrics
        }

        let data = try encoder.encode(outputMetrics)
        try data.write(to: fileURL, options: .atomic)
    }

    private func writeCSV(_ metrics: [NormalizedMetric], to fileURL: URL, writeMode: LocalExportWriteMode) throws {
        let header = "metric_type,value,unit,start_time,end_time,external_id,source_bundle_id,source_device_name,attributed_date\n"
        let rows = metrics.map { metric in
            [
                csvEscape(metric.metricType.rawValue),
                csvEscape(String(metric.value)),
                csvEscape(metric.unit.rawValue),
                csvEscape(metric.startTime),
                csvEscape(metric.endTime),
                csvEscape(metric.externalId ?? ""),
                csvEscape(metric.sourceBundleId ?? ""),
                csvEscape(metric.sourceDeviceName ?? ""),
                csvEscape(metric.attributedDate ?? "")
            ].joined(separator: ",")
        }.joined(separator: "\n")

        let fileManager = FileManager.default
        if writeMode == .append, fileManager.fileExists(atPath: fileURL.path) {
            let existing = (try? String(contentsOf: fileURL, encoding: .utf8)) ?? ""
            var merged = existing
            if !merged.hasSuffix("\n") {
                merged += "\n"
            }
            merged += rows
            if !merged.hasSuffix("\n") {
                merged += "\n"
            }
            try merged.write(to: fileURL, atomically: true, encoding: .utf8)
            return
        }

        let content = header + rows + (rows.isEmpty ? "" : "\n")
        try content.write(to: fileURL, atomically: true, encoding: .utf8)
    }

    private func csvEscape(_ value: String) -> String {
        var escaped = value.replacingOccurrences(of: "\"", with: "\"\"")
        if escaped.contains(",") || escaped.contains("\n") {
            escaped = "\"\(escaped)\""
        }
        return escaped
    }

    private func dayKey(for metric: NormalizedMetric) -> String? {
        if let attributed = metric.attributedDate, !attributed.isEmpty {
            return String(attributed.prefix(10))
        }

        guard metric.startTime.count >= 10 else { return nil }
        return String(metric.startTime.prefix(10))
    }

    private func parseDayKey(_ dayKey: String) -> Date? {
        isoDateFormatter.date(from: dayKey)
    }

    private func makeDayKeys(startDate: Date, endDate: Date) -> [String] {
        let calendar = Calendar.current
        var dayKeys: [String] = []
        var current = calendar.startOfDay(for: startDate)
        let end = calendar.startOfDay(for: endDate)

        while current <= end {
            dayKeys.append(isoDateFormatter.string(from: current))
            guard let next = calendar.date(byAdding: .day, value: 1, to: current) else { break }
            current = next
        }

        return dayKeys
    }

    static func applyTemplate(_ template: String, date: Date) -> String {
        guard !template.isEmpty else { return "" }

        let formatter = DateFormatter()
        var output = template

        formatter.dateFormat = "yyyy-MM-dd"
        output = output.replacingOccurrences(of: "{date}", with: formatter.string(from: date))

        formatter.dateFormat = "yyyy"
        output = output.replacingOccurrences(of: "{year}", with: formatter.string(from: date))

        formatter.dateFormat = "MM"
        output = output.replacingOccurrences(of: "{month}", with: formatter.string(from: date))

        formatter.dateFormat = "dd"
        output = output.replacingOccurrences(of: "{day}", with: formatter.string(from: date))

        formatter.dateFormat = "EEEE"
        output = output.replacingOccurrences(of: "{weekday}", with: formatter.string(from: date))

        return output
    }
}
