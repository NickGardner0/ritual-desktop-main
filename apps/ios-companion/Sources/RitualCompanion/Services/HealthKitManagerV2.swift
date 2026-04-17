import Foundation
import HealthKit

/// V2 HealthKit Manager with incremental sync via HKAnchoredObjectQuery
/// Supports source preferences, workout sync, and proper sleep attribution
final class HealthKitManagerV2: @unchecked Sendable {
    
    // MARK: - Properties
    
    private let healthStore = HKHealthStore()
    private let anchorStorage = AnchorStorage.shared
    
    /// Source preference policy - defines which sources to prefer for each metric type
    enum SourcePreference {
        case appleWatchOnly
        case appleWatchPreferred  // Apple Watch > iPhone > Third Party
        case bestAvailable
    }
    
    /// Source preference per metric type
    private static let sourcePreferences: [MetricType: SourcePreference] = [
        // Activity - Apple Watch only to avoid double counting from iPhone
        .steps: .appleWatchOnly,
        .activeEnergy: .appleWatchOnly,
        .basalEnergy: .appleWatchOnly,
        .distance: .appleWatchOnly,
        .flightsClimbed: .appleWatchOnly,
        .exerciseTime: .appleWatchOnly,
        .standTime: .appleWatchOnly,
        
        // Heart - Apple Watch preferred (most accurate)
        .hr: .appleWatchPreferred,
        .hrv: .appleWatchOnly,  // Only Apple Watch provides reliable HRV
        .restingHr: .appleWatchPreferred,
        .walkingHr: .appleWatchOnly,
        
        // Respiratory - Apple Watch only
        .respiratoryRate: .appleWatchOnly,
        .oxygenSaturation: .appleWatchOnly,
        
        // Sleep - Best available (Apple Watch or iPhone or third party)
        .sleepSession: .bestAvailable,
        .sleepREM: .bestAvailable,
        .sleepDeep: .bestAvailable,
        .sleepCore: .bestAvailable,
        
        // Workouts - Best available
        .workout: .bestAvailable,

        // Mindfulness - Best available
        .mindfulMinutes: .bestAvailable,

        // Body Measurements - Best available (manual entry or scale)
        .bodyMass: .bestAvailable,
        .bodyMassIndex: .bestAvailable,
        .bodyFatPercentage: .bestAvailable,
        .leanBodyMass: .bestAvailable,
        .height: .bestAvailable,
        .waistCircumference: .bestAvailable,

        // Nutrition - Best available (food tracking apps)
        .dietaryEnergy: .bestAvailable,
        .dietaryProtein: .bestAvailable,
        .dietaryCarbs: .bestAvailable,
        .dietaryFat: .bestAvailable,
        .dietaryFiber: .bestAvailable,
        .dietarySugar: .bestAvailable,
        .dietaryWater: .bestAvailable,
        .dietaryCaffeine: .bestAvailable,

        // Vitals - Best available (could be manual or device)
        .bloodPressureSystolic: .bestAvailable,
        .bloodPressureDiastolic: .bestAvailable,
        .bloodGlucose: .bestAvailable,
        .bodyTemperature: .bestAvailable,

        // Mobility - Apple Watch only
        .walkingSpeed: .appleWatchOnly,
        .walkingStepLength: .appleWatchOnly,
        .walkingAsymmetry: .appleWatchOnly,
    ]
    
    /// Types we want to read from HealthKit
    private let readTypes: Set<HKSampleType> = {
        var types = Set<HKSampleType>()
        
        // Activity
        [HKQuantityTypeIdentifier.stepCount, .activeEnergyBurned, .basalEnergyBurned,
         .distanceWalkingRunning, .flightsClimbed, .appleExerciseTime, .appleStandTime].forEach {
            if let type = HKQuantityType.quantityType(forIdentifier: $0) { types.insert(type) }
        }
        
        // Heart
        [HKQuantityTypeIdentifier.heartRate, .heartRateVariabilitySDNN, .restingHeartRate, .walkingHeartRateAverage].forEach {
            if let type = HKQuantityType.quantityType(forIdentifier: $0) { types.insert(type) }
        }
        
        // Respiratory
        [HKQuantityTypeIdentifier.respiratoryRate, .oxygenSaturation].forEach {
            if let type = HKQuantityType.quantityType(forIdentifier: $0) { types.insert(type) }
        }
        
        // Sleep & Mindfulness (Category types)
        if let sleep = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis) { types.insert(sleep) }
        if let mindful = HKCategoryType.categoryType(forIdentifier: .mindfulSession) { types.insert(mindful) }

        // Body Measurements
        [HKQuantityTypeIdentifier.bodyMass, .bodyMassIndex, .bodyFatPercentage,
         .leanBodyMass, .height, .waistCircumference].forEach {
            if let type = HKQuantityType.quantityType(forIdentifier: $0) { types.insert(type) }
        }

        // Nutrition
        [HKQuantityTypeIdentifier.dietaryEnergyConsumed, .dietaryProtein,
         .dietaryCarbohydrates, .dietaryFatTotal, .dietaryFiber,
         .dietarySugar, .dietaryWater, .dietaryCaffeine].forEach {
            if let type = HKQuantityType.quantityType(forIdentifier: $0) { types.insert(type) }
        }

        // Vitals (additional)
        [HKQuantityTypeIdentifier.bloodPressureSystolic, .bloodPressureDiastolic,
         .bloodGlucose, .bodyTemperature].forEach {
            if let type = HKQuantityType.quantityType(forIdentifier: $0) { types.insert(type) }
        }

