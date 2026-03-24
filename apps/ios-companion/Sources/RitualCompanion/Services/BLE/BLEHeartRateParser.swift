import Foundation

enum BLEHeartRateParser {
    static func parse(_ data: Data, receivedAt: Date = Date()) -> BLEHeartRateMeasurement? {
        guard data.count >= 2 else { return nil }

        let bytes = [UInt8](data)
        let flags = bytes[0]
        let isUInt16 = (flags & 0x01) != 0
        let sensorContactSupported = (flags & 0x04) != 0
        let sensorContactDetected = (flags & 0x02) != 0
        let hasEnergyExpended = (flags & 0x08) != 0
        let hasRRInterval = (flags & 0x10) != 0

        var cursor = 1
        let bpm: Int
        if isUInt16 {
            guard bytes.count >= 3 else { return nil }
            bpm = Int(UInt16(bytes[cursor]) | (UInt16(bytes[cursor + 1]) << 8))
            cursor += 2
        } else {
            bpm = Int(bytes[cursor])
            cursor += 1
        }

        if hasEnergyExpended {
            guard bytes.count >= cursor + 2 else { return nil }
            cursor += 2
        }

        var rrIntervals: [Double] = []
        if hasRRInterval {
            while cursor + 1 < bytes.count {
                let rrValue = UInt16(bytes[cursor]) | (UInt16(bytes[cursor + 1]) << 8)
                rrIntervals.append(Double(rrValue) / 1024.0 * 1000.0)
                cursor += 2
            }
        }

        return BLEHeartRateMeasurement(
            bpm: bpm,
            rrIntervalsMs: rrIntervals,
            contactDetected: sensorContactSupported ? sensorContactDetected : nil,
            receivedAt: receivedAt
        )
    }
}

