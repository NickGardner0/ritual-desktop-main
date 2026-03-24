import CoreBluetooth
import Foundation

final class BLEManager: NSObject {
    private let heartRateServiceUUID = CBUUID(string: "180D")
    private let heartRateMeasurementCharacteristicUUID = CBUUID(string: "2A37")

    private(set) var centralManager: CBCentralManager!
    private(set) var isScanning = false
    private var discoveredPeripherals: [UUID: CBPeripheral] = [:]
    private var activePeripheral: CBPeripheral?

    var onDevicesUpdated: (([BLEDevice]) -> Void)?
    var onStateUpdated: ((BLEPermissionState) -> Void)?
    var onMeasurement: ((BLEHeartRateMeasurement, BLEDevice) -> Void)?

    private var currentDevices: [BLEDevice] = []

    override init() {
        super.init()
        centralManager = CBCentralManager(
            delegate: self,
            queue: nil,
            options: [
                CBCentralManagerOptionRestoreIdentifierKey: BLERestorationCoordinator.centralRestorationIdentifier
            ]
        )
    }

    func startScan() {
        guard centralManager.state == .poweredOn else {
            onStateUpdated?(
                BLEPermissionState.from(
                    managerState: centralManager.state,
                    authorization: CBCentralManager.authorization
                )
            )
            return
        }
        isScanning = true
        currentDevices = []
        discoveredPeripherals.removeAll()
        onStateUpdated?(.scanning)
        centralManager.scanForPeripherals(withServices: [heartRateServiceUUID], options: [
            CBCentralManagerScanOptionAllowDuplicatesKey: false
        ])
    }

    func stopScan() {
        isScanning = false
        centralManager.stopScan()
        if activePeripheral == nil {
            onStateUpdated?(.ready)
        }
    }

    func connect(to device: BLEDevice) {
        guard centralManager.state == .poweredOn else {
            onStateUpdated?(
                BLEPermissionState.from(
                    managerState: centralManager.state,
                    authorization: CBCentralManager.authorization
                )
            )
            return
        }
        guard let peripheral = discoveredPeripherals[device.id] else { return }
        connect(to: peripheral, state: .connecting)
    }

    @discardableResult
    func reconnect(to identifier: UUID) -> Bool {
        guard centralManager.state == .poweredOn else {
            onStateUpdated?(
                BLEPermissionState.from(
                    managerState: centralManager.state,
                    authorization: CBCentralManager.authorization
                )
            )
            return false
        }

        if let peripheral = discoveredPeripherals[identifier] {
            connect(to: peripheral, state: .reconnecting)
            return true
        }

        let retrieved = centralManager.retrievePeripherals(withIdentifiers: [identifier])
        guard let peripheral = retrieved.first else { return false }
        discoveredPeripherals[identifier] = peripheral
        connect(to: peripheral, state: .reconnecting)
        return true
    }

    func activeDeviceName() -> String? {
        activePeripheral?.name
    }

    private func connect(to peripheral: CBPeripheral, state: BLEPermissionState) {
        activePeripheral = peripheral
        peripheral.delegate = self
        isScanning = false
        onStateUpdated?(state)
        centralManager.connect(peripheral, options: nil)
    }

    func disconnectCurrentDevice() {
        guard centralManager.state == .poweredOn else { return }
        guard let activePeripheral else { return }
        centralManager.cancelPeripheralConnection(activePeripheral)
    }

    private func updateDevices() {
        onDevicesUpdated?(currentDevices.sorted { lhs, rhs in
            if lhs.isLikelyWhoop != rhs.isLikelyWhoop {
                return lhs.isLikelyWhoop && !rhs.isLikelyWhoop
            }
            return lhs.rssi > rhs.rssi
        })
    }
}

extension BLEManager: CBCentralManagerDelegate {
    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if central.state != .poweredOn {
            isScanning = false
        }
        onStateUpdated?(
            BLEPermissionState.from(
                managerState: central.state,
                authorization: CBCentralManager.authorization
            )
        )
    }

    func centralManager(
        _ central: CBCentralManager,
        willRestoreState dict: [String : Any]
    ) {
        let peripherals = dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral] ?? []
        peripherals.forEach {
            discoveredPeripherals[$0.identifier] = $0
            $0.delegate = self
        }
        if let restored = peripherals.first {
            connect(to: restored, state: .reconnecting)
        }
    }

    func centralManager(
        _ central: CBCentralManager,
        didDiscover peripheral: CBPeripheral,
        advertisementData: [String : Any],
        rssi RSSI: NSNumber
    ) {
        discoveredPeripherals[peripheral.identifier] = peripheral
        let name = peripheral.name ?? (advertisementData[CBAdvertisementDataLocalNameKey] as? String) ?? "Heart Rate Device"
        let device = BLEDevice(
            id: peripheral.identifier,
            name: name,
            rssi: RSSI.intValue,
            isLikelyWhoop: name.localizedCaseInsensitiveContains("whoop")
        )
        currentDevices.removeAll { $0.id == device.id }
        currentDevices.append(device)
        updateDevices()
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        isScanning = false
        onStateUpdated?(.connected)
        central.stopScan()
        peripheral.discoverServices([heartRateServiceUUID])
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        isScanning = false
        if activePeripheral?.identifier == peripheral.identifier {
            activePeripheral = nil
        }
        onStateUpdated?(.disconnected)
    }
}

extension BLEManager: CBPeripheralDelegate {
    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard error == nil else { return }
        for service in peripheral.services ?? [] where service.uuid == heartRateServiceUUID {
            peripheral.discoverCharacteristics([heartRateMeasurementCharacteristicUUID], for: service)
        }
    }

    func peripheral(
        _ peripheral: CBPeripheral,
        didDiscoverCharacteristicsFor service: CBService,
        error: Error?
    ) {
        guard error == nil else { return }
        for characteristic in service.characteristics ?? [] where characteristic.uuid == heartRateMeasurementCharacteristicUUID {
            peripheral.setNotifyValue(true, for: characteristic)
        }
    }

    func peripheral(
        _ peripheral: CBPeripheral,
        didUpdateValueFor characteristic: CBCharacteristic,
        error: Error?
    ) {
        guard error == nil,
              characteristic.uuid == heartRateMeasurementCharacteristicUUID,
              let data = characteristic.value,
              let measurement = BLEHeartRateParser.parse(data) else {
            return
        }

        let name = peripheral.name ?? "Heart Rate Device"
        let device = BLEDevice(
            id: peripheral.identifier,
            name: name,
            rssi: 0,
            isLikelyWhoop: name.localizedCaseInsensitiveContains("whoop")
        )
        onStateUpdated?(.receiving)
        onMeasurement?(measurement, device)
    }
}
