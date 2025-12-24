import Foundation
import HealthKit

/// Manages HealthKit data access and queries
final class HealthKitManager {
    
    // MARK: - Properties
    
    private let healthStore = HKHealthStore()
    
    /// Types we want to read from HealthKit - comprehensive Apple Watch data
    private let readTypes: Set<HKSampleType> = {
        var types = Set<HKSampleType>()
        
        // Activity Metrics
        if let stepType = HKQuantityType.quantityType(forIdentifier: .stepCount) {
            types.insert(stepType)
        }
        if let energyType = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned) {
            types.insert(energyType)
        }
        if let basalEnergy = HKQuantityType.quantityType(forIdentifier: .basalEnergyBurned) {
            types.insert(basalEnergy)
        }
        if let distance = HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning) {
            types.insert(distance)
        }
        if let flights = HKQuantityType.quantityType(forIdentifier: .flightsClimbed) {
            types.insert(flights)
        }
        if let exerciseTime = HKQuantityType.quantityType(forIdentifier: .appleExerciseTime) {
            types.insert(exerciseTime)
        }
        if let standTime = HKQuantityType.quantityType(forIdentifier: .appleStandTime) {
            types.insert(standTime)
        }
        
        // Heart Metrics
        if let hrType = HKQuantityType.quantityType(forIdentifier: .heartRate) {
            types.insert(hrType)
        }
        if let hrvType = HKQuantityType.quantityType(forIdentifier: .heartRateVariabilitySDNN) {
            types.insert(hrvType)
        }
        if let restingHR = HKQuantityType.quantityType(forIdentifier: .restingHeartRate) {
            types.insert(restingHR)
        }
        if let walkingHR = HKQuantityType.quantityType(forIdentifier: .walkingHeartRateAverage) {
            types.insert(walkingHR)
        }
        
        // Respiratory & Blood Oxygen
        if let respRate = HKQuantityType.quantityType(forIdentifier: .respiratoryRate) {
            types.insert(respRate)
        }
        if let oxygenSat = HKQuantityType.quantityType(forIdentifier: .oxygenSaturation) {
            types.insert(oxygenSat)
        }
        
        // Sleep Analysis (Category type)
        if let sleepType = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis) {
            types.insert(sleepType)
        }
        
        // Mindfulness
        if let mindfulType = HKCategoryType.categoryType(forIdentifier: .mindfulSession) {
            types.insert(mindfulType)
        }
        
        // Workouts
        types.insert(HKObjectType.workoutType())
        
        return types
    }()
    
    // MARK: - Authorization
    
    /// Check if HealthKit is available on this device
    var isHealthDataAvailable: Bool {
        HKHealthStore.isHealthDataAvailable()
    }
    
    /// Check current authorization status
    /// Note: HealthKit doesn't expose read authorization status directly,
    /// so we check using statusForAuthorizationRequest or by attempting a query
    func checkAuthorizationStatus() async -> HealthAccessStatus {
        guard isHealthDataAvailable else {
            return .denied
        }
        
        // Use the modern API to check if we need to request authorization
        // This tells us if the user has been asked before
        do {
            let status = try await healthStore.statusForAuthorizationRequest(toShare: [], read: readTypes)
            
            switch status {
            case .unnecessary:
                // Authorization has already been requested - now verify by attempting a query
                let hasAccess = await verifyReadAccess()
                return hasAccess ? .authorized : .denied
            case .shouldRequest:
                return .notDetermined
            @unknown default:
                return .notDetermined
            }
        } catch {
            // Fallback: try to verify by querying
            let hasAccess = await verifyReadAccess()
            return hasAccess ? .authorized : .notDetermined
        }
    }
    
    /// Verify we actually have read access by attempting a simple query
    private func verifyReadAccess() async -> Bool {
        guard let stepType = HKQuantityType.quantityType(forIdentifier: .stepCount) else {
            return false
        }
        
        // Try to execute a simple query - if it succeeds without error, we have access
        do {
            let now = Date()
            let startOfDay = Calendar.current.startOfDay(for: now)
            let predicate = HKQuery.predicateForSamples(withStart: startOfDay, end: now, options: .strictStartDate)
            
            _ = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Double, Error>) in
                let query = HKStatisticsQuery(
                    quantityType: stepType,
                    quantitySamplePredicate: predicate,
                    options: .cumulativeSum
                ) { _, result, error in
                    if let error = error {
                        // Check if it's an authorization error
                        let nsError = error as NSError
                        if nsError.domain == "com.apple.healthkit" && nsError.code == 5 {
                            // Authorization denied
                            continuation.resume(throwing: error)
                        } else {
                            // Other error - might still have access
                            continuation.resume(returning: 0)
                        }
                        return
                    }
                    // Query succeeded - we have access
                    let sum = result?.sumQuantity()?.doubleValue(for: .count()) ?? 0
                    continuation.resume(returning: sum)
                }
                healthStore.execute(query)
            }
            return true
        } catch {
            return false
        }
    }
    
    /// Request authorization to read health data
    func requestAuthorization() async throws -> Bool {
        guard isHealthDataAvailable else {
            throw HealthKitError.notAvailable
        }
        
        // Request authorization
        try await healthStore.requestAuthorization(toShare: [], read: readTypes)
        
        // Verify we got authorization by checking status
        let status = await checkAuthorizationStatus()
        return status == .authorized
    }
    
    // MARK: - Data Fetching
    
    /// Fetch today's metrics - comprehensive Apple Watch data
    func fetchTodayMetrics() async throws -> [NormalizedMetric] {
        var metrics: [NormalizedMetric] = []
        
        let calendar = Calendar.current
        let now = Date()
        let startOfDay = calendar.startOfDay(for: now)
        
        // Activity Metrics
        if let steps = try await fetchQuantityMetric(
            identifier: .stepCount,
            metricType: .steps,
            unit: .count,
            hkUnit: .count(),
            from: startOfDay, to: now
        ) {
            metrics.append(steps)
        }
        
        if let activeEnergy = try await fetchQuantityMetric(
            identifier: .activeEnergyBurned,
            metricType: .activeEnergy,
            unit: .kcal,
            hkUnit: .kilocalorie(),
            from: startOfDay, to: now
        ) {
            metrics.append(activeEnergy)
        }
        
        if let basalEnergy = try await fetchQuantityMetric(
            identifier: .basalEnergyBurned,
            metricType: .basalEnergy,
            unit: .kcal,
            hkUnit: .kilocalorie(),
            from: startOfDay, to: now
        ) {
            metrics.append(basalEnergy)
        }
        
        if let distance = try await fetchQuantityMetric(
            identifier: .distanceWalkingRunning,
            metricType: .distance,
            unit: .meters,
            hkUnit: .meter(),
            from: startOfDay, to: now
        ) {
            metrics.append(distance)
        }
        
        if let flights = try await fetchQuantityMetric(
            identifier: .flightsClimbed,
            metricType: .flightsClimbed,
            unit: .count,
            hkUnit: .count(),
            from: startOfDay, to: now
        ) {
            metrics.append(flights)
        }
        
        if let exerciseTime = try await fetchQuantityMetric(
            identifier: .appleExerciseTime,
            metricType: .exerciseTime,
            unit: .minutes,
            hkUnit: .minute(),
            from: startOfDay, to: now
        ) {
            metrics.append(exerciseTime)
        }
        
        if let standTime = try await fetchQuantityMetric(
            identifier: .appleStandTime,
            metricType: .standTime,
            unit: .minutes,
            hkUnit: .minute(),
            from: startOfDay, to: now
        ) {
            metrics.append(standTime)
        }
        
        // Heart Metrics (averages for the day)
        if let hr = try await fetchAverageMetric(
            identifier: .heartRate,
            metricType: .hr,
            unit: .bpm,
            hkUnit: .count().unitDivided(by: .minute()),
            from: startOfDay, to: now
        ) {
            metrics.append(hr)
        }
        
        if let hrv = try await fetchAverageMetric(
            identifier: .heartRateVariabilitySDNN,
            metricType: .hrv,
            unit: .ms,
            hkUnit: .secondUnit(with: .milli),
            from: startOfDay, to: now
        ) {
            metrics.append(hrv)
        }
        
        if let restingHR = try await fetchAverageMetric(
            identifier: .restingHeartRate,
            metricType: .restingHr,
            unit: .bpm,
            hkUnit: .count().unitDivided(by: .minute()),
            from: startOfDay, to: now
        ) {
            metrics.append(restingHR)
        }
        
        if let walkingHR = try await fetchAverageMetric(
            identifier: .walkingHeartRateAverage,
            metricType: .walkingHr,
            unit: .bpm,
            hkUnit: .count().unitDivided(by: .minute()),
            from: startOfDay, to: now
        ) {
            metrics.append(walkingHR)
        }
        
        // Respiratory & Blood Oxygen
        if let respRate = try await fetchAverageMetric(
            identifier: .respiratoryRate,
            metricType: .respiratoryRate,
            unit: .breathsPerMinute,
            hkUnit: .count().unitDivided(by: .minute()),
            from: startOfDay, to: now
        ) {
            metrics.append(respRate)
        }
        
        if let oxygenSat = try await fetchAverageMetric(
            identifier: .oxygenSaturation,
            metricType: .oxygenSaturation,
            unit: .percent,
            hkUnit: .percent(),
            from: startOfDay, to: now
        ) {
            metrics.append(oxygenSat)
        }
        
        // Sleep (fetch last night's sleep)
        let sleepMetrics = try await fetchSleepMetrics()
        metrics.append(contentsOf: sleepMetrics)
        
        // Mindful minutes
        if let mindful = try await fetchMindfulMinutes(from: startOfDay, to: now) {
            metrics.append(mindful)
        }
        
        print("📊 Fetched \(metrics.count) metrics from HealthKit")
        return metrics
    }
    
    /// Fetch only specific metric types that the user has selected to track
    /// - Parameter metricTypes: Array of metric type strings from the backend (e.g., ["steps", "hr", "sleep_session"])
    /// - Parameter daysBack: Number of days to fetch (default 7 for historical backfill)
    func fetchMetrics(forTypes metricTypes: [String], daysBack: Int = 7) async throws -> [NormalizedMetric] {
        var metrics: [NormalizedMetric] = []
        
        let calendar = Calendar.current
        let now = Date()
        
        // Fetch data for each day in the range
        for dayOffset in 0..<daysBack {
            guard let targetDate = calendar.date(byAdding: .day, value: -dayOffset, to: now) else { continue }
            let startOfDay = calendar.startOfDay(for: targetDate)
            let endOfDay = dayOffset == 0 ? now : calendar.date(byAdding: .day, value: 1, to: startOfDay)!
            
            let dayMetrics = try await fetchMetricsForDay(
                metricTypes: metricTypes,
                startOfDay: startOfDay,
                endOfDay: endOfDay
            )
            metrics.append(contentsOf: dayMetrics)
        }
        
        print("📊 Fetched \(metrics.count) metrics for \(daysBack) days, types: \(metricTypes)")
        return metrics
    }
    
    /// Fetch metrics for a specific day
    private func fetchMetricsForDay(
        metricTypes: [String],
        startOfDay: Date,
        endOfDay: Date
    ) async throws -> [NormalizedMetric] {
        var metrics: [NormalizedMetric] = []
        
        // Map backend metric type strings to HealthKit fetches
        for type in metricTypes {
            switch type {
            case "steps":
                if let metric = try await fetchQuantityMetric(
                    identifier: .stepCount,
                    metricType: .steps,
                    unit: .count,
                    hkUnit: .count(),
                    from: startOfDay, to: endOfDay
                ) {
                    metrics.append(metric)
                }
                
            case "active_energy":
                if let metric = try await fetchQuantityMetric(
                    identifier: .activeEnergyBurned,
                    metricType: .activeEnergy,
                    unit: .kcal,
                    hkUnit: .kilocalorie(),
                    from: startOfDay, to: endOfDay
                ) {
                    metrics.append(metric)
                }
                
            case "basal_energy":
                if let metric = try await fetchQuantityMetric(
                    identifier: .basalEnergyBurned,
                    metricType: .basalEnergy,
                    unit: .kcal,
                    hkUnit: .kilocalorie(),
                    from: startOfDay, to: endOfDay
                ) {
                    metrics.append(metric)
                }
                
            case "distance":
                if let metric = try await fetchQuantityMetric(
                    identifier: .distanceWalkingRunning,
                    metricType: .distance,
                    unit: .meters,
                    hkUnit: .meter(),
                    from: startOfDay, to: endOfDay
                ) {
                    metrics.append(metric)
                }
                
            case "flights_climbed":
                if let metric = try await fetchQuantityMetric(
                    identifier: .flightsClimbed,
                    metricType: .flightsClimbed,
                    unit: .count,
                    hkUnit: .count(),
                    from: startOfDay, to: endOfDay
                ) {
                    metrics.append(metric)
                }
                
            case "exercise_time":
                if let metric = try await fetchQuantityMetric(
                    identifier: .appleExerciseTime,
                    metricType: .exerciseTime,
                    unit: .minutes,
                    hkUnit: .minute(),
                    from: startOfDay, to: endOfDay
                ) {
                    metrics.append(metric)
                }
                
            case "stand_time":
                if let metric = try await fetchQuantityMetric(
                    identifier: .appleStandTime,
                    metricType: .standTime,
                    unit: .minutes,
                    hkUnit: .minute(),
                    from: startOfDay, to: endOfDay
                ) {
                    metrics.append(metric)
                }
                
            case "hr":
                if let metric = try await fetchAverageMetric(
                    identifier: .heartRate,
                    metricType: .hr,
                    unit: .bpm,
                    hkUnit: .count().unitDivided(by: .minute()),
                    from: startOfDay, to: endOfDay
                ) {
                    metrics.append(metric)
                }
                
            case "hrv":
                if let metric = try await fetchAverageMetric(
                    identifier: .heartRateVariabilitySDNN,
                    metricType: .hrv,
                    unit: .ms,
                    hkUnit: .secondUnit(with: .milli),
                    from: startOfDay, to: endOfDay
                ) {
                    metrics.append(metric)
                }
                
            case "resting_hr":
                if let metric = try await fetchAverageMetric(
                    identifier: .restingHeartRate,
                    metricType: .restingHr,
                    unit: .bpm,
                    hkUnit: .count().unitDivided(by: .minute()),
                    from: startOfDay, to: endOfDay
                ) {
                    metrics.append(metric)
                }
                
            case "walking_hr":
                if let metric = try await fetchAverageMetric(
                    identifier: .walkingHeartRateAverage,
                    metricType: .walkingHr,
                    unit: .bpm,
                    hkUnit: .count().unitDivided(by: .minute()),
                    from: startOfDay, to: endOfDay
                ) {
                    metrics.append(metric)
                }
                
            case "respiratory_rate":
                if let metric = try await fetchAverageMetric(
                    identifier: .respiratoryRate,
                    metricType: .respiratoryRate,
                    unit: .breathsPerMinute,
                    hkUnit: .count().unitDivided(by: .minute()),
                    from: startOfDay, to: endOfDay
                ) {
                    metrics.append(metric)
                }
                
            case "oxygen_saturation":
                if let metric = try await fetchAverageMetric(
                    identifier: .oxygenSaturation,
                    metricType: .oxygenSaturation,
                    unit: .percent,
                    hkUnit: .percent(),
                    from: startOfDay, to: endOfDay
                ) {
                    metrics.append(metric)
                }
                
            case "sleep_session":
                // For sleep, fetch for this specific day range
                let sleepMetrics = try await fetchSleepMetricsForDay(from: startOfDay, to: endOfDay)
                metrics.append(contentsOf: sleepMetrics)
                
            case "mindful_minutes":
                if let metric = try await fetchMindfulMinutes(from: startOfDay, to: endOfDay) {
                    metrics.append(metric)
                }
                
            case "workout":
                print("⚠️ Workout syncing not yet implemented")
                
            default:
                print("⚠️ Unknown metric type: \(type)")
            }
        }
        
        return metrics
    }
    
    /// Fetch sleep metrics for a specific day (looks back 24 hours from endOfDay)
    private func fetchSleepMetricsForDay(from startOfDay: Date, to endOfDay: Date) async throws -> [NormalizedMetric] {
        guard let sleepType = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis) else {
            return []
        }
        
        // For sleep, look at the night before this day (sleep that ended on this day)
        let predicate = HKQuery.predicateForSamples(withStart: startOfDay, end: endOfDay, options: .strictStartDate)
        
        let samples = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<[HKCategorySample], Error>) in
            let query = HKSampleQuery(
                sampleType: sleepType,
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
            ) { _, results, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }
                continuation.resume(returning: (results as? [HKCategorySample]) ?? [])
            }
            healthStore.execute(query)
        }
        
        guard !samples.isEmpty else { return [] }
        
        var metrics: [NormalizedMetric] = []
        var totalAsleep: TimeInterval = 0
        var earliestStart = samples.first!.startDate
        var latestEnd = samples.first!.endDate
        
        for sample in samples {
            let duration = sample.endDate.timeIntervalSince(sample.startDate)
            
            if sample.startDate < earliestStart { earliestStart = sample.startDate }
            if sample.endDate > latestEnd { latestEnd = sample.endDate }
            
            switch sample.value {
            case HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue,
                 HKCategoryValueSleepAnalysis.asleep.rawValue,
                 HKCategoryValueSleepAnalysis.asleepREM.rawValue,
                 HKCategoryValueSleepAnalysis.asleepDeep.rawValue,
                 HKCategoryValueSleepAnalysis.asleepCore.rawValue:
                totalAsleep += duration
            default:
                break
            }
        }
        
        if totalAsleep > 0 {
            metrics.append(NormalizedMetric(
                source: .appleHealth,
                metricType: .sleepSession,
                startTime: startOfDay,  // Use the day's start for consistent date attribution
                endTime: endOfDay,
                value: totalAsleep / 3600,
                unit: .hours,
                recordedAt: Date(),
                rawPayload: ["query_type": AnyCodable("sleep_analysis"), "source": AnyCodable("healthkit")]
            ))
        }
        
        return metrics
    }
    
    // MARK: - Generic Quantity Fetch (Cumulative Sum)
    
    /// Metrics that should ONLY come from Apple Watch (not iPhone or other apps like WHOOP)
    private let appleWatchOnlyMetrics: Set<HKQuantityTypeIdentifier> = [
        .stepCount,
        .distanceWalkingRunning,
        .flightsClimbed,
        .activeEnergyBurned,
        .basalEnergyBurned,
        .appleExerciseTime,
        .appleStandTime
    ]
    
    private func fetchQuantityMetric(
        identifier: HKQuantityTypeIdentifier,
        metricType: MetricType,
        unit: MetricUnit,
        hkUnit: HKUnit,
        from startDate: Date,
        to endDate: Date
    ) async throws -> NormalizedMetric? {
        guard let quantityType = HKQuantityType.quantityType(forIdentifier: identifier) else {
            return nil
        }
        
        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: endDate, options: .strictStartDate)
        
        // Debug: Log the date range being queried
        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "yyyy-MM-dd HH:mm:ss Z"
        print("🔍 HealthKit Query: \(metricType.rawValue)")
        print("   Start: \(dateFormatter.string(from: startDate))")
        print("   End:   \(dateFormatter.string(from: endDate))")
        
        // For activity metrics, only use Apple Watch data (not iPhone or WHOOP)
        let useAppleWatchOnly = appleWatchOnlyMetrics.contains(identifier)
        
        let total: Double
        
        if useAppleWatchOnly {
            // Use separateBySource and manually pick Apple Watch data only
            total = try await fetchAppleWatchOnlySum(
                quantityType: quantityType,
                predicate: predicate,
                hkUnit: hkUnit,
                metricType: metricType
            )
        } else {
            // Use standard cumulative sum for other metrics
            total = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Double, Error>) in
                let query = HKStatisticsQuery(
                    quantityType: quantityType,
                    quantitySamplePredicate: predicate,
                    options: .cumulativeSum
                ) { _, result, error in
                    if let error = error {
                        print("   ❌ Error: \(error.localizedDescription)")
                        continuation.resume(throwing: error)
                        return
                    }
                    let sum = result?.sumQuantity()?.doubleValue(for: hkUnit) ?? 0
                    print("   ✅ Result: \(sum) \(unit.rawValue)")
                    continuation.resume(returning: sum)
                }
                healthStore.execute(query)
            }
        }
        
        guard total > 0 else { 
            print("   ⚠️ No data returned (total = 0)")
            return nil 
        }
        
        return NormalizedMetric(
            source: .appleHealth,
            metricType: metricType,
            startTime: startDate,
            endTime: endDate,
            value: total,
            unit: unit,
            recordedAt: Date(),
            rawPayload: [
                "query_type": AnyCodable("cumulative_sum"),
                "source": AnyCodable(useAppleWatchOnly ? "apple_watch_only" : "healthkit")
            ]
        )
    }
    
    /// Fetch sum from Apple Watch source only, ignoring iPhone and third-party apps like WHOOP
    private func fetchAppleWatchOnlySum(
        quantityType: HKQuantityType,
        predicate: NSPredicate,
        hkUnit: HKUnit,
        metricType: MetricType
    ) async throws -> Double {
        
        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Double, Error>) in
            let query = HKStatisticsQuery(
                quantityType: quantityType,
                quantitySamplePredicate: predicate,
                options: [.cumulativeSum, .separateBySource]
            ) { _, result, error in
                if let error = error {
                    print("   ❌ Error: \(error.localizedDescription)")
                    continuation.resume(throwing: error)
                    return
                }
                
                guard let result = result, let sources = result.sources else {
                    print("   ⚠️ No sources found")
                    continuation.resume(returning: 0)
                    return
                }
                
                // Find Apple Watch source(s) - look for "Apple Watch" in name or com.apple.health bundle
                var appleWatchTotal: Double = 0
                var foundAppleWatch = false
                
                print("   📱 Sources available:")
                for source in sources {
                    let isAppleWatch = source.name.lowercased().contains("apple watch") ||
                                       source.bundleIdentifier.hasPrefix("com.apple.health")
                    let isIPhone = source.name.lowercased().contains("iphone") ||
                                   source.bundleIdentifier == "com.apple.Health"
                    let isThirdParty = !source.bundleIdentifier.hasPrefix("com.apple")
                    
                    if let sourceSum = result.sumQuantity(for: source) {
                        let value = sourceSum.doubleValue(for: hkUnit)
                        
                        // Only include Apple Watch data
                        if isAppleWatch && !isIPhone {
                            print("      ✅ \(source.name): \(Int(value)) (INCLUDED - Apple Watch)")
                            appleWatchTotal += value
                            foundAppleWatch = true
                        } else if isIPhone {
                            print("      ❌ \(source.name): \(Int(value)) (EXCLUDED - iPhone)")
                        } else if isThirdParty {
                            print("      ❌ \(source.name): \(Int(value)) (EXCLUDED - Third-party: \(source.bundleIdentifier))")
                        } else {
                            print("      ❌ \(source.name): \(Int(value)) (EXCLUDED - Unknown)")
                        }
                    }
                }
                
                if !foundAppleWatch {
                    print("   ⚠️ No Apple Watch source found, falling back to overall sum")
                    // Fallback to total if no Apple Watch found (e.g., user doesn't have Apple Watch)
                    let fallbackSum = result.sumQuantity()?.doubleValue(for: hkUnit) ?? 0
                    continuation.resume(returning: fallbackSum)
                    return
                }
                
                print("   ✅ Apple Watch Only Total: \(Int(appleWatchTotal)) \(metricType.rawValue)")
                continuation.resume(returning: appleWatchTotal)
            }
            healthStore.execute(query)
        }
    }
    
    // MARK: - Generic Average Fetch
    
    private func fetchAverageMetric(
        identifier: HKQuantityTypeIdentifier,
        metricType: MetricType,
        unit: MetricUnit,
        hkUnit: HKUnit,
        from startDate: Date,
        to endDate: Date
    ) async throws -> NormalizedMetric? {
        guard let quantityType = HKQuantityType.quantityType(forIdentifier: identifier) else {
            return nil
        }
        
        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: endDate, options: .strictStartDate)
        
        let average = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Double, Error>) in
            let query = HKStatisticsQuery(
                quantityType: quantityType,
                quantitySamplePredicate: predicate,
                options: .discreteAverage
            ) { _, result, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }
                let avg = result?.averageQuantity()?.doubleValue(for: hkUnit) ?? 0
                continuation.resume(returning: avg)
            }
            healthStore.execute(query)
        }
        
        guard average > 0 else { return nil }
        
        return NormalizedMetric(
            source: .appleHealth,
            metricType: metricType,
            startTime: startDate,
            endTime: endDate,
            value: average,
            unit: unit,
            recordedAt: Date(),
            rawPayload: ["query_type": AnyCodable("discrete_average"), "source": AnyCodable("healthkit")]
        )
    }
    
    // MARK: - Sleep Analysis
    
    private func fetchSleepMetrics() async throws -> [NormalizedMetric] {
        guard let sleepType = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis) else {
            return []
        }
        
        // Fetch last night's sleep (last 24 hours)
        let calendar = Calendar.current
        let now = Date()
        let yesterday = calendar.date(byAdding: .hour, value: -24, to: now)!
        
        let predicate = HKQuery.predicateForSamples(withStart: yesterday, end: now, options: .strictStartDate)
        
        let samples = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<[HKCategorySample], Error>) in
            let query = HKSampleQuery(
                sampleType: sleepType,
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
            ) { _, results, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }
                continuation.resume(returning: (results as? [HKCategorySample]) ?? [])
            }
            healthStore.execute(query)
        }
        
        guard !samples.isEmpty else { return [] }
        
        var metrics: [NormalizedMetric] = []
        var totalAsleep: TimeInterval = 0
        var totalAwake: TimeInterval = 0
        var totalREM: TimeInterval = 0
        var totalDeep: TimeInterval = 0
        var totalCore: TimeInterval = 0
        var earliestStart = samples.first!.startDate
        var latestEnd = samples.first!.endDate
        
        for sample in samples {
            let duration = sample.endDate.timeIntervalSince(sample.startDate)
            
            if sample.startDate < earliestStart { earliestStart = sample.startDate }
            if sample.endDate > latestEnd { latestEnd = sample.endDate }
            
            switch sample.value {
            case HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue,
                 HKCategoryValueSleepAnalysis.asleep.rawValue:
                totalAsleep += duration
            case HKCategoryValueSleepAnalysis.awake.rawValue:
                totalAwake += duration
            case HKCategoryValueSleepAnalysis.asleepREM.rawValue:
                totalREM += duration
                totalAsleep += duration
            case HKCategoryValueSleepAnalysis.asleepDeep.rawValue:
                totalDeep += duration
                totalAsleep += duration
            case HKCategoryValueSleepAnalysis.asleepCore.rawValue:
                totalCore += duration
                totalAsleep += duration
            default:
                break
            }
        }
        
        // Total sleep session
        if totalAsleep > 0 {
            metrics.append(NormalizedMetric(
                source: .appleHealth,
                metricType: .sleepSession,
                startTime: earliestStart,
                endTime: latestEnd,
                value: totalAsleep / 3600, // Convert to hours
                unit: .hours,
                recordedAt: Date(),
                rawPayload: ["query_type": AnyCodable("sleep_analysis"), "source": AnyCodable("healthkit")]
            ))
        }
        
        // Sleep stages breakdown
        if totalREM > 0 {
            metrics.append(NormalizedMetric(
                source: .appleHealth,
                metricType: .sleepREM,
                startTime: earliestStart,
                endTime: latestEnd,
                value: totalREM / 60, // Convert to minutes
                unit: .minutes,
                recordedAt: Date()
            ))
        }
        
        if totalDeep > 0 {
            metrics.append(NormalizedMetric(
                source: .appleHealth,
                metricType: .sleepDeep,
                startTime: earliestStart,
                endTime: latestEnd,
                value: totalDeep / 60,
                unit: .minutes,
                recordedAt: Date()
            ))
        }
        
        if totalCore > 0 {
            metrics.append(NormalizedMetric(
                source: .appleHealth,
                metricType: .sleepCore,
                startTime: earliestStart,
                endTime: latestEnd,
                value: totalCore / 60,
                unit: .minutes,
                recordedAt: Date()
            ))
        }
        
        return metrics
    }
    
    // MARK: - Mindful Minutes
    
    private func fetchMindfulMinutes(from startDate: Date, to endDate: Date) async throws -> NormalizedMetric? {
        guard let mindfulType = HKCategoryType.categoryType(forIdentifier: .mindfulSession) else {
            return nil
        }
        
        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: endDate, options: .strictStartDate)
        
        let samples = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<[HKCategorySample], Error>) in
            let query = HKSampleQuery(
                sampleType: mindfulType,
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: nil
            ) { _, results, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }
                continuation.resume(returning: (results as? [HKCategorySample]) ?? [])
            }
            healthStore.execute(query)
        }
        
        guard !samples.isEmpty else { return nil }
        
        let totalMinutes = samples.reduce(0.0) { total, sample in
            total + sample.endDate.timeIntervalSince(sample.startDate) / 60
        }
        
        guard totalMinutes > 0 else { return nil }
        
        return NormalizedMetric(
            source: .appleHealth,
            metricType: .mindfulMinutes,
            startTime: startDate,
            endTime: endDate,
            value: totalMinutes,
            unit: .minutes,
            recordedAt: Date(),
            rawPayload: ["query_type": AnyCodable("category_sum"), "source": AnyCodable("healthkit")]
        )
    }
    
    // MARK: - Debug Functions
    
    /// Debug function to show detailed breakdown of step samples for a specific date
    /// Call this to investigate discrepancies between Apple Health app and HealthKit queries
    func debugStepsForDate(_ date: Date) async {
        guard let stepType = HKQuantityType.quantityType(forIdentifier: .stepCount) else {
            print("❌ Could not create step count type")
            return
        }
        
        let calendar = Calendar.current
        let startOfDay = calendar.startOfDay(for: date)
        let endOfDay = calendar.date(byAdding: .day, value: 1, to: startOfDay)!
        
        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "yyyy-MM-dd"
        let dayStr = dateFormatter.string(from: date)
        
        print("═══════════════════════════════════════════════════════════")
        print("🔬 DEBUG: Steps breakdown for \(dayStr)")
        print("═══════════════════════════════════════════════════════════")
        
        dateFormatter.dateFormat = "yyyy-MM-dd HH:mm:ss Z"
        print("📅 Query range:")
        print("   Start: \(dateFormatter.string(from: startOfDay))")
        print("   End:   \(dateFormatter.string(from: endOfDay))")
        
        let predicate = HKQuery.predicateForSamples(withStart: startOfDay, end: endOfDay, options: .strictStartDate)
        
        // 1. Get cumulative sum (what we normally use)
        do {
            let cumulativeSum = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Double, Error>) in
                let query = HKStatisticsQuery(
                    quantityType: stepType,
                    quantitySamplePredicate: predicate,
                    options: .cumulativeSum
                ) { _, result, error in
                    if let error = error {
                        continuation.resume(throwing: error)
                        return
                    }
                    let sum = result?.sumQuantity()?.doubleValue(for: .count()) ?? 0
                    continuation.resume(returning: sum)
                }
                healthStore.execute(query)
            }
            print("\n📊 Cumulative Sum (what we send): \(Int(cumulativeSum)) steps")
        } catch {
            print("❌ Cumulative sum error: \(error)")
        }
        
        // 2. Get individual samples to see sources
        do {
            let samples = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<[HKQuantitySample], Error>) in
                let query = HKSampleQuery(
                    sampleType: stepType,
                    predicate: predicate,
                    limit: HKObjectQueryNoLimit,
                    sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
                ) { _, results, error in
                    if let error = error {
                        continuation.resume(throwing: error)
                        return
                    }
                    continuation.resume(returning: (results as? [HKQuantitySample]) ?? [])
                }
                healthStore.execute(query)
            }
            
            print("\n📋 Individual Samples (\(samples.count) total):")
            
            // Group by source
            var bySource: [String: (count: Int, total: Double)] = [:]
            var rawTotal: Double = 0
            
            dateFormatter.dateFormat = "HH:mm:ss"
            for sample in samples {
                let sourceName = sample.sourceRevision.source.name
                let value = sample.quantity.doubleValue(for: .count())
                rawTotal += value
                
                if bySource[sourceName] != nil {
                    bySource[sourceName]!.count += 1
                    bySource[sourceName]!.total += value
                } else {
                    bySource[sourceName] = (count: 1, total: value)
                }
            }
            
            print("\n📱 By Source (raw totals, may include overlaps):")
            for (source, data) in bySource.sorted(by: { $0.value.total > $1.value.total }) {
                print("   \(source): \(Int(data.total)) steps (\(data.count) samples)")
            }
            
            print("\n⚠️  Raw Total (before dedup): \(Int(rawTotal)) steps")
            print("   Note: Apple Health auto-deduplicates overlapping data")
            print("   HKStatisticsQuery with .cumulativeSum should match Apple Health")
            
        } catch {
            print("❌ Sample query error: \(error)")
        }
        
        // 3. Try with separateBySource option to see individual source totals
        do {
            let sourceStats = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<HKStatistics?, Error>) in
                let query = HKStatisticsQuery(
                    quantityType: stepType,
                    quantitySamplePredicate: predicate,
                    options: [.cumulativeSum, .separateBySource]
                ) { _, result, error in
                    if let error = error {
                        continuation.resume(throwing: error)
                        return
                    }
                    continuation.resume(returning: result)
                }
                healthStore.execute(query)
            }
            
            if let stats = sourceStats {
                print("\n📊 Statistics with separateBySource:")
                print("   Overall sum: \(Int(stats.sumQuantity()?.doubleValue(for: .count()) ?? 0)) steps")
                
                if let sources = stats.sources {
                    print("   Sources breakdown:")
                    for source in sources {
                        if let sourceSum = stats.sumQuantity(for: source) {
                            print("      \(source.name): \(Int(sourceSum.doubleValue(for: .count()))) steps")
                        }
                    }
                }
            }
        } catch {
            print("❌ separateBySource error: \(error)")
        }
        
        print("═══════════════════════════════════════════════════════════\n")
    }
    
    /// Debug function to compare last 7 days of steps
    func debugStepsLast7Days() async {
        print("\n🔬 DEBUG: Comparing steps for last 7 days")
        print("═══════════════════════════════════════════════════════════\n")
        
        let calendar = Calendar.current
        let now = Date()
        
        for dayOffset in 0..<7 {
            guard let targetDate = calendar.date(byAdding: .day, value: -dayOffset, to: now) else { continue }
            await debugStepsForDate(targetDate)
        }
    }
    
}

// MARK: - Errors

enum HealthKitError: LocalizedError {
    case notAvailable
    case authorizationDenied
    case queryFailed(String)
    
    var errorDescription: String? {
        switch self {
        case .notAvailable:
            return "HealthKit is not available on this device"
        case .authorizationDenied:
            return "Health data access was denied"
        case .queryFailed(let message):
            return "Failed to query health data: \(message)"
        }
    }
}
