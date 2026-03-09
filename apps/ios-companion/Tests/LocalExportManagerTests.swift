import XCTest
@testable import RitualCompanion

@MainActor
final class LocalExportManagerTests: XCTestCase {
    func testApplyTemplateReplacesAllSupportedTokens() {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm"
        guard let date = formatter.date(from: "2026-02-28 13:15") else {
            XCTFail("Failed to create test date")
            return
        }

        let output = LocalExportManager.applyTemplate("{year}/{month}/{day}-{date}-{weekday}", date: date)

        XCTAssertEqual(output, "2026/02/28-2026-02-28-Saturday")
    }

    func testApplyTemplateReturnsEmptyForEmptyTemplate() {
        let output = LocalExportManager.applyTemplate("", date: Date())
        XCTAssertEqual(output, "")
    }
}
