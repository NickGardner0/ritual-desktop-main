# Pass 2F Implementation Notes

Date: 2026-06-24

Status: implemented for the approved scope: File-over-App Ritual Vault export/import.

## Implemented Scope

Pass 2F adds a local-vault archive format that lets users move their data as files rather than depending on the app or backend as the only interface.

- Added Ritual Vault archive builder, previewer, verifier, and importer in `apps/dashboard/lib/privacy/ritual-vault-export.ts`.
- Added a Privacy settings export/import section in `apps/dashboard/components/privacy-vault-export-section.tsx`.
- Wired the section into `apps/dashboard/components/privacy-settings-panel.tsx`.
- Added focused archive tests in `apps/dashboard/tests/privacy-ritual-vault-export.test.ts`.
- Extended `scripts/verify-privacy-guardrails.mjs` for Ritual Vault archive and UI paths.

## Archive Layout

The exported file is a ZIP with a `Ritual Vault/` root:

```text
Ritual Vault/
  manifest.json
  checksums.sha256
  schema/
    ritual-vault.schema.json
  data/
    <category>.jsonl
  markdown/
    <category>.md
  metadata/
    migration-manifests.json
    deletion-receipts.json
```

Each JSONL row is a local-vault record:

```json
{
  "collection": "habit_logs",
  "record_id": "log-123",
  "record_type": "habit_log",
  "updated_at": "2026-06-24T12:00:00.000Z",
  "tombstone": false,
  "payload": {}
}
```

`checksums.sha256` covers all archive files except itself. Import validates checksums before writing anything to the local vault.

## Default Export Boundary

Standard export includes core local-vault categories and excludes higher-risk categories by default.

Default exclusions include:

- raw URLs;
- window titles;
- OCR text;
- screenshots;
- visible text captures;
- raw provider payloads;
- raw location categories;
- AI conversations/messages/facts;
- financial records.

The Privacy settings UI has an explicit `Include sensitive` toggle. When enabled, the archive can include the approved local-vault migration categories, including AI, location, SMS/copilot, workflows, reports, imports, and financial records.

## Import Boundary

Import:

1. Opens a selected Ritual Vault ZIP.
2. Reads and validates `manifest.json`.
3. Verifies `checksums.sha256`.
4. Parses category JSONL files.
5. Writes verified records into the encrypted local vault.

Import does not contact backend services, provider APIs, Tinybird, Typesense, OpenPanel, Sentry, Trigger, or AI providers.

## Known Limitations

- The original archive is still a ZIP file with readable JSONL and Markdown by design.
- A later hardening pass added a passphrase-encrypted JSON wrapper around the ZIP bytes. Use encrypted export for sensitive archives. See `14-final-remaining-pass-2-implementation-notes.md`.
- Export reads local vault records only; cloud-only data must be migrated locally before export.
- Standard export excludes sensitive categories by default, but included core records can still contain user-entered habit names and notes.
- Import restores records into the local vault; it does not recreate backend rows or private sync envelopes.
- Large exports are bounded by the local vault list limit and ZIP generation in memory.
- Recovery phrase/file, trusted-device pairing kits, key rotation, and conflict-review UI were later implemented for Private Sync. A later scoped pass added backend device registration and per-device revoke enforcement; automatic key-grant application and post-revoke key rotation remain future hardening.
- External erasure controls were later implemented for Private Sync envelopes, Tinybird, and Typesense. OpenPanel, Sentry, Trigger.dev, and provider-side erasure remain manual-required receipt workflows.

## Verification Commands

Commands run for this stage:

- `node --import tsx --test apps/dashboard/tests/privacy-ritual-vault-export.test.ts`
- `node --import tsx --test apps/dashboard/tests/privacy-ritual-vault-export.test.ts apps/dashboard/tests/privacy-vault-private-sync.test.ts`
- `node --import tsx --test apps/dashboard/tests/privacy-ritual-vault-export.test.ts apps/dashboard/tests/privacy-vault-private-sync.test.ts apps/dashboard/tests/privacy-vault-migration.test.ts apps/dashboard/tests/privacy-vault-deletion.test.ts apps/dashboard/tests/privacy-local-vault.test.ts apps/dashboard/tests/privacy-habit-vault-adapter.test.ts apps/dashboard/tests/privacy-settings.test.mjs`
- `npm run privacy:verify`
- `npm run typecheck`
- `npm run lint`
- `npm run test:dashboard`
- `pytest tests` from `apps/backend`
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`
- `npm run repo:check`
- `npm run build`
- `git diff --check`

Observed non-blocking warnings:

- Next used the WASM SWC fallback because `@next/swc-darwin-arm64` is not installed locally.
- Browserslist data is stale.
- Backend tests still emit existing Pydantic/SQLAlchemy/datetime deprecation warnings outside the new Ritual Vault code.
- Desktop tests still emit existing unused test helper warnings.
