import Foundation

/// Persists user-configured HealthKit → habit mappings and the per-mapping
/// dedupe ledger that prevents the resolver from re-posting the same value
/// to the backend multiple times per day.
///
/// Two separate UserDefaults keys are used so the dedupe ledger can be wiped
/// independently of the mapping config (e.g. during a sign-out or dev reset).
///
/// Thread safety: this store is intended to be accessed from the main actor
/// via AppState. All methods are synchronous.
@MainActor
final class HabitMappingStore {

    static let shared = HabitMappingStore()

    private let mappingsKey = "HabitMapping.mappings.v1"
    private let ledgerKey = "HabitMapping.dedupeLedger.v1"
    private let defaults: UserDefaults

    /// Injectable for tests.
    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    // MARK: - Mappings CRUD

    func loadMappings() -> [HabitMapping] {
        guard let data = defaults.data(forKey: mappingsKey) else { return [] }
        return (try? JSONDecoder().decode([HabitMapping].self, from: data)) ?? []
    }

    @discardableResult
    func saveMappings(_ mappings: [HabitMapping]) -> [HabitMapping] {
        if let data = try? JSONEncoder().encode(mappings) {
            defaults.set(data, forKey: mappingsKey)
        }
        return mappings
    }

    /// Insert or replace a mapping by id. If the mapping's (habitId, metricType)
    /// pair collides with another existing mapping, the older one is removed —
    /// a habit/metric pair should have exactly one rule.
    @discardableResult
    func upsert(_ mapping: HabitMapping) -> [HabitMapping] {
        var current = loadMappings()
        current.removeAll { existing in
            if existing.id == mapping.id { return true }
            if existing.habitId == mapping.habitId && existing.metricType == mapping.metricType && existing.id != mapping.id {
                return true
            }
            return false
        }
        current.append(mapping)
        current.sort { $0.habitName.localizedCaseInsensitiveCompare($1.habitName) == .orderedAscending }
        return saveMappings(current)
    }

    @discardableResult
    func delete(id: String) -> [HabitMapping] {
        var current = loadMappings()
        current.removeAll { $0.id == id }
        // Drop any dedupe entries for this mapping so it doesn't leak storage.
        var ledger = loadLedger()
        ledger.removeValue(forKey: id)
        saveLedger(ledger)
        return saveMappings(current)
    }

    // MARK: - Dedupe ledger

    /// Per-mapping record of the last value we posted for a given day.
    struct LedgerEntry: Codable, Equatable {
        let day: String       // "yyyy-MM-dd"
        let amount: Double
        let status: String    // mirrors HabitLogStatus raw value
        let postedAt: Date
    }

    func loadLedger() -> [String: LedgerEntry] {
        guard let data = defaults.data(forKey: ledgerKey) else { return [:] }
        return (try? JSONDecoder().decode([String: LedgerEntry].self, from: data)) ?? [:]
    }

    func saveLedger(_ ledger: [String: LedgerEntry]) {
        if let data = try? JSONEncoder().encode(ledger) {
            defaults.set(data, forKey: ledgerKey)
        }
    }

    /// Decide whether the resolver should post a new log for (mapping, day).
    ///
    /// Policy: post if there is no prior entry for this day, OR the status has
    /// changed (e.g. missed→completed), OR the amount has drifted by more than
    /// `deltaFraction` (default 1%). This avoids spamming the backend every sync
    /// cycle with tiny step-count updates while still keeping the dashboard fresh.
    func shouldPost(
        mappingId: String,
        day: String,
        newAmount: Double,
        newStatus: String,
        deltaFraction: Double = 0.01
    ) -> Bool {
        let ledger = loadLedger()
        guard let last = ledger[mappingId], last.day == day else {
            return true
        }
        if last.status != newStatus { return true }
        let denom = max(abs(last.amount), 1.0)
        let drift = abs(newAmount - last.amount) / denom
        return drift > deltaFraction
    }

    func recordPost(mappingId: String, day: String, amount: Double, status: String) {
        var ledger = loadLedger()
        ledger[mappingId] = LedgerEntry(day: day, amount: amount, status: status, postedAt: Date())
        saveLedger(ledger)
    }

    /// Wipe everything. Used on sign-out.
    func clearAll() {
        defaults.removeObject(forKey: mappingsKey)
        defaults.removeObject(forKey: ledgerKey)
    }
}
