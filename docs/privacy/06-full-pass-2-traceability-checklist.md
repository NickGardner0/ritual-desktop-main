# Full Pass 2 Traceability Checklist

Date: 2026-06-24

Status: traceability artifact. Pass 2A through Pass 2F plus the final remaining in-repo hardening pass have been implemented. Residual limitations are documented where the repo lacks a trusted provider/device API.

## Purpose

The full thread goal remains larger than the approved Pass 2A implementation. This checklist maps every explicit Pass 2 requirement to current evidence, missing evidence, the recommended implementation stage, and the proof needed before the full goal can be marked complete.

## Approval State

Current explicit approvals:

- `Approved for Pass 2A: implement privacy guardrails and local vault pilot only.`
- `Approved for Pass 2B: implement local sensitive vault source-of-truth foundation and migration inventory/dry-run only.`
- `Approved for Pass 2C: implement user-controlled migration of approved cloud behavioral data into the local vault.`
- `Approved for Pass 2C extension: implement category-specific migration for scheduled blocks, imports, wearable projections, location-enriched records, AI artifacts, reports, workflows, SMS/copilot, and financial data into the local vault.`
- `Approved for Pass 2D: implement cloud behavioral deletion controls and local deletion receipts.`
- `Approved for Pass 2E: implement optional E2EE private sync envelopes.`
- `Approved for Pass 2F: implement File-over-App Ritual Vault export/import.`

The later remaining-work request covered the prior Pass 2G/2H backlog where implementation was feasible in-repo:

- Private Sync recovery kits, trusted-device pairing kits, key rotation, and conflict review/resolution are implemented.
- External erasure controls are implemented for Private Sync envelopes, Tinybird, and Typesense.
- OpenPanel, Sentry, Trigger.dev, and provider-side erasure remain manual-required receipt workflows unless provider-specific deletion APIs and credentials are added.
- Per-device Private Sync revoke is now implemented for future envelope/key-grant access through a trusted-device registry and key-grant ledger. Automatic recipient key-grant application and post-revoke key rotation remain future hardening.

## Requirement Traceability

