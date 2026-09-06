import HealthKit

enum SourcePreference {
    case appleWatchOnly
    case appleWatchPreferred
    case bestAvailable
}

enum AggregationType {
    case cumulativeSum
    case discreteAverage
    case discreteMin
    case discreteMax
    case duration
}

enum HealthMetricGranularClass {
    case bucketed
    case point
    case interval

    var historyCapDays: Int {
        switch self {
        case .interval: 365
        case .bucketed, .point: 30
        }
    }
}

struct HealthMetricDescriptor {
    enum Kind {
        case quantity(HKQuantityTypeIdentifier)
        case category(HKCategoryTypeIdentifier)
        case workout
    }

    let metricType: MetricType
    let kind: Kind
    let healthKitUnit: HKUnit?
    let normalizedUnit: MetricUnit?
    let scale: Double
    let aggregation: AggregationType
    let sourcePreference: SourcePreference
    let granularClass: HealthMetricGranularClass

    var sampleType: HKSampleType? {
        switch kind {
        case let .quantity(identifier):
            HKQuantityType.quantityType(forIdentifier: identifier)
        case let .category(identifier):
            HKCategoryType.categoryType(forIdentifier: identifier)
        case .workout:
            HKObjectType.workoutType()
        }
    }

    func normalizedValue(from quantity: HKQuantity) -> (Double, MetricUnit)? {
        guard let healthKitUnit, let normalizedUnit else { return nil }
        var value = quantity.doubleValue(for: healthKitUnit) * scale
        if normalizedUnit == .percent {
            value = min(max(value, 0), 100)
        }
        return (value, normalizedUnit)
    }
}

extension HealthMetricDescriptor {
    private static func quantity(
        _ metricType: MetricType,
        _ identifier: HKQuantityTypeIdentifier,
        unit: HKUnit,
        normalizedUnit: MetricUnit,
        scale: Double = 1,
        aggregation: AggregationType,
        source: SourcePreference,
        granularClass: HealthMetricGranularClass = .point
    ) -> HealthMetricDescriptor {
        HealthMetricDescriptor(
            metricType: metricType,
            kind: .quantity(identifier),
            healthKitUnit: unit,
            normalizedUnit: normalizedUnit,
            scale: scale,
            aggregation: aggregation,
            sourcePreference: source,
            granularClass: granularClass
        )
    }

    private static func category(
        _ metricType: MetricType,
        _ identifier: HKCategoryTypeIdentifier,
        normalizedUnit: MetricUnit,
        source: SourcePreference
    ) -> HealthMetricDescriptor {
        HealthMetricDescriptor(
            metricType: metricType,
            kind: .category(identifier),
            healthKitUnit: nil,
            normalizedUnit: normalizedUnit,
            scale: 1,
            aggregation: .duration,
            sourcePreference: source,
            granularClass: .interval
        )
    }

