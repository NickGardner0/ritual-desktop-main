import CoreBluetooth
import SwiftUI

enum BLEPermissionState: String, CaseIterable {
    case unavailable
    case poweredOff
    case unauthorized
    case ready
    case scanning
    case connecting
    case connected
    case receiving
    case disconnected
    case reconnecting

    static func from(
        managerState: CBManagerState,
        authorization: CBManagerAuthorization = CBCentralManager.authorization
    ) -> BLEPermissionState {
        switch authorization {
        case .denied, .restricted:
            return .unauthorized
        case .notDetermined, .allowedAlways:
            break
        @unknown default:
            break
        }

        switch managerState {
        case .unsupported:
            return .unavailable
        case .poweredOff:
            return .poweredOff
        case .unauthorized:
            return .unauthorized
        case .poweredOn:
            return .ready
        case .resetting:
            return .reconnecting
        case .unknown:
            return .unavailable
        @unknown default:
            return .unavailable
        }
    }

    var statusText: String {
        switch self {
        case .unavailable: return "Bluetooth unavailable"
        case .poweredOff: return "Bluetooth off"
        case .unauthorized: return "Bluetooth not authorized"
        case .ready: return "Ready"
        case .scanning: return "Scanning"
        case .connecting: return "Connecting"
        case .connected: return "Connected"
        case .receiving: return "Receiving heart rate"
        case .disconnected: return "Disconnected"
        case .reconnecting: return "Reconnecting"
        }
    }

    var tint: Color {
        switch self {
        case .receiving, .connected:
            return .green
        case .scanning, .connecting, .reconnecting:
            return .blue
        case .ready:
            return .gray
        case .poweredOff, .unauthorized, .unavailable, .disconnected:
            return .orange
        }
    }
}
