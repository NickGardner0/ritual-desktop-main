import Foundation
import HealthKit

/// V2 HealthKit Manager with incremental sync via HKAnchoredObjectQuery
/// Supports source preferences, workout sync, and proper sleep attribution
final class HealthKitManagerV2: @unchecked Sendable {
    
    // MARK: - Properties
    
    private let healthStore = HKHealthStore()
    private let anchorStorage = AnchorStorage.shared
    
    private struct StatisticsValue {
        let value: Double
        let unit: MetricUnit
        let sourceBundleId: String
        let sourceDeviceName: String
    }
    
    /// Types we want to read from HealthKit
    private let readTypes = Set(HealthMetricDescriptor.catalog.values.compactMap(\.sampleType))
    
    // MARK: - Types
    
    struct IncrementalSyncResult {
        let added: [NormalizedMetric]
        let deleted: [String]  // HealthKit UUIDs
        let modified: [NormalizedMetric]
        let newAnchor: HKQueryAnchor?
        let metricType: String
    }

    struct IncrementalDeletionResult {
        let deleted: [String]
        let newAnchor: HKQueryAnchor?
        let metricType: String
    }

    private func granularSyncWindowDays(for metricType: String, requestedDaysBack: Int) -> Int {
        let cap = HealthMetricDescriptor.descriptor(for: metricType)?.granularClass.historyCapDays ?? 30
        return min(requestedDaysBack, cap)
    }

    private static func shouldProjectToHabitLogs(
        metricType: String,
        aggregationKind: MetricAggregationKind
    ) -> Bool {
        switch aggregationKind {
        case .daily:
            return true
        case .interval:
            return metricType.hasPrefix("sleep") || metricType == MetricType.workout.rawValue || metricType == MetricType.mindfulMinutes.rawValue
        case .point, .bucket15m, .bucket1h:
            return false
        }
    }
    
    // MARK: - Authorization
    
    var isHealthDataAvailable: Bool {
        HKHealthStore.isHealthDataAvailable()
    }
    
    private func readTypes(forMetricTypes metricTypes: [String]) -> Set<HKSampleType> {
        let requestedTypes = Set(metricTypes.compactMap { Self.sampleType(for: $0) })
        return requestedTypes.isEmpty ? readTypes : requestedTypes
    }

    static func sampleType(for metricType: String) -> HKSampleType? {
        HealthMetricDescriptor.descriptor(for: metricType)?.sampleType
    }