| ID | Requirement | Current state | Recommended stage | Evidence required for completion |
| --- | --- | --- | --- | --- |
| P2-01 | Implement local-first sensitive data storage | Pass 2B added durable encrypted desktop vault records and local-first habit/log reads. | Pass 2B complete; broaden write paths in later stages | Desktop vault database/service; encrypted habit/log writes and reads; dashboard adapter preferring local vault; tests proving no plaintext payload in vault blobs. |
| P2-02 | Implement privacy settings and data guardrails | Pass 2A implemented shared/backend/desktop policy helpers, dashboard Privacy settings, cloud egress headers, telemetry/AI/provider/sync gates. | Pass 2A complete, extend in later stages | `npm run privacy:verify`; focused privacy tests; full lint/typecheck/build/test commands; verifier extended as new paths are added. |
| P2-03 | Implement optional E2EE sync | Pass 2E implemented ciphertext-only private sync envelopes with local WebCrypto encryption/decryption and backend delta storage. Final hardening added keyring rotation, recovery kits, pairing kits, local conflict review/resolution, and scoped per-device revoke enforcement. | Implemented for optional E2EE sync scope | Encrypted envelope schema/API; device registry/key-grant ledger; client encryption/decryption; tests proving server never receives plaintext; recovery restore, key rotation, conflict, and revoke tests. |
| P2-04 | Implement migration from current cloud-stored behavioral data | Pass 2C and its extension implemented user-controlled local vault migration for approved behavioral categories with count/hash verification. | Pass 2C complete for approved categories | Inventory counts; batch download; local vault import; count/hash verification; idempotent resume; user confirmation before deletion. |
| P2-05 | Implement cloud behavioral data deletion controls | Pass 2D implemented receipt-gated backend Turso behavioral deletion for categories with approved local migration coverage. Final hardening added external erasure controls for Private Sync envelopes, Tinybird, and Typesense plus manual-required receipts for providers without in-repo APIs. | Implemented with documented provider limitations | Backend deletion service, deletion plan/execute APIs, external erasure plan/execute APIs, status UI, local deletion receipts, idempotency and account metadata tests. |
| P2-06 | Implement File-over-App export / Ritual Vault | Pass 2F implemented checksum-verified `Ritual Vault/` ZIP export/import from the local vault with JSONL, Markdown, manifest, schema, and sensitive-default exclusions. Final hardening added passphrase-encrypted archive wrapping. | Implemented | `Ritual Vault/` zip export; encrypted wrapper; documented schema; Markdown/JSONL output; checksums; sensitive export toggles; import/round-trip tests. |
| P2-07 | Refactor Tinybird/analytics paths to avoid sensitive data leakage | Pass 2A blocks Tinybird by policy in Local Only/Private Sync and redacts OpenPanel properties. | Pass 2A complete, validate after each later stage | Static verifier patterns; Tinybird/OpenPanel tests; no habit names/notes/raw payloads in telemetry without consent. |
| P2-08 | Refactor AI/cloud paths to require explicit consent | Pass 2A gates AI chat, habit parser, calendar summary, voice, screenshot analysis, provider sync, and legacy sync paths. Product consent UX is still minimal. | Guardrails complete in Pass 2A; richer UX later | Route tests and static verifier; UI consent flows for high-risk cloud actions before final full completion. |
| P2-09 | Add UI flows | Settings > Privacy includes guardrails, local vault status, inventory/dry-run, migration, cloud deletion controls, Private Sync setup/push/pull, Private Sync recovery/pairing/conflicts, Ritual Vault export/import, encrypted archive controls, and external erasure controls. | Implemented with documented provider limitations | Screens/settings panels for vault status, inventory/dry-run, migration, deletion, external erasure, export, private sync setup/recovery/conflicts; interaction tests where practical. |
| P2-10 | Add backend/schema/API changes if needed | Guardrails, inventory, migration, deletion, and E2EE envelope APIs/schemas exist. Export backend APIs do not. | Pass 2B onward | Backend APIs and schemas for inventory, migration, deletion, envelope sync, and export metadata; tests and OpenAPI/client updates if applicable. |
| P2-11 | Add comprehensive tests | Pass 2A through final hardening have focused backend, dashboard, desktop, and verifier coverage. Residual future work needs stage-specific tests. | Every stage | Stage-specific unit/integration tests plus existing full suites. The test scope must cover each stage's data loss, privacy, and fallback risks. |
| P2-12 | Add privacy verification script | `scripts/verify-privacy-guardrails.mjs` covers guardrails, vault, migration, deletion, external erasure, E2EE envelope/keyring/conflict paths, and Ritual Vault encrypted export/import paths. | Implemented | Verifier extended for vault plaintext scans, migration inventory egress, deletion controls, E2EE plaintext prevention, and export sensitive-default rules. |
| P2-13 | Run lint/typecheck/tests/build | Focused final hardening validation has passed; full build/test validation must be rerun after final docs. | Final validation in progress | `npm run typecheck`; `npm run lint`; focused privacy tests; `npm run privacy:verify`; final build/test commands. |
| P2-14 | Document limitations | Pass 2A through final hardening limitations are documented in stage notes through `14-final-remaining-pass-2-implementation-notes.md`. | Implemented | Updated docs after each stage with remaining privacy limitations, unsupported platforms, and known secondary copies. |
| P2-15 | Provide final PR-style summary | Valid for the approved staged scope after Pass 2F verification. | Final response for Pass 2F | Requirement-by-requirement completion audit, verification command output summary, limitations, and rollout notes. |

## Stage Breakdown

### Pass 2A: Guardrails and Local Vault Pilot

Status: implemented and verified.

Evidence:

- `docs/privacy/03-pass-2a-implementation-notes.md`
- `packages/shared-contracts/src/privacy.ts`
- `apps/backend/services/privacy_policy.py`
- `apps/desktop/src-tauri/src/privacy_policy.rs`
- `apps/dashboard/components/privacy-settings-panel.tsx`
- `apps/dashboard/lib/privacy/local-vault.ts`
- `scripts/verify-privacy-guardrails.mjs`

