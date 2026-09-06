# Reference Review

Date: 2026-06-23

## Sources Reviewed

### Notesnook

- Repo: `https://github.com/streetwriters/notesnook`
- Local clone: `/tmp/ritual-privacy-reference/notesnook`
- Commit reviewed: `f9f974c` (`2026-06-19`, merge PR `#9429`)
- License: GPL-3.0. Treat as architectural reference only; do not copy code into Ritual without legal review.

### Turso

- Repo: `https://github.com/tursodatabase/turso`
- Local clone: `/tmp/ritual-privacy-reference/turso`
- Commit reviewed: `0f1ad85` (`2026-06-23`, merge "ci: Gate CodSpeed shards on matching build")
- License: MIT.

### File over App

- Article: Steph Ango, "File over app", `https://stephango.com/file-over-app`
- Published: 2023-07-01
- Local saved copy: `/tmp/ritual-privacy-reference/file-over-app.html`

## Notesnook Findings

Notesnook is a mature example of a privacy-first app that separates local app state, encrypted sync, encrypted backups, and user-readable exports.

Key observed patterns:

- The README states the product goal clearly: end-to-end encrypted note taking with zero-knowledge principles, encrypting on device with XChaCha20-Poly1305 and Argon2.
- `packages/crypto` wraps libsodium and implements XChaCha20-Poly1305 item encryption plus Argon2 key derivation.
- The help docs describe client-side key generation, key storage in IndexedDB/CryptoKey on web/desktop and keychain on mobile, and per-item encryption before sync.
- Sync collector code gathers unsynced local items, stringifies JSON, encrypts batches with the latest data key, attaches item ID/version/key version metadata, and sends encrypted sync items to the server.
- Sync processing decrypts incoming encrypted items locally before applying migrations/merges.
- Sync types are collection-oriented. Items have IDs, database version, cipher fields, and key version.
- Content has explicit `localOnly` flags and locked/encrypted content concepts.
- Backups are separate from sync. Backup export can create encrypted backup chunks and validates/decrypts them during import.
- Export is also separate from backup. Notes can be exported to user-readable PDF, HTML, Markdown, and plain text.
- Private vault is a separate extra protection layer for especially sensitive notes, even though the whole product already uses E2EE.
- Privacy mode is an OS-level UI safeguard that disables screen capture and window previews where supported.

Useful takeaways for Ritual:

1. E2EE sync should sync encrypted items/envelopes, not plaintext domain tables.
2. Sync metadata can remain visible only where necessary: opaque item ID, type/collection, revision/version, timestamps, tombstone, key version.
3. Local database usability and remote zero-knowledge are distinct. Ritual needs local encryption and encrypted remote envelopes.
4. Backups, exports, and sync serve different purposes and should have different file formats and UX.
5. Recovery has to be explicit. If the server cannot decrypt data, account recovery must be based on recovery key/device pairing/backup, not backend support.
6. Local-only items are a real product state, not just "not synced yet".
7. Private vault controls are useful even inside an encrypted product because some local device exposure remains.

Risks or differences from Ritual:

- Notesnook is notes-first. Ritual has time-series logs, provider tokens, biometrics, location, activity streams, generated artifacts, and AI tool payloads.
- Ritual has many analytics/search/AI fan-out paths that Notesnook's core sync pattern alone does not solve.
- Notesnook is GPL-3.0, so code reuse is not appropriate for this repo without legal review.

## Turso Findings

Turso is useful as an embedded SQLite-compatible local database and as a sync transport, but it should not be treated as the whole privacy architecture.

Key observed patterns:

- The README describes Turso Database as an in-process SQL database compatible with SQLite.
- Turso supports local file databases through `Builder::new_local(...)`.
- The Rust sync README shows a separate synced-database builder, `turso::sync::Builder::new_remote("local.db")`, with explicit remote URL and auth token.
- The JavaScript sync package supports `connect({ path, url, authToken, clientName })`, with `url` optional so a local-only DB can be created and sync can be switched on later.
- Sync APIs expose `pull()`, `push()`, and `sync()`.
- Python SQLAlchemy dialect docs expose local dialects and a `sqlite+turso_sync://` dialect that pulls/pushes remote changes.
- Remote sync supports optional remote encrypted Turso Cloud databases via a remote encryption key/cipher. This is cloud-database encryption access, not necessarily application-level zero knowledge.
- Turso has experimental at-rest encryption for local database files with ciphers including AES-GCM and AEGIS.
- In the Rust sync builder source, local at-rest encryption is intentionally omitted for the sync engine; cloud encryption is configured separately.

Useful takeaways for Ritual:

1. Turso/libSQL can remain a pragmatic local SQL substrate.
2. The current desktop `ritual-db` choice is directionally compatible with local-first.
3. Optional sync should be a user-mode switch: a local database can exist first, and remote credentials can appear later.
4. Short-lived sync tokens and device-specific client names fit Ritual's existing per-user Turso provisioning work.
5. Do not rely on database-provider encryption as E2EE. For zero-knowledge sync, Ritual must encrypt sensitive application records before they leave the client.
6. Do not rely on transparent local DB encryption alone. Even if the DB file is encrypted, logs, outboxes, search indexes, exports, and telemetry can still leak.

Risks or differences from Ritual:

- Turso sync is SQL-row oriented; syncing existing plaintext domain tables would expose data to the remote database.
- Local encryption support is experimental in Turso docs and not available in the sync builder path reviewed.
- Current Ritual backend uses `libsql-client`/`sqlalchemy-libsql`, while the cloned Turso repo is the newer database implementation and bindings. Implementation must check actual crate/package capabilities before choosing a local encryption mechanism.

## File over App Findings

Steph Ango's article is a short product philosophy rather than an implementation guide. The key point is that durable digital artifacts should be files the user controls, in formats that are easy to retrieve and read. The article argues apps are ephemeral while user-owned files have a chance to last.

Useful takeaways for Ritual:

1. "Export" should not be an afterthought or an opaque backup blob.
2. Ritual Vault should be a folder or zip of durable, documented, user-readable files.
3. Markdown and JSONL are good default formats for habit definitions, logs, daily notes, generated artifacts, and manifests.
4. Proprietary local DB files are not enough. They are app state, not the user's durable artifact format.
5. The app should be able to rebuild from the user's vault files where practical.
6. Exports should preserve ownership even if Ritual's cloud or app disappears.

## Cross-Reference Synthesis

The simplest privacy architecture for Ritual combines all three references:

- Use local SQL for responsive app state and time-series queries.
- Encrypt sensitive records locally before optional remote sync.
- Keep remote sync as opaque encrypted envelopes plus minimal metadata.
- Keep backup as encrypted recovery artifact.
- Keep File-over-App export as durable user-readable files.
- Keep provider/cloud/AI features opt-in, explicit, and revocable.

Important distinction:

- Local DB: optimized for app behavior.
- E2EE sync envelope: optimized for private multi-device replication.
- Encrypted backup: optimized for recovery.
- Ritual Vault export: optimized for user ownership, durability, and interoperability.

## Reference-Informed Recommendation

Ritual should not copy Notesnook's code or try to make Turso itself provide all privacy guarantees.

The recommended pattern is:

1. Make a local sensitive vault the source of truth.
2. Add a data classification and consent gate before every remote write/read/AI/tool path.
3. Sync only encrypted envelopes for sensitive records.
4. Export durable vault files independent of sync.
5. Leave cloud analytics/AI as explicit Cloud Intelligence mode, not baseline behavior.
