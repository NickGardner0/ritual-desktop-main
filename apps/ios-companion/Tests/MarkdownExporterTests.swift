import XCTest
@testable import RitualCompanion

final class MarkdownExporterTests: XCTestCase {

    private func date(_ s: String) -> Date {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: s)!
    }

    private func metric(
        _ type: MetricType,
        value: Double,
        unit: MetricUnit = .count,
        start: String = "2026-04-08T08:00:00Z",
        end: String = "2026-04-08T09:00:00Z"
    ) -> NormalizedMetric {
        NormalizedMetric(
            metricType: type,
            startTime: date(start),
            endTime: date(end),
            value: value,
            unit: unit
        )
    }

    private var fixedGeneratedAt: Date { date("2026-04-08T12:00:00Z") }

    // MARK: - Plain

    func testPlainEmptyStillRendersTableHeader() {
        let out = MarkdownExporter(style: .plain, generatedAt: fixedGeneratedAt)
            .render(date: date("2026-04-08T00:00:00Z"), metrics: [])
        XCTAssertTrue(out.contains("# Ritual Health Export"))
        XCTAssertTrue(out.contains("| Metric | Value | Unit | Start | End |"))
        XCTAssertTrue(out.contains("Generated at 2026-04-08T12:00:00Z"))
    }

    func testPlainIncludesMetricRow() {
        let out = MarkdownExporter(style: .plain, generatedAt: fixedGeneratedAt)
            .render(date: date("2026-04-08T00:00:00Z"), metrics: [metric(.steps, value: 8234)])
        XCTAssertTrue(out.contains("| steps | 8234 | count |"))
    }

    func testPlainFormatsFractionalValues() {
        let out = MarkdownExporter(style: .plain, generatedAt: fixedGeneratedAt)
            .render(date: date("2026-04-08T00:00:00Z"),
                    metrics: [metric(.hrv, value: 42.127, unit: .ms)])
        XCTAssertTrue(out.contains("42.13"))
    }

    // MARK: - Frontmatter

    func testFrontmatterEmptyShowsNoMetricsPlaceholder() {
        let out = MarkdownExporter(style: .frontmatter, generatedAt: fixedGeneratedAt)
            .render(date: date("2026-04-08T00:00:00Z"), metrics: [])
        XCTAssertTrue(out.hasPrefix("---\n"))
        XCTAssertTrue(out.contains("metric_count: 0"))
        XCTAssertTrue(out.contains("_No metrics recorded._"))
    }

    func testFrontmatterGroupsBySectionInOrder() {
        let metrics = [
            metric(.mindfulMinutes, value: 10, unit: .minutes),
            metric(.hr, value: 72, unit: .bpm),
            metric(.steps, value: 8000),
        ]
        let out = MarkdownExporter(style: .frontmatter, generatedAt: fixedGeneratedAt)
            .render(date: date("2026-04-08T00:00:00Z"), metrics: metrics)

        guard let activity = out.range(of: "## Activity"),
              let heart = out.range(of: "## Heart"),
              let mindful = out.range(of: "## Mindfulness") else {
            XCTFail("Expected all three sections in output:\n\(out)")
            return
        }
        XCTAssertLessThan(activity.lowerBound, heart.lowerBound)
        XCTAssertLessThan(heart.lowerBound, mindful.lowerBound)

        XCTAssertTrue(out.contains("- **Steps**: 8000 count"))
        XCTAssertTrue(out.contains("- **Heart rate**: 72 bpm"))
        XCTAssertTrue(out.contains("- **Mindful minutes**: 10 minutes"))
    }

    func testFrontmatterIsDeterministic() {
        let metrics = [metric(.steps, value: 5000), metric(.activeEnergy, value: 300, unit: .kcal)]
        let exporter = MarkdownExporter(style: .frontmatter, generatedAt: fixedGeneratedAt)
        let a = exporter.render(date: date("2026-04-08T00:00:00Z"), metrics: metrics)
        let b = exporter.render(date: date("2026-04-08T00:00:00Z"), metrics: metrics)
        XCTAssertEqual(a, b)
    }

    func testSectionMapperCoversEveryMetricType() {
        // Guard against adding a new MetricType without updating the mapper.
        for type in MetricType.allCases {
            _ = MarkdownExporter.section(for: type) // must not crash
            XCTAssertFalse(MarkdownExporter.displayName(for: type).isEmpty)
        }
    }
}
