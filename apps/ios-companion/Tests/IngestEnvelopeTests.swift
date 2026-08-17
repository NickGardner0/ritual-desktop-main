import XCTest
@testable import RitualCompanion

final class IngestEnvelopeTests: XCTestCase {
    func testVersionedEnvelopeRoundTripsAllMutationKinds() throws {
        let added = metric(.steps, externalId: "added")
        let modified = metric(.hr, externalId: "modified")
        let envelope = IngestEnvelopeV1(
            added: [added],
            deleted: ["deleted"],
            modified: [modified]
        )

        let data = try JSONEncoder().encode(envelope)
        let decoded = try JSONDecoder().decode(IngestEnvelopeV1.self, from: data)

        XCTAssertEqual(decoded.version, 1)
        XCTAssertEqual(decoded.added.map(\.externalId), ["added"])
        XCTAssertEqual(decoded.deleted, ["deleted"])
        XCTAssertEqual(decoded.modified.map(\.externalId), ["modified"])
    }

    func testLegacyBareArrayRemainsDecodableDuringCompatibility() throws {
        let data = try JSONEncoder().encode([metric(.steps, externalId: "legacy")])
        XCTAssertThrowsError(try JSONDecoder().decode(IngestEnvelopeV1.self, from: data))
        let legacy = try JSONDecoder().decode([NormalizedMetric].self, from: data)
        XCTAssertEqual(legacy.map(\.externalId), ["legacy"])
    }

    func testAdditiveDuplicateOutcomeDecodesAsSuccessfulCompatibilityResponse() throws {
        let data = Data(
            #"{"success":true,"outcome":"duplicate","error_code":null,"added_results":[],"deleted_results":[],"modified_results":[],"server_time":"2026-08-17T00:00:00Z","next_poll_seconds":null,"confirmed_anchors":{}}"#.utf8
        )
        let response = try JSONDecoder().decode(AppleIngestResponseV2.self, from: data)
        XCTAssertTrue(response.success)
        XCTAssertEqual(response.outcome, .duplicate)
        XCTAssertNil(response.errorCode)
    }

    func testRetryScopeNormalizesReversedDateRanges() {
        let calendar = Calendar(identifier: .gregorian)
        let later = Date(timeIntervalSince1970: 1_700_172_800)
        let earlier = Date(timeIntervalSince1970: 1_700_000_000)
        guard case let .dateRange(range) = RetryScope.normalizedDateRange(
            startDate: later,
            endDate: earlier,
            calendar: calendar
        ) else {
            return XCTFail("Expected a date-range retry scope")
        }
        XCTAssertLessThanOrEqual(range.lowerBound, range.upperBound)
        XCTAssertEqual(range.lowerBound, calendar.startOfDay(for: earlier))
        XCTAssertEqual(range.upperBound, calendar.startOfDay(for: later))
    }

    func testAnchorsAdvanceOnlyAfterEveryBatchIsAcceptedAndConfirmed() {
        let pending = ["steps": "steps-token", "hr": "hr-token"]
        XCTAssertEqual(
            AnchorCommitPolicy.confirmedTokensForCommit(
                allBatchesAccepted: true,
                pendingTokens: pending,
                serverConfirmedTokens: pending
            ),
            pending
        )
        XCTAssertTrue(
            AnchorCommitPolicy.confirmedTokensForCommit(
                allBatchesAccepted: false,
                pendingTokens: pending,
                serverConfirmedTokens: pending
            ).isEmpty,
            "Partial, queued, or rejected batches must retain the previous anchors"
        )
    }

    func testMissingOrMismatchedServerConfirmationCannotAdvanceAnAnchor() {
        let pending = ["steps": "new-token", "hr": "hr-token"]
        XCTAssertTrue(
            AnchorCommitPolicy.confirmedTokensForCommit(
                allBatchesAccepted: true,
                pendingTokens: pending,
                serverConfirmedTokens: nil
            ).isEmpty
        )
        XCTAssertEqual(
            AnchorCommitPolicy.confirmedTokensForCommit(
                allBatchesAccepted: true,
                pendingTokens: pending,
                serverConfirmedTokens: ["steps": "stale-token", "hr": "hr-token"]
            ),
            ["hr": "hr-token"]
        )
    }

    private func metric(_ type: MetricType, externalId: String) -> NormalizedMetric {
        NormalizedMetric(
            metricType: type,
            startTime: Date(timeIntervalSince1970: 1_700_000_000),
            endTime: Date(timeIntervalSince1970: 1_700_000_060),
            value: 1,
            unit: .count,
            externalId: externalId
        )
    }
}
