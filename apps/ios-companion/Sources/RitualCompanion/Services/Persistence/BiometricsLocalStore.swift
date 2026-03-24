import Foundation
import SQLite3

actor BiometricsLocalStore {
    private let baseURL: URL
    private let databaseURL: URL
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    private let isoFormatter: ISO8601DateFormatter
    private var db: OpaquePointer?
    private var didBootstrap = false

    private let legacySamplesFileName = "heart-rate-samples.json"
    private let legacySessionsFileName = "heart-rate-sessions.json"

    init() {
        let supportURL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let folderURL = supportURL.appendingPathComponent("Biometrics", isDirectory: true)
        try? FileManager.default.createDirectory(at: folderURL, withIntermediateDirectories: true, attributes: nil)
        self.baseURL = folderURL
        self.databaseURL = folderURL.appendingPathComponent("biometrics.sqlite3")
        self.encoder = JSONEncoder()
        self.decoder = JSONDecoder()
        self.encoder.dateEncodingStrategy = .iso8601
        self.decoder.dateDecodingStrategy = .iso8601
        self.isoFormatter = ISO8601DateFormatter()
        self.isoFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

    }

    deinit {
        if let db {
            sqlite3_close(db)
        }
    }

    func insertHeartRateSample(_ sample: HeartRateSample) async {
        insertOrReplaceSample(sample)
    }

    func insertHeartRateSamples(_ newSamples: [HeartRateSample]) async {
        beginTransaction()
        for sample in newSamples {
            insertOrReplaceSample(sample)
        }
        commitTransaction()
    }

    func fetchUnsyncedHeartRateSamples(limit: Int) async -> [HeartRateSample] {
        let sql = """
        SELECT id, user_id, source_type, source_device_id, session_id, bpm_raw, bpm_display,
               quality_score, is_outlier, rr_intervals_json, contact_detected,
               received_at, created_at, sync_state
        FROM heart_rate_samples_local
        WHERE sync_state != ?
        ORDER BY received_at DESC
        LIMIT ?;
        """

        guard let statement = prepare(sql) else { return [] }
        defer { sqlite3_finalize(statement) }

        bindText(HeartRateSyncState.synced.rawValue, to: statement, at: 1)
        sqlite3_bind_int(statement, 2, Int32(limit))

        return readSamples(from: statement)
    }

    func markHeartRateSamplesSynced(ids: [UUID]) async {
        guard !ids.isEmpty else { return }
        let sql = "UPDATE heart_rate_samples_local SET sync_state = ?, updated_at = ? WHERE id = ?;"
        guard let statement = prepare(sql) else { return }
        defer { sqlite3_finalize(statement) }

        let now = isoString(Date())
        beginTransaction()
        for id in ids {
            sqlite3_reset(statement)
            sqlite3_clear_bindings(statement)
            bindText(HeartRateSyncState.synced.rawValue, to: statement, at: 1)
            bindText(now, to: statement, at: 2)
            bindText(id.uuidString, to: statement, at: 3)
            if sqlite3_step(statement) != SQLITE_DONE {
                logDatabaseError("markHeartRateSamplesSynced")
            }
        }
        commitTransaction()
    }

    func createSession(_ session: HeartRateSession) async {
        let sql = """
        INSERT OR REPLACE INTO heart_rate_sessions_local
        (id, user_id, source_type, source_device_id, started_at, ended_at, status, app_version, device_model, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM heart_rate_sessions_local WHERE id = ?), ?), ?);
        """

        guard let statement = prepare(sql) else { return }
        defer { sqlite3_finalize(statement) }

        let now = isoString(Date())
        bindText(session.id.uuidString, to: statement, at: 1)
        bindText(session.userId, to: statement, at: 2)
        bindText(session.sourceType.rawValue, to: statement, at: 3)
        bindText(session.sourceDeviceId, to: statement, at: 4)
        bindText(isoString(session.startedAt), to: statement, at: 5)
        bindOptionalText(session.endedAt.map(isoString), to: statement, at: 6)
        bindText(session.status, to: statement, at: 7)
        bindOptionalText(session.appVersion, to: statement, at: 8)
        bindOptionalText(session.deviceModel, to: statement, at: 9)
        bindText(session.id.uuidString, to: statement, at: 10)
        bindText(now, to: statement, at: 11)
        bindText(now, to: statement, at: 12)

        if sqlite3_step(statement) != SQLITE_DONE {
            logDatabaseError("createSession")
        }
    }

    func endSession(sessionId: UUID, endedAt: Date = Date(), status: String = "ended") async {
        let sql = """
        UPDATE heart_rate_sessions_local
        SET ended_at = ?, status = ?, updated_at = ?
        WHERE id = ?;
        """

        guard let statement = prepare(sql) else { return }
        defer { sqlite3_finalize(statement) }

        bindText(isoString(endedAt), to: statement, at: 1)
        bindText(status, to: statement, at: 2)
        bindText(isoString(Date()), to: statement, at: 3)
        bindText(sessionId.uuidString, to: statement, at: 4)

        if sqlite3_step(statement) != SQLITE_DONE {
            logDatabaseError("endSession")
        }
    }

    func latestSession() async -> HeartRateSession? {
        let sql = """
        SELECT id, user_id, source_type, source_device_id, started_at, ended_at, status, app_version, device_model
        FROM heart_rate_sessions_local
        ORDER BY started_at DESC
        LIMIT 1;
        """

        guard let statement = prepare(sql) else { return nil }
        defer { sqlite3_finalize(statement) }

        return readSession(from: statement)
    }

    func fetchRecentSamples(minutes: Int) async -> [HeartRateSample] {
        let cutoff = isoString(Date().addingTimeInterval(Double(-minutes * 60)))
        let sql = """
        SELECT id, user_id, source_type, source_device_id, session_id, bpm_raw, bpm_display,
               quality_score, is_outlier, rr_intervals_json, contact_detected,
               received_at, created_at, sync_state
        FROM heart_rate_samples_local
        WHERE received_at >= ?
        ORDER BY received_at ASC;
        """

        guard let statement = prepare(sql) else { return [] }
        defer { sqlite3_finalize(statement) }

        bindText(cutoff, to: statement, at: 1)
        return readSamples(from: statement)
    }

    func clearAllHeartRateData() async {
        execute("DELETE FROM heart_rate_samples_local;")
        execute("DELETE FROM heart_rate_sessions_local;")
    }

    private func insertOrReplaceSample(_ sample: HeartRateSample) {
        let sql = """
        INSERT OR REPLACE INTO heart_rate_samples_local
        (id, user_id, source_type, source_device_id, session_id, bpm_raw, bpm_display, quality_score,
         is_outlier, rr_intervals_json, contact_detected, received_at, created_at, updated_at, sync_state)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        """

        guard let statement = prepare(sql) else { return }
        defer { sqlite3_finalize(statement) }

        bindText(sample.id.uuidString, to: statement, at: 1)
        bindText(sample.userId, to: statement, at: 2)
        bindText(sample.sourceType.rawValue, to: statement, at: 3)
        bindText(sample.sourceDeviceId, to: statement, at: 4)
        bindText(sample.sessionId.uuidString, to: statement, at: 5)
        sqlite3_bind_int(statement, 6, Int32(sample.bpmRaw))
        sqlite3_bind_int(statement, 7, Int32(sample.bpmDisplay))
        bindOptionalDouble(sample.qualityScore, to: statement, at: 8)
        sqlite3_bind_int(statement, 9, sample.isOutlier ? 1 : 0)
        bindOptionalText(sample.rrIntervalsMs.flatMap(jsonString), to: statement, at: 10)
        bindOptionalInt(sample.contactDetected.map { $0 ? 1 : 0 }, to: statement, at: 11)
        bindText(isoString(sample.receivedAt), to: statement, at: 12)
        bindText(isoString(sample.createdAt), to: statement, at: 13)
        bindText(isoString(Date()), to: statement, at: 14)
        bindText(sample.syncState.rawValue, to: statement, at: 15)

        if sqlite3_step(statement) != SQLITE_DONE {
            logDatabaseError("insertOrReplaceSample")
        }
    }

    private func readSamples(from statement: OpaquePointer) -> [HeartRateSample] {
        var samples: [HeartRateSample] = []
        while sqlite3_step(statement) == SQLITE_ROW {
            guard let sample = makeSample(from: statement) else { continue }
            samples.append(sample)
        }
        return samples
    }

    private func readSession(from statement: OpaquePointer) -> HeartRateSession? {
        guard sqlite3_step(statement) == SQLITE_ROW else { return nil }

        guard let id = uuid(from: statement, at: 0),
              let userId = text(from: statement, at: 1),
              let sourceTypeRaw = text(from: statement, at: 2),
              let sourceType = HeartRateSourceType(rawValue: sourceTypeRaw),
              let sourceDeviceId = text(from: statement, at: 3),
              let startedAt = date(from: statement, at: 4),
              let status = text(from: statement, at: 6) else {
            return nil
        }

        return HeartRateSession(
            id: id,
            userId: userId,
            sourceType: sourceType,
            sourceDeviceId: sourceDeviceId,
            startedAt: startedAt,
            endedAt: date(from: statement, at: 5),
            status: status,
            appVersion: text(from: statement, at: 7),
            deviceModel: text(from: statement, at: 8)
        )
    }

    private func makeSample(from statement: OpaquePointer) -> HeartRateSample? {
        guard let id = uuid(from: statement, at: 0),
              let userId = text(from: statement, at: 1),
              let sourceTypeRaw = text(from: statement, at: 2),
              let sourceType = HeartRateSourceType(rawValue: sourceTypeRaw),
              let sourceDeviceId = text(from: statement, at: 3),
              let sessionId = uuid(from: statement, at: 4),
              let receivedAt = date(from: statement, at: 11),
              let createdAt = date(from: statement, at: 12),
              let syncStateRaw = text(from: statement, at: 13),
              let syncState = HeartRateSyncState(rawValue: syncStateRaw) else {
            return nil
        }

        return HeartRateSample(
            id: id,
            userId: userId,
            sourceType: sourceType,
            sourceDeviceId: sourceDeviceId,
            sessionId: sessionId,
            bpmRaw: Int(sqlite3_column_int(statement, 5)),
            bpmDisplay: Int(sqlite3_column_int(statement, 6)),
            qualityScore: double(from: statement, at: 7),
            isOutlier: sqlite3_column_int(statement, 8) == 1,
            rrIntervalsMs: jsonArray(from: statement, at: 9),
            contactDetected: optionalBool(from: statement, at: 10),
            receivedAt: receivedAt,
            createdAt: createdAt,
            syncState: syncState
        )
    }

    private func openDatabaseIfNeeded() {
        guard db == nil else { return }

        var openedDB: OpaquePointer?
        if sqlite3_open_v2(databaseURL.path, &openedDB, SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK {
            db = openedDB
            sqlite3_busy_timeout(openedDB, 5_000)
        } else {
            if let openedDB {
                db = openedDB
                logDatabaseError("sqlite3_open_v2")
                sqlite3_close(openedDB)
                db = nil
            }
        }
    }

    private func ensureBootstrapped() {
        guard !didBootstrap else { return }
        didBootstrap = true
        openDatabaseIfNeeded()
        createTablesIfNeeded()
        migrateLegacyJSONIfNeeded()
    }

    private func createTablesIfNeeded() {
        execute("""
        CREATE TABLE IF NOT EXISTS heart_rate_samples_local (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            source_type TEXT NOT NULL,
            source_device_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            bpm_raw INTEGER NOT NULL,
            bpm_display INTEGER NOT NULL,
            quality_score REAL,
            is_outlier INTEGER NOT NULL DEFAULT 0,
            rr_intervals_json TEXT,
            contact_detected INTEGER,
            received_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            sync_state TEXT NOT NULL
        );
        """)

        execute("""
        CREATE TABLE IF NOT EXISTS heart_rate_sessions_local (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            source_type TEXT NOT NULL,
            source_device_id TEXT NOT NULL,
            started_at TEXT NOT NULL,
            ended_at TEXT,
            status TEXT NOT NULL,
            app_version TEXT,
            device_model TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        """)

        execute("CREATE INDEX IF NOT EXISTS idx_hr_samples_sync_state_received ON heart_rate_samples_local (sync_state, received_at);")
        execute("CREATE INDEX IF NOT EXISTS idx_hr_samples_session_received ON heart_rate_samples_local (session_id, received_at);")
        execute("CREATE INDEX IF NOT EXISTS idx_hr_sessions_started_at ON heart_rate_sessions_local (started_at DESC);")
    }

    private func migrateLegacyJSONIfNeeded() {
        let legacySamplesURL = baseURL.appendingPathComponent(legacySamplesFileName)
        let legacySessionsURL = baseURL.appendingPathComponent(legacySessionsFileName)

        var migratedAnything = false

        if let samples = readLegacy([HeartRateSample].self, from: legacySamplesURL), !samples.isEmpty {
            beginTransaction()
            for sample in samples {
                insertOrReplaceSample(sample)
            }
            commitTransaction()
            migratedAnything = true
        }

        if let sessions = readLegacy([HeartRateSession].self, from: legacySessionsURL), !sessions.isEmpty {
            beginTransaction()
            for session in sessions {
                let now = isoString(Date())
                let sql = """
                INSERT OR IGNORE INTO heart_rate_sessions_local
                (id, user_id, source_type, source_device_id, started_at, ended_at, status, app_version, device_model, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                """
                guard let statement = prepare(sql) else { continue }
                bindText(session.id.uuidString, to: statement, at: 1)
                bindText(session.userId, to: statement, at: 2)
                bindText(session.sourceType.rawValue, to: statement, at: 3)
                bindText(session.sourceDeviceId, to: statement, at: 4)
                bindText(isoString(session.startedAt), to: statement, at: 5)
                bindOptionalText(session.endedAt.map(isoString), to: statement, at: 6)
                bindText(session.status, to: statement, at: 7)
                bindOptionalText(session.appVersion, to: statement, at: 8)
                bindOptionalText(session.deviceModel, to: statement, at: 9)
                bindText(now, to: statement, at: 10)
                bindText(now, to: statement, at: 11)
                if sqlite3_step(statement) != SQLITE_DONE {
                    logDatabaseError("migrateLegacySessions")
                }
                sqlite3_finalize(statement)
            }
            commitTransaction()
            migratedAnything = true
        }

        if migratedAnything {
            try? FileManager.default.removeItem(at: legacySamplesURL)
            try? FileManager.default.removeItem(at: legacySessionsURL)
        }
    }

    private func readLegacy<T: Decodable>(_ type: T.Type, from url: URL) -> T? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? decoder.decode(type, from: data)
    }

    private func prepare(_ sql: String) -> OpaquePointer? {
        ensureBootstrapped()
        openDatabaseIfNeeded()
        guard let db else { return nil }

        var statement: OpaquePointer?
        if sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK {
            return statement
        }
        logDatabaseError("prepare", sql: sql)
        if let statement {
            sqlite3_finalize(statement)
        }
        return nil
    }

    private func execute(_ sql: String) {
        ensureBootstrapped()
        openDatabaseIfNeeded()
        guard let db else { return }

        if sqlite3_exec(db, sql, nil, nil, nil) != SQLITE_OK {
            logDatabaseError("execute", sql: sql)
        }
    }

    private func beginTransaction() {
        execute("BEGIN IMMEDIATE TRANSACTION;")
    }

    private func commitTransaction() {
        execute("COMMIT;")
    }

    private func bindText(_ value: String, to statement: OpaquePointer, at index: Int32) {
        _ = value.withCString { cString in
            sqlite3_bind_text(statement, index, cString, -1, sqliteTransient)
        }
    }

    private func bindOptionalText(_ value: String?, to statement: OpaquePointer, at index: Int32) {
        guard let value else {
            sqlite3_bind_null(statement, index)
            return
        }
        bindText(value, to: statement, at: index)
    }

    private func bindOptionalDouble(_ value: Double?, to statement: OpaquePointer, at index: Int32) {
        guard let value else {
            sqlite3_bind_null(statement, index)
            return
        }
        sqlite3_bind_double(statement, index, value)
    }

    private func bindOptionalInt(_ value: Int?, to statement: OpaquePointer, at index: Int32) {
        guard let value else {
            sqlite3_bind_null(statement, index)
            return
        }
        sqlite3_bind_int(statement, index, Int32(value))
    }

    private func text(from statement: OpaquePointer, at index: Int32) -> String? {
        guard let cString = sqlite3_column_text(statement, index) else { return nil }
        return String(cString: cString)
    }

    private func uuid(from statement: OpaquePointer, at index: Int32) -> UUID? {
        guard let stringValue = text(from: statement, at: index) else { return nil }
        return UUID(uuidString: stringValue)
    }

    private func double(from statement: OpaquePointer, at index: Int32) -> Double? {
        guard sqlite3_column_type(statement, index) != SQLITE_NULL else { return nil }
        return sqlite3_column_double(statement, index)
    }

    private func optionalBool(from statement: OpaquePointer, at index: Int32) -> Bool? {
        guard sqlite3_column_type(statement, index) != SQLITE_NULL else { return nil }
        return sqlite3_column_int(statement, index) == 1
    }

    private func date(from statement: OpaquePointer, at index: Int32) -> Date? {
        guard let stringValue = text(from: statement, at: index) else { return nil }
        return date(from: stringValue)
    }

    private func date(from string: String) -> Date? {
        if let precise = isoFormatter.date(from: string) {
            return precise
        }
        let fallback = ISO8601DateFormatter()
        fallback.formatOptions = [.withInternetDateTime]
        return fallback.date(from: string)
    }

    private func isoString(_ date: Date) -> String {
        isoFormatter.string(from: date)
    }

    private func jsonString<T: Encodable>(_ value: T) -> String? {
        guard let data = try? encoder.encode(value) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func jsonArray(from statement: OpaquePointer, at index: Int32) -> [Double]? {
        guard let raw = text(from: statement, at: index),
              let data = raw.data(using: .utf8) else {
            return nil
        }
        return try? decoder.decode([Double].self, from: data)
    }

    private func logDatabaseError(_ context: String, sql: String? = nil) {
        guard let db else { return }
        let message = String(cString: sqlite3_errmsg(db))
        if let sql {
            print("⚠️ BiometricsLocalStore \(context) failed: \(message)\nSQL: \(sql)")
        } else {
            print("⚠️ BiometricsLocalStore \(context) failed: \(message)")
        }
    }

    private var sqliteTransient: sqlite3_destructor_type {
        unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    }
}
