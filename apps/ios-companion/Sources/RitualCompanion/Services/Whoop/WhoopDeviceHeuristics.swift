import Foundation

enum WhoopDeviceHeuristics {
    static func prioritize(_ devices: [BLEDevice], lastConnectedID: UUID? = nil) -> [BLEDevice] {
        return devices.sorted { lhs, rhs in
            if lhs.id == lastConnectedID { return true }
            if rhs.id == lastConnectedID { return false }
            if lhs.isLikelyWhoop != rhs.isLikelyWhoop {
                return lhs.isLikelyWhoop && !rhs.isLikelyWhoop
            }
            return lhs.rssi > rhs.rssi
        }
    }
}