    func checkAuthorizationStatus(forMetricTypes metricTypes: [String] = []) async -> HealthAccessStatus {
        guard isHealthDataAvailable else { return .denied }

        let requestedReadTypes = readTypes(forMetricTypes: metricTypes)

        do {
            let status = try await healthStore.statusForAuthorizationRequest(toShare: [], read: requestedReadTypes)
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

        // Query a 7-day window rather than just today. HealthKit deliberately
        // hides read-auth status, so we infer it from whether a query succeeds.
        // A "today only" window produced false negatives whenever the device
        // had no step samples yet for the current day (early morning, phone
        // sitting still, or simply a slow HealthKit daemon response).
        do {
            let now = Date()
            let weekAgo = Calendar.current.date(byAdding: .day, value: -7, to: now) ?? now
            let predicate = HKQuery.predicateForSamples(withStart: weekAgo, end: now, options: .strictStartDate)

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
    
    func requestAuthorization(forMetricTypes metricTypes: [String] = []) async throws -> Bool {
        guard isHealthDataAvailable else { throw HealthKitError.notAvailable }
        let requestedReadTypes = readTypes(forMetricTypes: metricTypes)
        try await healthStore.requestAuthorization(toShare: [], read: requestedReadTypes)
        return await checkAuthorizationStatus(forMetricTypes: metricTypes) == .authorized
    }
    
    // MARK: - Incremental Sync (HKAnchoredObjectQuery)
    
    /// Fetch incremental changes for a metric type since last anchor
    func fetchIncrementalChanges(for metricType: String) async throws -> IncrementalSyncResult {
        guard let sampleType = Self.sampleType(for: metricType) else {
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

    /// Fetch HealthKit deletions since the last confirmed anchor without pushing
    /// raw added samples into the daily aggregate fast path. If no anchor exists
    /// yet, bootstrap one at "now" so future observer deliveries can report
    /// true deletes durably.
    func fetchIncrementalDeletions(for metricType: String) async throws -> IncrementalDeletionResult {
        guard let sampleType = Self.sampleType(for: metricType) else {
            throw HealthKitError.queryFailed("Unknown metric type: \(metricType)")
        }

        guard let existingAnchor = anchorStorage.getAnchor(for: metricType) else {
            return IncrementalDeletionResult(
                deleted: [],
                newAnchor: try await captureAnchorBaseline(for: metricType),
                metricType: metricType
            )
        }

        return try await withCheckedThrowingContinuation { continuation in
            let query = HKAnchoredObjectQuery(
                type: sampleType,
                predicate: nil,
                anchor: existingAnchor,
                limit: 5000
            ) { _, _, deletedSamples, newAnchor, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }

                continuation.resume(returning: IncrementalDeletionResult(
                    deleted: (deletedSamples ?? []).map { $0.uuid.uuidString },
                    newAnchor: newAnchor,
                    metricType: metricType
                ))
            }

            healthStore.execute(query)
        }
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
        guard let sampleType = Self.sampleType(for: metricType) else {
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
        let preference = sourcePreference(for: metricType)
        
        // Filter samples by source preference
        let filteredSamples = filterSamplesBySource(samples, preference: preference)
        
        for sample in filteredSamples {
            if let metric = convertSampleToMetric(sample, metricType: metricType) {
                metrics.append(metric)
            }
        }
        
        return metrics
    }
    
    private static func sourcePreference(for metricType: String) -> SourcePreference {
        HealthMetricDescriptor.descriptor(for: metricType)?.sourcePreference ?? .bestAvailable
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
        return isAppleWatchSource(sample.sourceRevision.source, deviceName: sample.device?.name)
    }

    private static func isAppleWatchSource(_ source: HKSource, deviceName: String? = nil) -> Bool {
        let name = source.name.lowercased()
        let resolvedDeviceName = (deviceName ?? "").lowercased()
        let bundleId = source.bundleIdentifier
        
        // Apple Watch sources
        if name.contains("apple watch") { return true }
        if resolvedDeviceName.contains("apple watch") { return true }
        if resolvedDeviceName.contains("watch") && bundleId.hasPrefix("com.apple") { return true }
        if bundleId.hasPrefix("com.apple.health") && !name.lowercased().contains("iphone") { return true }
        
        return false
    }

    private static func sourceKey(for sample: HKSample) -> String {
        let source = sample.sourceRevision.source
        return "\(source.bundleIdentifier)|\(sample.device?.name ?? source.name)"
    }

    private static func selectedSources(
        from statistics: HKStatistics,
        preference: SourcePreference
    ) -> [HKSource]? {
        guard preference != .bestAvailable else { return nil }
        let sources = statistics.sources ?? []

        switch preference {
        case .bestAvailable:
            return nil
        case .appleWatchOnly:
            return sources.filter { isAppleWatchSource($0) }
        case .appleWatchPreferred:
            let watchSources = sources.filter { isAppleWatchSource($0) }
            return watchSources.isEmpty ? sources : watchSources
        }
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
            recordedAt: Date(),
            aggregationKind: .point,
            rollupWindowMinutes: nil,
            sampleCount: nil,
            shouldProjectToHabitLogs: shouldProjectToHabitLogs(metricType: metricType, aggregationKind: .point)
        )
    }
    
    private static func extractValueAndUnit(from sample: HKQuantitySample, metricType: String) -> (Double, MetricUnit) {
        HealthMetricDescriptor.descriptor(for: metricType)?.normalizedValue(from: sample.quantity)
            ?? (sample.quantity.doubleValue(for: .count()), .count)
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
            aggregationKind: .interval,
            rollupWindowMinutes: nil,
            sampleCount: nil,
            shouldProjectToHabitLogs: shouldProjectToHabitLogs(metricType: metricType, aggregationKind: .interval),
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
            aggregationKind: .interval,
            rollupWindowMinutes: nil,
            sampleCount: nil,
            shouldProjectToHabitLogs: true,
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
    
    // MARK: - Daily Aggregated Sync (RECOMMENDED - sends daily totals instead of raw samples)

    /// Get the aggregation type for a metric
    private func aggregationType(for metricType: String) -> AggregationType {
        HealthMetricDescriptor.descriptor(for: metricType)?.aggregation ?? .discreteAverage
    }
    
    /// Fetch DAILY AGGREGATED metrics for a type over an exact date range.
    /// Range is inclusive by day (startOfDay(startDate) through endDate).
    func fetchDailyAggregatedMetrics(for metricType: String, startDate: Date, endDate: Date) async throws -> [NormalizedMetric] {
        let calendar = Calendar.current
        let normalizedStart = calendar.startOfDay(for: min(startDate, endDate))
        let normalizedEnd = max(startDate, endDate)
        let anchorDate = calendar.startOfDay(for: normalizedEnd)
        let queryEnd = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: normalizedEnd)) ?? normalizedEnd

        guard let quantityType = Self.sampleType(for: metricType) as? HKQuantityType else {
            // For non-quantity types (sleep, workouts), use raw sample approach with aggregation.
            return try await fetchAndAggregateCategoryMetrics(for: metricType, startDate: normalizedStart, endDate: queryEnd)
        }
        
        // Daily interval
        var interval = DateComponents()
        interval.day = 1
        
        // Get the right statistics options
        let aggregation = aggregationType(for: metricType)
        var options: HKStatisticsOptions
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

        let preference = Self.sourcePreference(for: metricType)
        if preference != .bestAvailable {
            options.insert(.separateBySource)
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
                        aggregation: aggregation,
                        sourcePreference: preference
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

    func fetchMetrics(
        for metricType: String,
        syncMode: MetricSyncMode,
        daysBack: Int
    ) async throws -> [NormalizedMetric] {
        switch syncMode {
        case .off:
            return []
        case .dailyOnly:
            return try await fetchDailyAggregatedMetrics(for: metricType, daysBack: daysBack)
        case .granular:
            let calendar = Calendar.current
            let now = Date()
            let startOfToday = calendar.startOfDay(for: now)
            let effectiveDaysBack = granularSyncWindowDays(for: metricType, requestedDaysBack: daysBack)
            let startDate = calendar.date(byAdding: .day, value: -effectiveDaysBack, to: startOfToday) ?? startOfToday
            return try await fetchGranularMetrics(for: metricType, startDate: startDate, endDate: now)
        }
    }

    func fetchMetrics(
        for metricType: String,
        syncMode: MetricSyncMode,
        startDate: Date,
        endDate: Date
    ) async throws -> [NormalizedMetric] {
        switch syncMode {
        case .off:
            return []
        case .dailyOnly:
            return try await fetchDailyAggregatedMetrics(for: metricType, startDate: startDate, endDate: endDate)
        case .granular:
            return try await fetchGranularMetrics(for: metricType, startDate: startDate, endDate: endDate)
        }
    }

    func performBackfill(
        for metricSyncModes: [String: MetricSyncMode],
        daysBack: Int = 730,
        progressHandler: ((Int, Int) -> Void)? = nil
    ) async throws -> [NormalizedMetric] {
        let enabledMetricTypes = metricSyncModes
            .filter { $0.value != .off }
            .map(\.key)
            .sorted()

        var allMetrics: [NormalizedMetric] = []

        #if DEBUG
        print("📊 Starting policy-aware backfill for \(enabledMetricTypes.count) metrics over \(daysBack) days...")
        #endif

        for (index, metricType) in enabledMetricTypes.enumerated() {
            progressHandler?(index, enabledMetricTypes.count)
            anchorStorage.clearAnchor(for: metricType)

            let syncMode = metricSyncModes[metricType] ?? .dailyOnly

            do {
                let metrics = try await fetchMetrics(for: metricType, syncMode: syncMode, daysBack: daysBack)
                allMetrics.append(contentsOf: metrics)
                #if DEBUG
                print("   ✓ \(metricType) [\(syncMode.rawValue)]: \(metrics.count) metrics")
                #endif
            } catch {
                #if DEBUG
                print("   ⚠️ Failed to backfill \(metricType) [\(syncMode.rawValue)]: \(error.localizedDescription)")
                #endif
            }
        }

        progressHandler?(enabledMetricTypes.count, enabledMetricTypes.count)
        return allMetrics
    }

    private func fetchGranularMetrics(
        for metricType: String,
        startDate: Date,
        endDate: Date
    ) async throws -> [NormalizedMetric] {
        if HealthMetricDescriptor.descriptor(for: metricType)?.granularClass == .bucketed {
            return try await fetchBucketedMetrics(
                for: metricType,
                startDate: startDate,
                endDate: endDate,
                windowMinutes: 15
            )
        }

        return try await fetchHistoricalMetrics(for: metricType, from: startDate, to: endDate)
    }

    private func fetchBucketedMetrics(
        for metricType: String,
        startDate: Date,
        endDate: Date,
        windowMinutes: Int
    ) async throws -> [NormalizedMetric] {
        guard let quantityType = Self.sampleType(for: metricType) as? HKQuantityType else {
            throw HealthKitError.queryFailed("Bucketed fetch requires quantity type for \(metricType)")
        }

        let calendar = Calendar.current
        let normalizedStart = min(startDate, endDate)
        let normalizedEnd = max(startDate, endDate)
        let anchorDate = calendar.startOfDay(for: normalizedStart)
        let aggregation = aggregationType(for: metricType)
        let predicate = HKQuery.predicateForSamples(withStart: normalizedStart, end: normalizedEnd, options: .strictStartDate)

        var interval = DateComponents()
        interval.minute = windowMinutes

        var options: HKStatisticsOptions
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

        let preference = Self.sourcePreference(for: metricType)
        if preference != .bestAvailable {
            options.insert(.separateBySource)
        }

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

                let isoFormatter = ISO8601DateFormatter()
                let aggregationKind: MetricAggregationKind = windowMinutes == 60 ? .bucket1h : .bucket15m

                var metrics: [NormalizedMetric] = []

                statsCollection.enumerateStatistics(from: normalizedStart, to: normalizedEnd) { statistics, _ in
                    guard let statValue = Self.extractStatisticsValue(
                        statistics,
                        metricType: metricType,
                        aggregation: aggregation,
                        sourcePreference: preference
                    ) else { return }
                    let value = statValue.value
                    let unit = statValue.unit
                    guard value > 0, let metricTypeEnum = MetricType(rawValue: metricType) else { return }

                    let bucketStart = statistics.startDate
                    let bucketEnd = statistics.endDate
                    let externalId = "bucket_\(windowMinutes)m_\(metricType)_\(isoFormatter.string(from: bucketStart))"

                    metrics.append(
                        NormalizedMetric(
                            source: .appleHealth,
                            metricType: metricTypeEnum,
                            startTime: bucketStart,
                            endTime: bucketEnd,
                            value: value,
                            unit: unit,
                            externalId: externalId,
                            sourceBundleId: statValue.sourceBundleId,
                            sourceDeviceName: "\(statValue.sourceDeviceName) (\(windowMinutes)m Buckets)",
                            attributedDate: bucketStart,
                            recordedAt: Date(),
                            aggregationKind: aggregationKind,
                            rollupWindowMinutes: windowMinutes,
                            sampleCount: nil,
                            shouldProjectToHabitLogs: false,
                            rawPayload: [
                                "aggregation": AnyCodable(aggregationKind.rawValue),
                                "window_minutes": AnyCodable(windowMinutes),
                            ]
                        )
                    )
                }

                continuation.resume(returning: metrics)
            }

            healthStore.execute(query)
        }
    }
    
    /// Convert HKStatistics (daily aggregate) to NormalizedMetric
    private static func convertStatisticsToMetric(
        _ statistics: HKStatistics,
        metricType: String,
        aggregation: AggregationType,
        sourcePreference: SourcePreference = .bestAvailable
    ) -> NormalizedMetric? {
        guard let statValue = extractStatisticsValue(
            statistics,
            metricType: metricType,
            aggregation: aggregation,
            sourcePreference: sourcePreference
        ) else { return nil }

        let value = statValue.value
        let unit = statValue.unit
        
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
            sourceBundleId: statValue.sourceBundleId,
            sourceDeviceName: "\(statValue.sourceDeviceName) (Daily)",
            attributedDate: dayStart,  // Day start for daily aggregates
            recordedAt: Date(),
            aggregationKind: .daily,
            rollupWindowMinutes: 1440,
            sampleCount: nil,
            shouldProjectToHabitLogs: true,
            rawPayload: ["aggregation": AnyCodable(String(describing: aggregation))]
        )
    }

    private static func extractStatisticsValue(
        _ statistics: HKStatistics,
        metricType: String,
        aggregation: AggregationType,
        sourcePreference: SourcePreference
    ) -> StatisticsValue? {
        guard let selectedSources = selectedSources(from: statistics, preference: sourcePreference) else {
            guard let quantity = quantity(from: statistics, aggregation: aggregation) else { return nil }
            let (value, unit) = extractValueFromQuantity(quantity, metricType: metricType)
            return StatisticsValue(
                value: value,
                unit: unit,
                sourceBundleId: "com.apple.health.aggregated",
                sourceDeviceName: "Apple Health"
            )
        }

        guard !selectedSources.isEmpty else { return nil }

        let sourceValues: [(Double, MetricUnit, HKSource)] = selectedSources.compactMap { source in
            guard let quantity = quantity(from: statistics, aggregation: aggregation, source: source) else {
                return nil
            }
            let (value, unit) = extractValueFromQuantity(quantity, metricType: metricType)
            return (value, unit, source)
        }

        guard !sourceValues.isEmpty else { return nil }

        let values = sourceValues.map { $0.0 }
        let unit = sourceValues[0].1
        let value: Double
        switch aggregation {
        case .cumulativeSum, .duration:
            value = values.reduce(0, +)
        case .discreteAverage:
            value = values.reduce(0, +) / Double(values.count)
        case .discreteMin:
            value = values.min() ?? 0
        case .discreteMax:
            value = values.max() ?? 0
        }

        let sourceBundleId: String
        let sourceDeviceName: String
        if sourceValues.count == 1 {
            let source = sourceValues[0].2
            sourceBundleId = source.bundleIdentifier
            sourceDeviceName = source.name
        } else {
            sourceBundleId = "com.apple.health.selected_sources"
            let watchOnly = sourceValues.allSatisfy { isAppleWatchSource($0.2) }
            sourceDeviceName = watchOnly ? "Apple Watch Sources" : "Apple Health Selected Sources"
        }

        return StatisticsValue(
            value: value,
            unit: unit,
            sourceBundleId: sourceBundleId,
            sourceDeviceName: sourceDeviceName
        )
    }

    private static func quantity(
        from statistics: HKStatistics,
        aggregation: AggregationType,
        source: HKSource? = nil
    ) -> HKQuantity? {
        switch aggregation {
        case .cumulativeSum, .duration:
            if let source { return statistics.sumQuantity(for: source) }
            return statistics.sumQuantity()
        case .discreteAverage:
            if let source { return statistics.averageQuantity(for: source) }
            return statistics.averageQuantity()
        case .discreteMin:
            if let source { return statistics.minimumQuantity(for: source) }
            return statistics.minimumQuantity()
        case .discreteMax:
            if let source { return statistics.maximumQuantity(for: source) }
            return statistics.maximumQuantity()
        }
    }
    
    /// Extract value and unit from an HKQuantity
    private static func extractValueFromQuantity(_ quantity: HKQuantity, metricType: String) -> (Double, MetricUnit) {
        HealthMetricDescriptor.descriptor(for: metricType)?.normalizedValue(from: quantity)
            ?? (quantity.doubleValue(for: .count()), .count)
    }

    /// Fetch and aggregate category metrics (sleep, mindfulness) by day.
    private func fetchAndAggregateCategoryMetrics(for metricType: String, startDate: Date, endDate: Date) async throws -> [NormalizedMetric] {
        guard let sampleType = Self.sampleType(for: metricType) else {
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
        
        // Aggregate by day after applying source policy. Sleep is special:
        // overlapping sources are common, so choose one best source per day.
        return aggregateSamplesByDay(samples, metricType: metricType)
    }
    
    /// Aggregate raw samples into daily totals
    private func aggregateSamplesByDay(_ samples: [HKSample], metricType: String) -> [NormalizedMetric] {
        let calendar = Calendar.current
        let selectedSamples = Self.samplesForDailyCategoryAggregation(samples, metricType: metricType)
        
        // Group samples by attributed date
        var dailyTotals: [Date: Double] = [:]
        
        for sample in selectedSamples {
            guard Self.shouldIncludeCategorySample(sample, for: metricType) else { continue }

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
                aggregationKind: .daily,
                rollupWindowMinutes: 1440,
                sampleCount: nil,
                shouldProjectToHabitLogs: true,
                rawPayload: ["aggregation": AnyCodable("daily_sum")]
            )
        }.sorted { $0.startTime < $1.startTime }
    }

    /// Restrict sleep metrics to the expected HealthKit sleep stage(s).
    /// Without this filtering, every sleep_* metric can incorrectly include all sleep samples.
    private static func samplesForDailyCategoryAggregation(_ samples: [HKSample], metricType: String) -> [HKSample] {
        let preference = sourcePreference(for: metricType)
        let eligible = samples.filter { shouldIncludeCategorySample($0, for: metricType) }

        guard metricType.hasPrefix("sleep") else {
            return filterSamplesBySource(eligible, preference: preference)
        }

        let calendar = Calendar.current
        var grouped: [Date: [String: [HKSample]]] = [:]

        for sample in eligible {
            let day = calendar.startOfDay(for: calculateAttributedDate(for: sample, metricType: metricType))
            grouped[day, default: [:]][sourceKey(for: sample), default: []].append(sample)
        }

        var selected: [HKSample] = []
        for (_, sourceGroups) in grouped {
            guard let bestGroup = sourceGroups.values.max(by: { lhs, rhs in
                totalDuration(lhs) < totalDuration(rhs)
            }) else { continue }
            selected.append(contentsOf: bestGroup)
        }

        return selected
    }

    private static func totalDuration(_ samples: [HKSample]) -> TimeInterval {
        samples.reduce(0) { $0 + $1.endDate.timeIntervalSince($1.startDate) }
    }

    private static func shouldIncludeCategorySample(_ sample: HKSample, for metricType: String) -> Bool {
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
        let syncModes = Dictionary(uniqueKeysWithValues: metricTypes.map { ($0, MetricSyncMode.dailyOnly) })
        return try await performBackfill(
            for: syncModes,
            daysBack: daysBack,
            progressHandler: progressHandler
        )
    }
    
    // MARK: - Legacy Full Backfill (RAW SAMPLES - NOT RECOMMENDED)
    
    /// Perform a full backfill for specified days (resets anchors)
    /// WARNING: This fetches RAW samples which can be 50,000+ records. Use performDailyAggregatedBackfill instead.
    @available(*, deprecated, message: "Use performDailyAggregatedBackfill instead to avoid excessive raw samples")
    func performFullBackfill(for metricTypes: [String], daysBack: Int = 30, progressHandler: ((Int, Int) -> Void)? = nil) async throws -> [NormalizedMetric] {
        let syncModes = Dictionary(uniqueKeysWithValues: metricTypes.map { ($0, MetricSyncMode.granular) })
        return try await performBackfill(
            for: syncModes,
            daysBack: daysBack,
            progressHandler: progressHandler
        )
    }
    
    private func fetchHistoricalMetrics(for metricType: String, from startDate: Date, to endDate: Date) async throws -> [NormalizedMetric] {
        guard let sampleType = Self.sampleType(for: metricType) else {
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
