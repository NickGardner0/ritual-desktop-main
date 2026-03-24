import Foundation

struct BLEDevice: Identifiable, Hashable {
    let id: UUID
    let name: String
    let rssi: Int
    let isLikelyWhoop: Bool
}

