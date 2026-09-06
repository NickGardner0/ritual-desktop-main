import HealthKit
import XCTest
@testable import RitualCompanion

final class HealthMetricDescriptorTests: XCTestCase {
    private let screenTimeMetrics: Set<MetricType> = [
        .screenTimeTotal,
        .screenTimeAppUsage,
        .screenTimeWebDomainUsage,
    ]

    func testEveryHealthKitMetricHasOneUsableDescriptor() {
        for metricType in MetricType.allCases {
            let descriptor = HealthMetricDescriptor.catalog[metricType]
            if screenTimeMetrics.contains(metricType) {
                XCTAssertNil(descriptor, "Screen Time must remain outside HealthKit")
            } else {
                XCTAssertNotNil(descriptor, "Missing descriptor for \(metricType.rawValue)")
                XCTAssertNotNil(descriptor?.sampleType, "Unavailable sample type for \(metricType.rawValue)")
            }
        }
    }

    func testDimensionalConversionsUseDescriptorUnitsAndScales() {
        assertConversion(.bodyMass, value: 72, expected: 72, unit: .kg)
        assertConversion(.dietaryProtein, value: 45, expected: 45, unit: .grams)
        assertConversion(.bloodPressureSystolic, value: 118, expected: 118, unit: .mmHg)
        assertConversion(.bodyTemperature, value: 36.7, expected: 36.7, unit: .celsius)
        assertConversion(.walkingStepLength, value: 68, expected: 68, unit: .cm)
        assertConversion(.oxygenSaturation, value: 0.97, expected: 97, unit: .percent)
    }

    func testGranularHistoryCapsAreDescriptorOwned() {
        XCTAssertEqual(HealthMetricDescriptor.catalog[.sleepSession]?.granularClass.historyCapDays, 365)
        XCTAssertEqual(HealthMetricDescriptor.catalog[.workout]?.granularClass.historyCapDays, 365)
        XCTAssertEqual(HealthMetricDescriptor.catalog[.steps]?.granularClass.historyCapDays, 30)
        XCTAssertEqual(HealthMetricDescriptor.catalog[.hr]?.granularClass.historyCapDays, 30)
    }

    private func assertConversion(
        _ type: MetricType,
        value: Double,
        expected: Double,
        unit: MetricUnit,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        guard let descriptor = HealthMetricDescriptor.catalog[type],
              let healthKitUnit = descriptor.healthKitUnit,
              let converted = descriptor.normalizedValue(
                  from: HKQuantity(unit: healthKitUnit, doubleValue: value)
              ) else {
            XCTFail("Missing quantity descriptor for \(type.rawValue)", file: file, line: line)
            return
        }
        XCTAssertEqual(converted.0, expected, accuracy: 0.0001, file: file, line: line)
        XCTAssertEqual(converted.1, unit, file: file, line: line)
    }
}
