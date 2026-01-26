import Foundation
import HealthKit

/// Manages persistent storage of HKQueryAnchor for incremental sync
/// Stores anchors per metric type so each can be synced independently
final class AnchorStorage {
    
    // MARK: - Singleton
    
    static let shared = AnchorStorage()
    
    // MARK: - Constants
    
    private let userDefaultsPrefix = "HealthKitAnchor."
    private let anchorDataKey = "anchorData"
    private let lastSyncTimeKey = "lastSyncTime"
    
    // MARK: - Initialization
    
    private init() {}
    
    // MARK: - Anchor Management
    
    /// Get the stored anchor for a metric type
    func getAnchor(for metricType: String) -> HKQueryAnchor? {
        let key = userDefaultsPrefix + metricType + "." + anchorDataKey
        guard let data = UserDefaults.standard.data(forKey: key) else {
            return nil
        }
        
        do {
            let anchor = try NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: data)
            return anchor
        } catch {
            print("⚠️ Failed to unarchive anchor for \(metricType): \(error)")
            return nil
        }
    }
    
    /// Save an anchor for a metric type
    func saveAnchor(_ anchor: HKQueryAnchor, for metricType: String) {
        let key = userDefaultsPrefix + metricType + "." + anchorDataKey
        
        do {
            let data = try NSKeyedArchiver.archivedData(withRootObject: anchor, requiringSecureCoding: true)
            UserDefaults.standard.set(data, forKey: key)
            
            // Also update last sync time
            let timeKey = userDefaultsPrefix + metricType + "." + lastSyncTimeKey
            UserDefaults.standard.set(Date(), forKey: timeKey)
            
            print("✅ Saved anchor for \(metricType)")
        } catch {
            print("⚠️ Failed to archive anchor for \(metricType): \(error)")
        }
    }
    
    /// Get the last sync time for a metric type
    func getLastSyncTime(for metricType: String) -> Date? {
        let key = userDefaultsPrefix + metricType + "." + lastSyncTimeKey
        return UserDefaults.standard.object(forKey: key) as? Date
    }
    
    /// Clear anchor for a metric type (useful for full resync)
    func clearAnchor(for metricType: String) {
        let anchorKey = userDefaultsPrefix + metricType + "." + anchorDataKey
        let timeKey = userDefaultsPrefix + metricType + "." + lastSyncTimeKey
        
        UserDefaults.standard.removeObject(forKey: anchorKey)
        UserDefaults.standard.removeObject(forKey: timeKey)
        
        print("🗑️ Cleared anchor for \(metricType)")
    }
    
    /// Clear all anchors (full reset)
    func clearAllAnchors() {
        let defaults = UserDefaults.standard
        let allKeys = defaults.dictionaryRepresentation().keys
        
        for key in allKeys {
            if key.hasPrefix(userDefaultsPrefix) {
                defaults.removeObject(forKey: key)
            }
        }
        
        print("🗑️ Cleared all HealthKit anchors")
    }
    
    /// Get all metric types that have stored anchors
    func getAllStoredMetricTypes() -> [String] {
        let defaults = UserDefaults.standard
        let allKeys = defaults.dictionaryRepresentation().keys
        
        var metricTypes: Set<String> = []
        
        for key in allKeys {
            if key.hasPrefix(userDefaultsPrefix) && key.hasSuffix("." + anchorDataKey) {
                // Extract metric type from key
                let withoutPrefix = String(key.dropFirst(userDefaultsPrefix.count))
                let metricType = String(withoutPrefix.dropLast(("." + anchorDataKey).count))
                metricTypes.insert(metricType)
            }
        }
        
        return Array(metricTypes)
    }
    
    // MARK: - Debug
    
    var debugInfo: String {
        var info = "Anchor Storage Status:\n"
        let metricTypes = getAllStoredMetricTypes()
        
        if metricTypes.isEmpty {
            info += "- No anchors stored\n"
        } else {
            for type in metricTypes.sorted() {
                let hasAnchor = getAnchor(for: type) != nil
                let lastSync = getLastSyncTime(for: type)
                let lastSyncStr = lastSync?.description ?? "Never"
                info += "- \(type): anchor=\(hasAnchor), lastSync=\(lastSyncStr)\n"
            }
        }
        
        return info
    }
}