### Pass 2B: Local Vault Source-of-Truth Foundation and Migration Inventory/Dry-Run

Status: implemented and verified.

Primary design:

- `docs/privacy/05-pass-2b-local-vault-and-migration-inventory-design.md`

Completion proof must include:

- durable desktop `vault.db` or equivalent;
- encrypted habit definition/log storage;
- local-first dashboard adapter;
- migration inventory counts;
- dry-run sample encryption and verification;
- no source cloud deletion.

### Pass 2C: Actual Migration Into Local Vault

Status: implemented and verified for approved categories and extension categories.

Completion proof must include:

- user-controlled migration wizard;
- batch download and import for approved behavioral categories;
- count/hash verification;
- idempotent resume;
- local migration manifest;
- explicit user gate before any deletion.

### Pass 2D: Cloud Behavioral Deletion Controls

Status: implemented and verified for approved backend Turso behavioral categories.

Completion proof must include:

- table/service coverage map;
- dry-run and execution modes;
- deletion status and retry flow;
- local deletion receipts;
- account-required metadata preservation tests.

Evidence:

- `docs/privacy/11-pass-2d-implementation-notes.md`
- `apps/backend/services/privacy_migration_inventory.py`
- `apps/backend/api/privacy.py`
- `apps/desktop/src-tauri/src/local_vault.rs`
- `apps/dashboard/lib/privacy/vault-deletion.ts`
- `apps/dashboard/components/privacy-settings-panel.tsx`

### Pass 2E: Optional E2EE Private Sync

Status: implemented for the approved ciphertext envelope foundation and later hardening.

Completion proof must include:

- encrypted envelope API;
- client-side key generation and protected storage;
- client-side encryption/decryption;
- settings UI for setup, push, and pull;
- tests proving server ciphertext-only behavior.

Later hardening added recovery kits, trusted-device pairing kits, key rotation, local conflict records, conflict review/resolution UI, and scoped per-device revoke enforcement.

Evidence:

- `docs/privacy/12-pass-2e-implementation-notes.md`
- `apps/backend/database/models/privacy_sync.py`
- `apps/backend/services/privacy_private_sync.py`
- `apps/backend/api/privacy.py`
- `apps/dashboard/lib/privacy/vault-private-sync.ts`
- `apps/dashboard/components/privacy-settings-panel.tsx`
- `apps/backend/tests/test_privacy_private_sync.py`
- `apps/dashboard/tests/privacy-vault-private-sync.test.ts`

### Pass 2F: File-over-App Ritual Vault Export/Import

Status: implemented for the approved local-vault archive scope and later encrypted wrapper.

Completion proof must include:

- documented `Ritual Vault/` zip schema;
- readable Markdown/JSON/JSONL output;
- checksums;
- sensitive-default exclusions;
- round-trip import tests.

Evidence:

- `docs/privacy/13-pass-2f-implementation-notes.md`
- `docs/privacy/14-final-remaining-pass-2-implementation-notes.md`
- `apps/dashboard/lib/privacy/ritual-vault-export.ts`
- `apps/dashboard/components/privacy-vault-export-section.tsx`
- `apps/dashboard/components/privacy-settings-panel.tsx`
- `apps/dashboard/tests/privacy-ritual-vault-export.test.ts`

## Final Completion Gate

The approved Pass 2A through Pass 2F staged scope can be considered complete only after:

1. Pass 2B through Pass 2F, or an explicitly approved equivalent staged scope, are implemented.
2. Every requirement in the traceability table has direct evidence.
3. The privacy verifier covers all final storage, sync, telemetry, analytics, AI, network, migration, deletion, and export paths.
4. Full lint/typecheck/tests/build and focused privacy/E2EE/export checks pass.
5. Final limitations are documented.
6. A final PR-style summary is provided.

Residual hardening outside the implemented scope remains tracked separately: automatic Private Sync key-grant application and post-revoke key rotation, provider-specific API erasure integrations for processors without trusted in-repo delete APIs, and broader local-first write-path conversions.
