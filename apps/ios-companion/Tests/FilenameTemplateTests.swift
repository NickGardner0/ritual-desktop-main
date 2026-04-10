import XCTest
@testable import RitualCompanion

final class FilenameTemplateTests: XCTestCase {

    private func date(_ string: String) -> Date {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd HH:mm"
        f.timeZone = TimeZone(identifier: "UTC")
        f.locale = Locale(identifier: "en_US_POSIX")
        return f.date(from: string)!
    }

    private var utcCalendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        c.locale = Locale(identifier: "en_US_POSIX")
        return c
    }

    // MARK: - Token replacement

    func testAllTokensRenderedInFilename() {
        let out = FilenameTemplate.renderFilename(
            "{year}-{month}-{day}-{weekday}-{date}",
            date: date("2026-02-28 12:00"),
            calendar: utcCalendar
        )
        XCTAssertEqual(out, "2026-02-28-Saturday-2026-02-28")
    }

    func testIsoAliasMatchesDate() {
        let d = date("2026-01-02 00:00")
        let a = FilenameTemplate.renderFilename("{date}", date: d, calendar: utcCalendar)
        let b = FilenameTemplate.renderFilename("{iso}", date: d, calendar: utcCalendar)
        XCTAssertEqual(a, b)
        XCTAssertEqual(a, "2026-01-02")
    }

    func testEmptyTemplateFallsBackToIsoDate() {
        let out = FilenameTemplate.renderFilename("", date: date("2026-06-01 00:00"), calendar: utcCalendar)
        XCTAssertEqual(out, "2026-06-01")
    }

    // MARK: - Sanitization (filename)

    func testFilenameStripsReservedCharacters() {
        let out = FilenameTemplate.renderFilename(
            "ritual:\\|?*<>\"{date}",
            date: date("2026-06-01 00:00"),
            calendar: utcCalendar
        )
        XCTAssertEqual(out, "ritual2026-06-01")
    }

    func testFilenameDropsPathTraversalAttempt() {
        // `..` alone sanitizes to empty and falls back to the iso date.
        let out = FilenameTemplate.renderFilename("..", date: date("2026-06-01 00:00"), calendar: utcCalendar)
        XCTAssertEqual(out, "2026-06-01")
    }

    func testFilenameFlattensSlashesToDashes() {
        let out = FilenameTemplate.renderFilename(
            "{year}/{month}",
            date: date("2026-02-28 12:00"),
            calendar: utcCalendar
        )
        XCTAssertEqual(out, "2026-02")
    }

    func testFilenameCollapsesWhitespace() {
        let out = FilenameTemplate.renderFilename(
            "ritual     export  {date}",
            date: date("2026-06-01 00:00"),
            calendar: utcCalendar
        )
        XCTAssertEqual(out, "ritual export 2026-06-01")
    }

    // MARK: - Sanitization (folder components)

    func testFolderEmptyTemplateYieldsNoComponents() {
        let result = FilenameTemplate.renderFolderComponents("", date: date("2026-06-01 00:00"), calendar: utcCalendar)
        XCTAssertEqual(result, [])
    }

    func testFolderSplitsOnSlash() {
        let result = FilenameTemplate.renderFolderComponents(
            "{year}/{month}/{day}",
            date: date("2026-02-28 00:00"),
            calendar: utcCalendar
        )
        XCTAssertEqual(result, ["2026", "02", "28"])
    }

    func testFolderRejectsAbsolutePath() {
        let result = FilenameTemplate.renderFolderComponents("/etc/passwd", date: Date(), calendar: utcCalendar)
        XCTAssertNil(result)
    }

    func testFolderRejectsParentTraversal() {
        let result = FilenameTemplate.renderFolderComponents("good/../evil", date: Date(), calendar: utcCalendar)
        XCTAssertNil(result)
    }

    func testFolderRejectsSingleDot() {
        let result = FilenameTemplate.renderFolderComponents("./secret", date: Date(), calendar: utcCalendar)
        XCTAssertNil(result)
    }
}
