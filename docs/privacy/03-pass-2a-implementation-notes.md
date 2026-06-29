# Pass 2A Implementation Notes

Date: 2026-06-23

## Implemented Scope

This pass implements the approved smaller stage: privacy guardrails and a local vault pilot.

Implemented guardrails:

- Shared TypeScript privacy policy in `packages/shared-contracts/src/privacy.ts`.
- Backend Python privacy policy in `apps/backend/services/privacy_policy.py`.
- Dashboard local privacy settings stored in browser local storage and surfaced in Settings > Privacy.
- Privacy headers added to the dashboard API client and backend proxy.
- OpenPanel initialization disabled unless product telemetry consent is enabled.
- OpenPanel event properties redacted by default.
- Backend Sentry user/query/tag context redacted outside Cloud Intelligence.
- Tinybird ingestion and reads blocked by policy in Local Only/Private Sync.
- Dashboard-side Tinybird service guarded and stripped of raw event/query logging.
- Typesense indexing/search blocked by policy in Local Only/Private Sync.
- AI chat, habit parser AI, calendar summary AI, voice transcription, Deepgram token minting, screenshot image extraction, and FastAPI screenshot analysis gated by explicit consent.
- Trigger.dev backend client blocks provider sync and proactive SMS paths unless deployment consent is configured.
- Manual wearable and financial sync endpoints require provider sync consent.
- Desktop legacy plaintext cloud sync is blocked by default before opening remote Turso.
- Backend `/api/user/turso-sync-config` blocks legacy plaintext sync config by default.
- Static privacy verifier added at `scripts/verify-privacy-guardrails.mjs`.

Implemented local vault pilot:

- Encrypted local record helpers in `apps/dashboard/lib/privacy/local-vault.ts`.
- AES-GCM record encryption with PBKDF2-derived keys.
- Metadata remains minimal and unencrypted: record ID, record type, updated timestamp, tombstone flag, algorithm/KDF, salt, IV.
- Focused test asserts sensitive habit/log payload text is not present in stored vault blobs.

## How To Enable Cloud Paths In This Stage

Defaults are intentionally fail-closed:

```bash
RITUAL_PRIVACY_MODE=local_only
RITUAL_CLOUD_CONSENTS=
```

Cloud Intelligence with selected cloud features can be enabled for development or a consented deployment:

```bash
RITUAL_PRIVACY_MODE=cloud_intelligence
RITUAL_CLOUD_CONSENTS=product_telemetry,crash_diagnostics,analytics,search,ai,voice,vision,provider_sync,sms
```

Legacy plaintext desktop sync is still separate and must be explicitly enabled:

```bash
RITUAL_CLOUD_CONSENTS=plaintext_sync
```

This is intentionally not the recommended long-term sync path. Private Sync should use encrypted envelopes in a later stage.

## Limitations

- This pass does not migrate existing cloud-stored behavioral data into a local vault.
- This pass does not delete existing cloud behavioral copies.
- This pass does not implement E2EE sync envelopes.
- This pass does not replace backend Turso as the source of truth for existing habit/log screens.
- This pass does not encrypt the existing desktop `~/.ritual/ritual.db`.
- This pass does not encrypt iOS offline queues or HealthKit/location local stores.
- This pass does not implement full File-over-App Ritual Vault export.
- Dashboard privacy settings are local browser settings in this pass, not durable cross-device account settings.
- Server-side scheduled jobs use deployment env consent, not per-user persisted consent.
- Some account/provider connection setup paths still require a future product consent flow and migration design.

## Verification Commands

```bash
npm run contracts:build
node --test apps/dashboard/tests/privacy-settings.test.mjs
node --import tsx --test apps/dashboard/tests/privacy-local-vault.test.ts
cd apps/backend && pytest tests/test_privacy_policy.py
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml privacy_policy
npm run privacy:verify
npm run typecheck
npm run lint
npm run build
npm run test:dashboard
cd apps/backend && pytest tests
```