    static let catalog: [MetricType: HealthMetricDescriptor] = {
        let count = HKUnit.count()
        let perMinute = count.unitDivided(by: .minute())
        let percent = HKUnit.percent()
        let sleepTypes: [MetricType] = [
            .sleepSession, .sleepAsleep, .sleepAwake, .sleepREM, .sleepDeep, .sleepCore,
        ]
        var descriptors: [HealthMetricDescriptor] = [
            quantity(.steps, .stepCount, unit: count, normalizedUnit: .count, aggregation: .cumulativeSum, source: .appleWatchOnly, granularClass: .bucketed),
            quantity(.activeEnergy, .activeEnergyBurned, unit: .kilocalorie(), normalizedUnit: .kcal, aggregation: .cumulativeSum, source: .appleWatchOnly, granularClass: .bucketed),
            quantity(.basalEnergy, .basalEnergyBurned, unit: .kilocalorie(), normalizedUnit: .kcal, aggregation: .cumulativeSum, source: .appleWatchOnly, granularClass: .bucketed),
            quantity(.distance, .distanceWalkingRunning, unit: .meter(), normalizedUnit: .meters, aggregation: .cumulativeSum, source: .appleWatchOnly, granularClass: .bucketed),
            quantity(.flightsClimbed, .flightsClimbed, unit: count, normalizedUnit: .count, aggregation: .cumulativeSum, source: .appleWatchOnly, granularClass: .bucketed),
            quantity(.exerciseTime, .appleExerciseTime, unit: .minute(), normalizedUnit: .minutes, aggregation: .cumulativeSum, source: .appleWatchOnly, granularClass: .bucketed),
            quantity(.standTime, .appleStandTime, unit: .minute(), normalizedUnit: .minutes, aggregation: .cumulativeSum, source: .appleWatchOnly, granularClass: .bucketed),
            quantity(.hr, .heartRate, unit: perMinute, normalizedUnit: .bpm, aggregation: .discreteAverage, source: .appleWatchPreferred),
            quantity(.hrv, .heartRateVariabilitySDNN, unit: .secondUnit(with: .milli), normalizedUnit: .ms, aggregation: .discreteAverage, source: .appleWatchOnly),
            quantity(.restingHr, .restingHeartRate, unit: perMinute, normalizedUnit: .bpm, aggregation: .discreteMin, source: .appleWatchPreferred),
            quantity(.walkingHr, .walkingHeartRateAverage, unit: perMinute, normalizedUnit: .bpm, aggregation: .discreteAverage, source: .appleWatchOnly),
            quantity(.respiratoryRate, .respiratoryRate, unit: perMinute, normalizedUnit: .breathsPerMinute, aggregation: .discreteAverage, source: .appleWatchOnly),
            quantity(.oxygenSaturation, .oxygenSaturation, unit: percent, normalizedUnit: .percent, scale: 100, aggregation: .discreteAverage, source: .appleWatchOnly),
            category(.mindfulMinutes, .mindfulSession, normalizedUnit: .minutes, source: .bestAvailable),
            quantity(.bodyMass, .bodyMass, unit: .gramUnit(with: .kilo), normalizedUnit: .kg, aggregation: .discreteAverage, source: .bestAvailable),
            quantity(.bodyMassIndex, .bodyMassIndex, unit: count, normalizedUnit: .count, aggregation: .discreteAverage, source: .bestAvailable),
            quantity(.bodyFatPercentage, .bodyFatPercentage, unit: percent, normalizedUnit: .percent, scale: 100, aggregation: .discreteAverage, source: .bestAvailable),
            quantity(.leanBodyMass, .leanBodyMass, unit: .gramUnit(with: .kilo), normalizedUnit: .kg, aggregation: .discreteAverage, source: .bestAvailable),
            quantity(.height, .height, unit: .meterUnit(with: .centi), normalizedUnit: .cm, aggregation: .discreteAverage, source: .bestAvailable),
            quantity(.waistCircumference, .waistCircumference, unit: .meterUnit(with: .centi), normalizedUnit: .cm, aggregation: .discreteAverage, source: .bestAvailable),
            quantity(.dietaryEnergy, .dietaryEnergyConsumed, unit: .kilocalorie(), normalizedUnit: .kcal, aggregation: .cumulativeSum, source: .bestAvailable),
            quantity(.dietaryProtein, .dietaryProtein, unit: .gram(), normalizedUnit: .grams, aggregation: .cumulativeSum, source: .bestAvailable),
            quantity(.dietaryCarbs, .dietaryCarbohydrates, unit: .gram(), normalizedUnit: .grams, aggregation: .cumulativeSum, source: .bestAvailable),
            quantity(.dietaryFat, .dietaryFatTotal, unit: .gram(), normalizedUnit: .grams, aggregation: .cumulativeSum, source: .bestAvailable),
            quantity(.dietaryFiber, .dietaryFiber, unit: .gram(), normalizedUnit: .grams, aggregation: .cumulativeSum, source: .bestAvailable),
            quantity(.dietarySugar, .dietarySugar, unit: .gram(), normalizedUnit: .grams, aggregation: .cumulativeSum, source: .bestAvailable),
            quantity(.dietaryWater, .dietaryWater, unit: .literUnit(with: .milli), normalizedUnit: .ml, aggregation: .cumulativeSum, source: .bestAvailable),
            quantity(.dietaryCaffeine, .dietaryCaffeine, unit: .gramUnit(with: .milli), normalizedUnit: .mg, aggregation: .cumulativeSum, source: .bestAvailable),
            quantity(.bloodPressureSystolic, .bloodPressureSystolic, unit: .millimeterOfMercury(), normalizedUnit: .mmHg, aggregation: .discreteAverage, source: .bestAvailable),
            quantity(.bloodPressureDiastolic, .bloodPressureDiastolic, unit: .millimeterOfMercury(), normalizedUnit: .mmHg, aggregation: .discreteAverage, source: .bestAvailable),
            quantity(.bloodGlucose, .bloodGlucose, unit: HKUnit.moleUnit(with: .milli, molarMass: HKUnitMolarMassBloodGlucose).unitDivided(by: .liter()), normalizedUnit: .mmolPerL, aggregation: .discreteAverage, source: .bestAvailable),
            quantity(.bodyTemperature, .bodyTemperature, unit: .degreeCelsius(), normalizedUnit: .celsius, aggregation: .discreteAverage, source: .bestAvailable),
            quantity(.walkingSpeed, .walkingSpeed, unit: HKUnit.meter().unitDivided(by: .second()), normalizedUnit: .metersPerSecond, aggregation: .discreteAverage, source: .appleWatchOnly),
            quantity(.walkingStepLength, .walkingStepLength, unit: .meterUnit(with: .centi), normalizedUnit: .cm, aggregation: .discreteAverage, source: .appleWatchOnly),
            quantity(.walkingAsymmetry, .walkingAsymmetryPercentage, unit: percent, normalizedUnit: .percent, scale: 100, aggregation: .discreteAverage, source: .appleWatchOnly),
            HealthMetricDescriptor(metricType: .workout, kind: .workout, healthKitUnit: nil, normalizedUnit: nil, scale: 1, aggregation: .duration, sourcePreference: .bestAvailable, granularClass: .interval),
        ]
        descriptors.append(contentsOf: sleepTypes.map {
            category($0, .sleepAnalysis, normalizedUnit: .hours, source: .bestAvailable)
        })
        return Dictionary(uniqueKeysWithValues: descriptors.map { ($0.metricType, $0) })
    }()

    static func descriptor(for rawMetricType: String) -> HealthMetricDescriptor? {
        guard let metricType = MetricType(rawValue: rawMetricType) else { return nil }
        return catalog[metricType]
    }
}