        // Mobility
        [HKQuantityTypeIdentifier.walkingSpeed, .walkingStepLength,
         .walkingAsymmetryPercentage].forEach {
            if let type = HKQuantityType.quantityType(forIdentifier: $0) { types.insert(type) }
        }

        // Workouts
        types.insert(HKObjectType.workoutType())

        return types
    }()
    
    // MARK: - Types
    
    struct IncrementalSyncResult {
        let added: [NormalizedMetric]
        let deleted: [String]  // HealthKit UUIDs
        let modified: [NormalizedMetric]
        let newAnchor: HKQueryAnchor?
        let metricType: String
    }
    
    // MARK: - Authorization
    
    var isHealthDataAvailable: Bool {
        HKHealthStore.isHealthDataAvailable()
    }
    
    func checkAuthorizationStatus() async -> HealthAccessStatus {
        guard isHealthDataAvailable else { return .denied }
        
        do {
            let status = try await healthStore.statusForAuthorizationRequest(toShare: [], read: readTypes)
            switch status {
            case .unknown:
                return .notDetermined
            case .unnecessary:
                let hasAccess = await verifyReadAccess()
                return hasAccess ? .authorized : .denied
            case .shouldRequest:
                return .notDetermined
            @unknown default:
                return .notDetermined
            }
        } catch {
            let hasAccess = await verifyReadAccess()
            return hasAccess ? .authorized : .notDetermined
        }
    }
    
    private func verifyReadAccess() async -> Bool {
        guard let stepType = HKQuantityType.quantityType(forIdentifier: .stepCount) else { return false }
        
        do {
            let now = Date()
            let startOfDay = Calendar.current.startOfDay(for: now)
            let predicate = HKQuery.predicateForSamples(withStart: startOfDay, end: now, options: .strictStartDate)
            
            _ = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Double, Error>) in
                let query = HKStatisticsQuery(quantityType: stepType, quantitySamplePredicate: predicate, options: .cumulativeSum) { _, result, error in
                    if let error = error {
                        continuation.resume(throwing: error)
                        return
                    }
                    continuation.resume(returning: result?.sumQuantity()?.doubleValue(for: .count()) ?? 0)
                }
                healthStore.execute(query)
            }
            return true
        } catch {
            return false
        }
    }
    
    func requestAuthorization() async throws -> Bool {
        guard isHealthDataAvailable else { throw HealthKitError.notAvailable }
        try await healthStore.requestAuthorization(toShare: [], read: readTypes)
        return await checkAuthorizationStatus() == .authorized
    }
    
    // MARK: - Incremental Sync (HKAnchoredObjectQuery)
    
    /// Fetch incremental changes for a metric type since last anchor
    func fetchIncrementalChanges(for metricType: String) async throws -> IncrementalSyncResult {
        guard let sampleType = healthKitType(for: metricType) else {
            throw HealthKitError.queryFailed("Unknown metric type: \(metricType)")
        }
        
        let existingAnchor = anchorStorage.getAnchor(for: metricType)
        
        return try await withCheckedThrowingContinuation { continuation in
            let query = HKAnchoredObjectQuery(
                type: sampleType,
                predicate: nil,  // No date restriction - anchor handles it
                anchor: existingAnchor,
                limit: 5000
            ) { _, addedSamples, deletedSamples, newAnchor, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }

                // Convert added samples to NormalizedMetric
                let added = Self.convertSamplesToMetrics(
                    addedSamples ?? [],
                    metricType: metricType,
                    sampleType: sampleType
                )
                
                // Extract deleted sample UUIDs
                let deleted = (deletedSamples ?? []).map { $0.uuid.uuidString }
                
                // For now, treat modifications as part of "added" (HealthKit doesn't distinguish)
                let modified: [NormalizedMetric] = []
                
                #if DEBUG
                print("📊 Incremental sync for \(metricType): \(added.count) added, \(deleted.count) deleted")
                #endif
                
                continuation.resume(returning: IncrementalSyncResult(
                    added: added,
                    deleted: deleted,
                    modified: modified,
                    newAnchor: newAnchor,
                    metricType: metricType
                ))
            }
            
            healthStore.execute(query)
        }
    }
    
    /// Fetch incremental changes for multiple metric types
    func fetchAllIncrementalChanges(for metricTypes: [String]) async throws -> [IncrementalSyncResult] {
        var results: [IncrementalSyncResult] = []
        
        for metricType in metricTypes {
            do {
                let result = try await fetchIncrementalChanges(for: metricType)
                results.append(result)
            } catch {
                #if DEBUG
                print("⚠️ Failed to fetch incremental changes for \(metricType): \(error)")
                #endif
            }
        }
        
        return results
    }
    
    /// Save anchor after successful backend ACK
    func confirmAnchor(for metricType: String, anchor: HKQueryAnchor) {
        anchorStorage.saveAnchor(anchor, for: metricType)
    }

    /// Build serialized anchor tokens for transport to backend.
    /// Tokens are base64-encoded secure archives of HKQueryAnchor.
    func makeAnchorTokens(_ anchors: [String: HKQueryAnchor]) -> [String: String] {
        var tokens: [String: String] = [:]

        for (metricType, anchor) in anchors {
            do {
                let data = try NSKeyedArchiver.archivedData(withRootObject: anchor, requiringSecureCoding: true)
                tokens[metricType] = data.base64EncodedString()
            } catch {
                #if DEBUG
                print("⚠️ Failed to serialize anchor for \(metricType): \(error)")
                #endif
            }
        }

        return tokens
    }

    /// Confirm and persist anchors only when backend echoes the matching tokens.
    /// This prevents local anchor advancement unless server accepted the payload.
    func confirmAnchorsFromServer(
        confirmedAnchorTokens: [String: String]?,
        pendingAnchors: [String: HKQueryAnchor]
    ) {
        guard let confirmedAnchorTokens, !confirmedAnchorTokens.isEmpty else { return }
        guard !pendingAnchors.isEmpty else { return }

        let pendingTokens = makeAnchorTokens(pendingAnchors)

        for (metricType, confirmedToken) in confirmedAnchorTokens {
            guard let pendingAnchor = pendingAnchors[metricType],
                  let pendingToken = pendingTokens[metricType] else {
                continue
            }

            guard pendingToken == confirmedToken else {
                #if DEBUG
                print("⚠️ Anchor token mismatch for \(metricType); skipping local anchor update")
                #endif
                continue
            }

            confirmAnchor(for: metricType, anchor: pendingAnchor)
        }
    }

    /// Bootstrap an incremental anchor at "now" without syncing historical samples.
    /// Useful after initial aggregate sync so future runs can use true incremental deletes.
    func captureAnchorBaseline(for metricType: String) async throws -> HKQueryAnchor? {
        guard let sampleType = healthKitType(for: metricType) else {
            throw HealthKitError.queryFailed("Unknown metric type: \(metricType)")
        }

        let now = Date()
        let predicate = HKQuery.predicateForSamples(withStart: now, end: nil, options: .strictStartDate)

        return try await withCheckedThrowingContinuation { continuation in
            let query = HKAnchoredObjectQuery(
                type: sampleType,
                predicate: predicate,
                anchor: nil,
                limit: HKObjectQueryNoLimit
            ) { _, _, _, newAnchor, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }
                continuation.resume(returning: newAnchor)
            }
            healthStore.execute(query)
        }
    }
    
    /// Reset anchor for full resync
    func resetAnchor(for metricType: String) {
        anchorStorage.clearAnchor(for: metricType)
    }
    
    // MARK: - Sample Conversion
    
    private static func convertSamplesToMetrics(
        _ samples: [HKSample],
        metricType: String,
        sampleType: HKSampleType
    ) -> [NormalizedMetric] {
        var metrics: [NormalizedMetric] = []
        
        // Get source preference for this metric type
        let preference = sourcePreferences[MetricType(rawValue: metricType) ?? .steps] ?? .bestAvailable
        
        // Filter samples by source preference
        let filteredSamples = filterSamplesBySource(samples, preference: preference)
        
        for sample in filteredSamples {
            if let metric = convertSampleToMetric(sample, metricType: metricType) {
                metrics.append(metric)
            }
        }
        
        return metrics
    }
    
    private static func filterSamplesBySource(_ samples: [HKSample], preference: SourcePreference) -> [HKSample] {
        switch preference {
        case .appleWatchOnly:
            return samples.filter { isFromAppleWatch($0) }
            
        case .appleWatchPreferred:
            // Group by time window, prefer Apple Watch samples
            let watchSamples = samples.filter { isFromAppleWatch($0) }
            if !watchSamples.isEmpty {
                return watchSamples
            }
            // Fallback to all samples if no Apple Watch data
            return samples
            
        case .bestAvailable:
            return samples
        }
    }
    
    private static func isFromAppleWatch(_ sample: HKSample) -> Bool {
        let source = sample.sourceRevision.source
        let name = source.name.lowercased()
        let bundleId = source.bundleIdentifier
        
        // Apple Watch sources
        if name.contains("apple watch") { return true }
        if bundleId.hasPrefix("com.apple.health") && !name.lowercased().contains("iphone") { return true }
        
        return false
    }
    
    private static func convertSampleToMetric(_ sample: HKSample, metricType: String) -> NormalizedMetric? {
        let source = sample.sourceRevision.source
        let externalId = sample.uuid.uuidString
        let sourceBundleId = source.bundleIdentifier
        let sourceDeviceName = sample.device?.name ?? source.name
        
        // Determine attributed date (for sleep: use wake day)
        let attributedDate = calculateAttributedDate(for: sample, metricType: metricType)
        
        switch sample {
        case let quantitySample as HKQuantitySample:
            return convertQuantitySample(
                quantitySample,
                metricType: metricType,
                externalId: externalId,
                sourceBundleId: sourceBundleId,
                sourceDeviceName: sourceDeviceName,
                attributedDate: attributedDate
            )
            
        case let categorySample as HKCategorySample:
            return convertCategorySample(
                categorySample,
                metricType: metricType,
                externalId: externalId,
                sourceBundleId: sourceBundleId,
                sourceDeviceName: sourceDeviceName,
                attributedDate: attributedDate
            )
            
        case let workout as HKWorkout:
            return convertWorkout(
                workout,
                externalId: externalId,
                sourceBundleId: sourceBundleId,
                sourceDeviceName: sourceDeviceName,
                attributedDate: attributedDate
            )
            
        default:
            return nil
        }
    }
    
    /// Calculate the attributed date for a sample
    /// For sleep: uses wake day (endDate). For everything else: uses start day.
    private static func calculateAttributedDate(for sample: HKSample, metricType: String) -> Date {
        let calendar = Calendar.current
        
        // Sleep attribution: use the wake day (when the user wakes up)
        if metricType.hasPrefix("sleep") {
            // Return the local day of endDate
            return calendar.startOfDay(for: sample.endDate)
        }
        
        // All other metrics: use start day
        return calendar.startOfDay(for: sample.startDate)
    }
    
    private static func convertQuantitySample(
        _ sample: HKQuantitySample,
        metricType: String,
        externalId: String,
        sourceBundleId: String,
        sourceDeviceName: String,
        attributedDate: Date
    ) -> NormalizedMetric? {
        let (value, unit) = extractValueAndUnit(from: sample, metricType: metricType)
        
        guard let metricTypeEnum = MetricType(rawValue: metricType) else { return nil }
        
        return NormalizedMetric(
            source: .appleHealth,
            metricType: metricTypeEnum,
            startTime: sample.startDate,
            endTime: sample.endDate,
            value: value,
            unit: unit,
            externalId: externalId,
            sourceBundleId: sourceBundleId,
            sourceDeviceName: sourceDeviceName,
            attributedDate: attributedDate,
            recordedAt: Date()
        )
    }
    
    private static func extractValueAndUnit(from sample: HKQuantitySample, metricType: String) -> (Double, MetricUnit) {
        switch metricType {
        case "steps", "flights_climbed":
            return (sample.quantity.doubleValue(for: .count()), .count)
        case "active_energy", "basal_energy":
            return (sample.quantity.doubleValue(for: .kilocalorie()), .kcal)
        case "distance":
            return (sample.quantity.doubleValue(for: .meter()), .meters)
        case "exercise_time", "stand_time":
            return (sample.quantity.doubleValue(for: .minute()), .minutes)
        case "hr", "resting_hr", "walking_hr":
            return (sample.quantity.doubleValue(for: .count().unitDivided(by: .minute())), .bpm)
        case "hrv":
            return (sample.quantity.doubleValue(for: .secondUnit(with: .milli)), .ms)
        case "respiratory_rate":
            return (sample.quantity.doubleValue(for: .count().unitDivided(by: .minute())), .breathsPerMinute)
        case "oxygen_saturation":
            let rawValue = sample.quantity.doubleValue(for: .percent()) * 100
            let value = min(max(rawValue, 0), 100) // Clamp to valid range
            return (value, .percent)
        // Body Measurements
        case "body_mass":
            return (sample.quantity.doubleValue(for: .gramUnit(with: .kilo)), .kg)
        case "body_mass_index":
            return (sample.quantity.doubleValue(for: .count()), .count)
        case "body_fat_percentage":
            return (sample.quantity.doubleValue(for: .percent()) * 100, .percent)
        case "lean_body_mass":
            return (sample.quantity.doubleValue(for: .gramUnit(with: .kilo)), .kg)
        case "height":
            return (sample.quantity.doubleValue(for: .meterUnit(with: .centi)), .cm)
        case "waist_circumference":
            return (sample.quantity.doubleValue(for: .meterUnit(with: .centi)), .cm)
        // Nutrition
        case "dietary_energy":
            return (sample.quantity.doubleValue(for: .kilocalorie()), .kcal)
        case "dietary_protein", "dietary_carbs", "dietary_fat", "dietary_fiber", "dietary_sugar":
            return (sample.quantity.doubleValue(for: .gram()), .grams)
        case "dietary_water":
            return (sample.quantity.doubleValue(for: .literUnit(with: .milli)), .ml)
        case "dietary_caffeine":
            return (sample.quantity.doubleValue(for: .gramUnit(with: .milli)), .mg)
        // Vitals
        case "blood_pressure_systolic", "blood_pressure_diastolic":
            return (sample.quantity.doubleValue(for: .millimeterOfMercury()), .mmHg)
        case "blood_glucose":
            return (sample.quantity.doubleValue(for: HKUnit.moleUnit(with: .milli, molarMass: HKUnitMolarMassBloodGlucose).unitDivided(by: .liter())), .mmolPerL)
        case "body_temperature":
            return (sample.quantity.doubleValue(for: .degreeCelsius()), .celsius)
        // Mobility
        case "walking_speed":
            return (sample.quantity.doubleValue(for: HKUnit.meter().unitDivided(by: .second())), .metersPerSecond)
        case "walking_step_length":
            return (sample.quantity.doubleValue(for: .meterUnit(with: .centi)), .cm)
        case "walking_asymmetry":
            return (sample.quantity.doubleValue(for: .percent()) * 100, .percent)
        default:
            return (sample.quantity.doubleValue(for: .count()), .count)
        }
    }

    private static func convertCategorySample(
        _ sample: HKCategorySample,
        metricType: String,
        externalId: String,
        sourceBundleId: String,
        sourceDeviceName: String,
        attributedDate: Date
    ) -> NormalizedMetric? {
        guard let metricTypeEnum = MetricType(rawValue: metricType) else { return nil }
        
        let duration = sample.endDate.timeIntervalSince(sample.startDate)
        
        // For sleep, convert to hours; for mindful, convert to minutes
        let (value, unit): (Double, MetricUnit) = {
            if metricType.hasPrefix("sleep") {
                return (duration / 3600.0, .hours)
            } else {
                return (duration / 60.0, .minutes)
            }
        }()
        
        // Add sleep stage info to raw payload
        var rawPayload: [String: AnyCodable]? = nil
        if metricType == "sleep_session" {
            let sleepValue = HKCategoryValueSleepAnalysis(rawValue: sample.value)
            let stageStr: String
            switch sleepValue {
            case .asleepREM: stageStr = "rem"
            case .asleepDeep: stageStr = "deep"
            case .asleepCore: stageStr = "core"
            case .awake: stageStr = "awake"
            default: stageStr = "asleep"
            }
            rawPayload = ["sleep_stage": AnyCodable(stageStr)]
        }
        
        return NormalizedMetric(
            source: .appleHealth,
            metricType: metricTypeEnum,
            startTime: sample.startDate,
            endTime: sample.endDate,
            value: value,
            unit: unit,
            externalId: externalId,
            sourceBundleId: sourceBundleId,
            sourceDeviceName: sourceDeviceName,
            attributedDate: attributedDate,
            recordedAt: Date(),
            rawPayload: rawPayload
        )
    }
    
    private static func convertWorkout(
        _ workout: HKWorkout,
        externalId: String,
        sourceBundleId: String,
        sourceDeviceName: String,
        attributedDate: Date
    ) -> NormalizedMetric? {
        let duration = workout.duration / 60.0  // Convert to minutes
        
        // Build workout details for raw payload
        var rawPayload: [String: AnyCodable] = [
            "activity_type": AnyCodable(workoutActivityTypeString(workout.workoutActivityType)),
            "duration_minutes": AnyCodable(duration)
        ]
        
        if let totalDistance = workout.totalDistance {
            rawPayload["total_distance_meters"] = AnyCodable(totalDistance.doubleValue(for: .meter()))
        }
        
        if let totalEnergy = workout.totalEnergyBurned {
            rawPayload["total_energy_kcal"] = AnyCodable(totalEnergy.doubleValue(for: .kilocalorie()))
        }
        
        return NormalizedMetric(
            source: .appleHealth,
            metricType: .workout,
            startTime: workout.startDate,
            endTime: workout.endDate,
            value: duration,
            unit: .minutes,
            externalId: externalId,
            sourceBundleId: sourceBundleId,
            sourceDeviceName: sourceDeviceName,
            attributedDate: attributedDate,
            recordedAt: Date(),
            rawPayload: rawPayload
        )
    }
    
    private static func workoutActivityTypeString(_ type: HKWorkoutActivityType) -> String {
        switch type {
        case .running: return "running"
        case .cycling: return "cycling"
        case .walking: return "walking"
        case .swimming: return "swimming"
        case .yoga: return "yoga"
        case .functionalStrengthTraining, .traditionalStrengthTraining: return "strength_training"
        case .hiking: return "hiking"
        case .dance: return "dance"
        case .elliptical: return "elliptical"
        case .rowing: return "rowing"
        case .stairClimbing: return "stair_climbing"
        case .highIntensityIntervalTraining: return "hiit"
        case .pilates: return "pilates"
        case .crossTraining: return "cross_training"
        default: return "other"
        }
    }
    
    // MARK: - HealthKit Type Mapping
    
    private func healthKitType(for metricType: String) -> HKSampleType? {
        switch metricType {
        case "steps": return HKQuantityType.quantityType(forIdentifier: .stepCount)
        case "active_energy": return HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)
        case "basal_energy": return HKQuantityType.quantityType(forIdentifier: .basalEnergyBurned)
        case "distance": return HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning)
        case "flights_climbed": return HKQuantityType.quantityType(forIdentifier: .flightsClimbed)
        case "exercise_time": return HKQuantityType.quantityType(forIdentifier: .appleExerciseTime)
        case "stand_time": return HKQuantityType.quantityType(forIdentifier: .appleStandTime)
        case "hr": return HKQuantityType.quantityType(forIdentifier: .heartRate)
        case "hrv": return HKQuantityType.quantityType(forIdentifier: .heartRateVariabilitySDNN)
        case "resting_hr": return HKQuantityType.quantityType(forIdentifier: .restingHeartRate)
        case "walking_hr": return HKQuantityType.quantityType(forIdentifier: .walkingHeartRateAverage)
        case "respiratory_rate": return HKQuantityType.quantityType(forIdentifier: .respiratoryRate)
        case "oxygen_saturation": return HKQuantityType.quantityType(forIdentifier: .oxygenSaturation)
        case "sleep_session", "sleep_asleep", "sleep_awake", "sleep_rem", "sleep_deep", "sleep_core":
            return HKCategoryType.categoryType(forIdentifier: .sleepAnalysis)
        case "mindful_minutes": return HKCategoryType.categoryType(forIdentifier: .mindfulSession)
        case "workout": return HKObjectType.workoutType()
        // Body Measurements
        case "body_mass": return HKQuantityType.quantityType(forIdentifier: .bodyMass)
        case "body_mass_index": return HKQuantityType.quantityType(forIdentifier: .bodyMassIndex)
        case "body_fat_percentage": return HKQuantityType.quantityType(forIdentifier: .bodyFatPercentage)
        case "lean_body_mass": return HKQuantityType.quantityType(forIdentifier: .leanBodyMass)
        case "height": return HKQuantityType.quantityType(forIdentifier: .height)
        case "waist_circumference": return HKQuantityType.quantityType(forIdentifier: .waistCircumference)
        // Nutrition
        case "dietary_energy": return HKQuantityType.quantityType(forIdentifier: .dietaryEnergyConsumed)
        case "dietary_protein": return HKQuantityType.quantityType(forIdentifier: .dietaryProtein)
        case "dietary_carbs": return HKQuantityType.quantityType(forIdentifier: .dietaryCarbohydrates)
        case "dietary_fat": return HKQuantityType.quantityType(forIdentifier: .dietaryFatTotal)
        case "dietary_fiber": return HKQuantityType.quantityType(forIdentifier: .dietaryFiber)
        case "dietary_sugar": return HKQuantityType.quantityType(forIdentifier: .dietarySugar)
        case "dietary_water": return HKQuantityType.quantityType(forIdentifier: .dietaryWater)
        case "dietary_caffeine": return HKQuantityType.quantityType(forIdentifier: .dietaryCaffeine)
        // Vitals
        case "blood_pressure_systolic": return HKQuantityType.quantityType(forIdentifier: .bloodPressureSystolic)
        case "blood_pressure_diastolic": return HKQuantityType.quantityType(forIdentifier: .bloodPressureDiastolic)
        case "blood_glucose": return HKQuantityType.quantityType(forIdentifier: .bloodGlucose)
        case "body_temperature": return HKQuantityType.quantityType(forIdentifier: .bodyTemperature)
        // Mobility
        case "walking_speed": return HKQuantityType.quantityType(forIdentifier: .walkingSpeed)
        case "walking_step_length": return HKQuantityType.quantityType(forIdentifier: .walkingStepLength)
        case "walking_asymmetry": return HKQuantityType.quantityType(forIdentifier: .walkingAsymmetryPercentage)
        default: return nil
        }
    }
    
    // MARK: - Daily Aggregated Sync (RECOMMENDED - sends daily totals instead of raw samples)
    
    /// Aggregation type for different metrics
    enum AggregationType {
        case cumulativeSum    // Steps, calories, distance
        case discreteAverage  // Heart rate, HRV
        case discreteMin      // Resting HR
        case discreteMax      // For peaks
        case duration         // Sleep, workouts
    }
    
    /// Get the aggregation type for a metric
    private func aggregationType(for metricType: String) -> AggregationType {
        switch metricType {
        case "steps", "active_energy", "basal_energy", "distance", "flights_climbed", "exercise_time", "stand_time":
            return .cumulativeSum
        case "hr", "walking_hr", "hrv":
            return .discreteAverage
        case "resting_hr":
            return .discreteMin  // Daily resting HR is typically the minimum
        // Nutrition — cumulative daily totals
        case "dietary_energy", "dietary_protein", "dietary_carbs", "dietary_fat",
             "dietary_fiber", "dietary_sugar", "dietary_water", "dietary_caffeine":
            return .cumulativeSum
        // Body measurements — latest/average for the day
        case "body_mass", "body_mass_index", "body_fat_percentage", "lean_body_mass",
             "height", "waist_circumference":
            return .discreteAverage
        // Respiratory — discrete averages
        case "oxygen_saturation", "respiratory_rate":
            return .discreteAverage
        // Vitals — averages
        case "blood_pressure_systolic", "blood_pressure_diastolic", "blood_glucose", "body_temperature":
            return .discreteAverage
        // Mobility — averages
        case "walking_speed", "walking_step_length", "walking_asymmetry":
            return .discreteAverage
        default:
            return .discreteAverage  // Safe default — discrete types crash with cumulativeSum
        }
    }
    
    /// Fetch DAILY AGGREGATED metrics for a type over an exact date range.
    /// Range is inclusive by day (startOfDay(startDate) through endDate).
    func fetchDailyAggregatedMetrics(for metricType: String, startDate: Date, endDate: Date) async throws -> [NormalizedMetric] {
        let calendar = Calendar.current
        let normalizedStart = calendar.startOfDay(for: min(startDate, endDate))
        let normalizedEnd = max(startDate, endDate)
        let anchorDate = calendar.startOfDay(for: normalizedEnd)
        let queryEnd = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: normalizedEnd)) ?? normalizedEnd

        guard let quantityType = healthKitType(for: metricType) as? HKQuantityType else {
            // For non-quantity types (sleep, workouts), use raw sample approach with aggregation.
            return try await fetchAndAggregateCategoryMetrics(for: metricType, startDate: normalizedStart, endDate: queryEnd)
        }
        
        // Daily interval
        var interval = DateComponents()
        interval.day = 1
        
        // Get the right statistics options
        let aggregation = aggregationType(for: metricType)
        let options: HKStatisticsOptions
        switch aggregation {
        case .cumulativeSum:
            options = .cumulativeSum
        case .discreteAverage:
            options = .discreteAverage
        case .discreteMin:
            options = .discreteMin
        case .discreteMax:
            options = .discreteMax
        case .duration:
            options = .cumulativeSum
        }
        
        let predicate = HKQuery.predicateForSamples(withStart: normalizedStart, end: queryEnd, options: .strictStartDate)
        
        return try await withCheckedThrowingContinuation { continuation in
            let query = HKStatisticsCollectionQuery(
                quantityType: quantityType,
                quantitySamplePredicate: predicate,
                options: options,
                anchorDate: anchorDate,
                intervalComponents: interval
            )
            
            query.initialResultsHandler = { _, results, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }

                guard let statsCollection = results else {
                    continuation.resume(returning: [])
                    return
                }
                
                var metrics: [NormalizedMetric] = []
                
                statsCollection.enumerateStatistics(from: normalizedStart, to: queryEnd) { statistics, _ in
                    guard let metric = Self.convertStatisticsToMetric(
                        statistics,
                        metricType: metricType,
                        aggregation: aggregation
                    ) else { return }
                    
                    metrics.append(metric)
                }
                
                #if DEBUG
                print("📊 Daily aggregated sync for \(metricType): \(metrics.count) daily values (\(normalizedStart) -> \(queryEnd))")
                #endif
                continuation.resume(returning: metrics)
            }
            
            healthStore.execute(query)
        }
    }

    /// Fetch DAILY AGGREGATED metrics for a type using a rolling days-back window.
    /// This dramatically reduces data volume (e.g., 50,000 HR samples -> ~700 daily averages).
    func fetchDailyAggregatedMetrics(for metricType: String, daysBack: Int = 730) async throws -> [NormalizedMetric] {
        let calendar = Calendar.current
        let now = Date()
        let startOfToday = calendar.startOfDay(for: now)
        let startDate = calendar.date(byAdding: .day, value: -daysBack, to: startOfToday) ?? startOfToday
        return try await fetchDailyAggregatedMetrics(for: metricType, startDate: startDate, endDate: now)
    }
    
    /// Convert HKStatistics (daily aggregate) to NormalizedMetric
    private static func convertStatisticsToMetric(
        _ statistics: HKStatistics,
        metricType: String,
        aggregation: AggregationType
    ) -> NormalizedMetric? {
        // Get the aggregated value
        let quantity: HKQuantity?
        switch aggregation {
        case .cumulativeSum:
            quantity = statistics.sumQuantity()
        case .discreteAverage:
            quantity = statistics.averageQuantity()
        case .discreteMin:
            quantity = statistics.minimumQuantity()
        case .discreteMax:
            quantity = statistics.maximumQuantity()
        case .duration:
            quantity = statistics.sumQuantity()
        }
        
        guard let qty = quantity else { return nil }
        
        let (value, unit) = extractValueFromQuantity(qty, metricType: metricType)
        
        // Skip zero values (no data for that day)
        guard value > 0 else { return nil }
        
        guard let metricTypeEnum = MetricType(rawValue: metricType) else { return nil }
        
        let dayStart = statistics.startDate
        let dayEnd = statistics.endDate
        
        // Generate a stable external ID based on date + metric type (for idempotency)
        let dateFormatter = ISO8601DateFormatter()
        dateFormatter.formatOptions = [.withFullDate]
        let dateString = dateFormatter.string(from: dayStart)
        let externalId = "daily_\(metricType)_\(dateString)"
        
        return NormalizedMetric(
            source: .appleHealth,
            metricType: metricTypeEnum,
            startTime: dayStart,
            endTime: dayEnd,
            value: value,
            unit: unit,
            externalId: externalId,
            sourceBundleId: "com.apple.health.aggregated",
            sourceDeviceName: "Apple Health (Daily)",
            attributedDate: dayStart,  // Day start for daily aggregates
            recordedAt: Date(),
            rawPayload: ["aggregation": AnyCodable(String(describing: aggregation))]
        )
    }
    
    /// Extract value and unit from an HKQuantity
    private static func extractValueFromQuantity(_ quantity: HKQuantity, metricType: String) -> (Double, MetricUnit) {
        switch metricType {
        case "steps", "flights_climbed":
            return (quantity.doubleValue(for: .count()), .count)
        case "active_energy", "basal_energy":
            return (quantity.doubleValue(for: .kilocalorie()), .kcal)
        case "distance":
            return (quantity.doubleValue(for: .meter()), .meters)
        case "exercise_time", "stand_time":
            return (quantity.doubleValue(for: .minute()), .minutes)
        case "hr", "resting_hr", "walking_hr":
            return (quantity.doubleValue(for: .count().unitDivided(by: .minute())), .bpm)
        case "hrv":
            return (quantity.doubleValue(for: .secondUnit(with: .milli)), .ms)
        case "respiratory_rate":
            return (quantity.doubleValue(for: .count().unitDivided(by: .minute())), .breathsPerMinute)
        case "oxygen_saturation":
            let rawValue = quantity.doubleValue(for: .percent()) * 100
            let value = min(max(rawValue, 0), 100) // Clamp to valid range
            return (value, .percent)
        default:
            return (quantity.doubleValue(for: .count()), .count)
        }
    }

    /// Fetch and aggregate category metrics (sleep, mindfulness) by day.
    private func fetchAndAggregateCategoryMetrics(for metricType: String, startDate: Date, endDate: Date) async throws -> [NormalizedMetric] {
        guard let sampleType = healthKitType(for: metricType) else {
            throw HealthKitError.queryFailed("Unknown metric type: \(metricType)")
        }
        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: endDate, options: .strictStartDate)
        
        let samples = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<[HKSample], Error>) in
            let query = HKSampleQuery(
                sampleType: sampleType,
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
            ) { _, samples, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }
                continuation.resume(returning: samples ?? [])
            }
            healthStore.execute(query)
        }
        
        // Aggregate by day
        return aggregateSamplesByDay(samples, metricType: metricType)
    }
    
    /// Aggregate raw samples into daily totals
    private func aggregateSamplesByDay(_ samples: [HKSample], metricType: String) -> [NormalizedMetric] {
        let calendar = Calendar.current
        
        // Group samples by attributed date
        var dailyTotals: [Date: Double] = [:]
        
        for sample in samples {
            guard shouldIncludeCategorySample(sample, for: metricType) else { continue }

            let attributedDate = Self.calculateAttributedDate(for: sample, metricType: metricType)
            let dayStart = calendar.startOfDay(for: attributedDate)
            
            // Calculate duration in appropriate unit
            let duration = sample.endDate.timeIntervalSince(sample.startDate)
            let value: Double
            let isSleep = metricType.hasPrefix("sleep")
            
            if isSleep {
                value = duration / 3600.0  // Hours for sleep
            } else {
                value = duration / 60.0    // Minutes for mindfulness/workouts
            }
            
            dailyTotals[dayStart, default: 0] += value
        }
        
        // Convert to NormalizedMetric
        guard let metricTypeEnum = MetricType(rawValue: metricType) else { return [] }
        
        return dailyTotals.compactMap { (dayStart, totalValue) -> NormalizedMetric? in
            guard totalValue > 0 else { return nil }
            
            let dateFormatter = ISO8601DateFormatter()
            dateFormatter.formatOptions = [.withFullDate]
            let dateString = dateFormatter.string(from: dayStart)
            let externalId = "daily_\(metricType)_\(dateString)"
            
            let unit: MetricUnit = metricType.hasPrefix("sleep") ? .hours : .minutes
            let dayEnd = Calendar.current.date(byAdding: .day, value: 1, to: dayStart) ?? dayStart
            
            return NormalizedMetric(
                source: .appleHealth,
                metricType: metricTypeEnum,
                startTime: dayStart,
                endTime: dayEnd,
                value: totalValue,
                unit: unit,
                externalId: externalId,
                sourceBundleId: "com.apple.health.aggregated",
                sourceDeviceName: "Apple Health (Daily)",
                attributedDate: dayStart,
                recordedAt: Date(),
                rawPayload: ["aggregation": AnyCodable("daily_sum")]
            )
        }.sorted { $0.startTime < $1.startTime }
    }

    /// Restrict sleep metrics to the expected HealthKit sleep stage(s).
    /// Without this filtering, every sleep_* metric can incorrectly include all sleep samples.
    private func shouldIncludeCategorySample(_ sample: HKSample, for metricType: String) -> Bool {
        guard metricType.hasPrefix("sleep") else { return true }
        guard let categorySample = sample as? HKCategorySample else { return false }

        let value = categorySample.value

        switch metricType {
        case "sleep_rem":
            return value == HKCategoryValueSleepAnalysis.asleepREM.rawValue
        case "sleep_deep":
            return value == HKCategoryValueSleepAnalysis.asleepDeep.rawValue
        case "sleep_core":
            return value == HKCategoryValueSleepAnalysis.asleepCore.rawValue
        case "sleep_session":
            let allowedAsleepValues: Set<Int> = [
                HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue,
                HKCategoryValueSleepAnalysis.asleepREM.rawValue,
                HKCategoryValueSleepAnalysis.asleepDeep.rawValue,
                HKCategoryValueSleepAnalysis.asleepCore.rawValue
            ]
            return allowedAsleepValues.contains(value)
        default:
            return true
        }
    }
    
    // MARK: - Full Backfill with Daily Aggregation (RECOMMENDED)
    
    /// Perform a full backfill using DAILY AGGREGATES (much smaller data volume)
    /// This is the recommended method for initial sync and periodic refreshes
    func performDailyAggregatedBackfill(for metricTypes: [String], daysBack: Int = 730, progressHandler: ((Int, Int) -> Void)? = nil) async throws -> [NormalizedMetric] {
        var allMetrics: [NormalizedMetric] = []
        
        #if DEBUG
        print("📊 Starting daily aggregated backfill for \(metricTypes.count) metrics over \(daysBack) days...")
        #endif
        
        for (index, metricType) in metricTypes.enumerated() {
            progressHandler?(index, metricTypes.count)
            
            // Clear anchor since we're doing a fresh aggregated fetch
            anchorStorage.clearAnchor(for: metricType)
            
            do {
                let metrics = try await fetchDailyAggregatedMetrics(for: metricType, daysBack: daysBack)
                allMetrics.append(contentsOf: metrics)
                #if DEBUG
                print("   ✓ \(metricType): \(metrics.count) daily values")
                #endif
            } catch {
                #if DEBUG
                print("   ⚠️ Failed to fetch \(metricType): \(error.localizedDescription)")
                #endif
            }
        }
        
        progressHandler?(metricTypes.count, metricTypes.count)
        
        #if DEBUG
        print("📊 Daily aggregated backfill complete: \(allMetrics.count) total daily values")
        print("   (Compare to ~50,000+ raw samples - this is much more efficient!)")
        #endif
        return allMetrics
    }
    
    // MARK: - Legacy Full Backfill (RAW SAMPLES - NOT RECOMMENDED)
    
    /// Perform a full backfill for specified days (resets anchors)
    /// WARNING: This fetches RAW samples which can be 50,000+ records. Use performDailyAggregatedBackfill instead.
    @available(*, deprecated, message: "Use performDailyAggregatedBackfill instead to avoid excessive raw samples")
    func performFullBackfill(for metricTypes: [String], daysBack: Int = 30, progressHandler: ((Int, Int) -> Void)? = nil) async throws -> [NormalizedMetric] {
        var allMetrics: [NormalizedMetric] = []
        
        let calendar = Calendar.current
        let now = Date()
        let startDate = calendar.date(byAdding: .day, value: -daysBack, to: now)!
        
        for (index, metricType) in metricTypes.enumerated() {
            progressHandler?(index, metricTypes.count)
            
            // Reset anchor for full fetch
            anchorStorage.clearAnchor(for: metricType)
            
            do {
                let metrics = try await fetchHistoricalMetrics(
                    for: metricType,
                    from: startDate,
                    to: now
                )
                allMetrics.append(contentsOf: metrics)
            } catch {
                #if DEBUG
                print("⚠️ Failed to backfill \(metricType): \(error)")
                #endif
            }
        }
        
        progressHandler?(metricTypes.count, metricTypes.count)
        
        #if DEBUG
        print("📊 Full backfill complete: \(allMetrics.count) metrics for \(daysBack) days")
        #endif
        return allMetrics
    }
    
    private func fetchHistoricalMetrics(for metricType: String, from startDate: Date, to endDate: Date) async throws -> [NormalizedMetric] {
        guard let sampleType = healthKitType(for: metricType) else {
            throw HealthKitError.queryFailed("Unknown metric type: \(metricType)")
        }
        
        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: endDate, options: .strictStartDate)
        
        return try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: sampleType,
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
            ) { _, samples, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }
                
                let metrics = Self.convertSamplesToMetrics(samples ?? [], metricType: metricType, sampleType: sampleType)
                continuation.resume(returning: metrics)
            }
            healthStore.execute(query)
        }
    }
}

enum HealthKitError: LocalizedError {
    case notAvailable
    case queryFailed(String)

    var errorDescription: String? {
        switch self {
        case .notAvailable:
            return "Health data is not available on this device."
        case .queryFailed(let message):
            return message
        }
    }
}
