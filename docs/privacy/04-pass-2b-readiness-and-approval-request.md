# Pass 2B Readiness and Approval Request

Date: 2026-06-23

## Current Status

Pass 1 is complete.

Pass 2A is complete for the approved scope: privacy guardrails and a local vault pilot only. The working implementation now defaults sensitive cloud egress to fail closed, adds policy helpers across TypeScript, Python, and Rust, surfaces local privacy settings in the dashboard, blocks legacy plaintext desktop/Turso sync without `plaintext_sync` consent, gates AI/voice/vision/provider sync paths, redacts analytics, and includes an AES-GCM local vault pilot helper.

Verification recorded in `03-pass-2a-implementation-notes.md` passed, including:

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm run test:dashboard`
- `cd apps/backend && pytest tests`
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml privacy_policy`
- `npm run privacy:verify`

## Full Objective Completion Audit

| Requirement | Current evidence | Status |
| --- | --- | --- |
| Pass 1 analysis docs | `00-current-architecture-audit.md`, `01-reference-review.md`, `02-local-first-e2ee-vault-implementation-plan.md` | Complete |
| Explicit approval before Pass 2 | Human approved only `Pass 2A: implement privacy guardrails and local vault pilot only` | Complete for 2A only |
| Local-first sensitive data storage | `apps/dashboard/lib/privacy/local-vault.ts` implements an encrypted pilot helper only | Partial |
| Privacy settings and data guardrails | Shared/backend/desktop policy helpers, dashboard Privacy settings UI, guarded egress paths | Complete for 2A |
| Optional E2EE sync | No encrypted envelope server/client sync implementation yet | Not started |
| Migration from current cloud-stored behavioral data | No migration wizard, inventory, batch download, count/hash verification, or local vault import flow yet | Not started |
| Cloud behavioral data deletion controls | No full deletion service/status/receipt flow across Turso, Tinybird, Typesense, Trigger, OpenPanel, Sentry, generated records | Not started |
| File-over-App export / Ritual Vault | No full Ritual Vault folder/zip export/import implementation yet | Not started |
| Tinybird/analytics sensitive leakage | Tinybird/OpenPanel guardrails and redaction are in place | Complete for 2A |
| AI/cloud explicit consent | AI/voice/vision/provider sync guardrails are in place | Complete for 2A guardrails; product UX still staged |
| UI flows | Settings > Privacy exists; migration/deletion/export/E2EE setup flows do not | Partial |
| Backend/schema/API changes | Guardrail APIs/policy checks exist; migration/deletion/E2EE/export APIs do not | Partial |
| Comprehensive tests | Focused privacy tests plus full existing suites pass | Complete for 2A; incomplete for later stages |
| Privacy verification script | `scripts/verify-privacy-guardrails.mjs` | Complete for 2A |
| Run lint/typecheck/tests/build | Completed for Pass 2A | Complete for 2A |
| Document limitations | `03-pass-2a-implementation-notes.md` | Complete |
| Final PR-style summary for full Pass 2 | Not valid yet because full Pass 2 is incomplete | Not started |

The full thread goal is therefore not complete. The missing work is not blocked by implementation uncertainty; it is blocked by scope approval because the only explicit approval so far was Pass 2A.

## Recommended Next Approval Gate

Do not jump straight to all remaining stages at once. Pass 1 identified that an all-at-once flip would break important current features and risk leaving hidden secondary copies.

Recommended next stage:

`Approved for Pass 2B: implement local sensitive vault source-of-truth foundation and migration inventory/dry-run only.`
Pass 2B should include:

1. A desktop-first local vault storage service backed by a durable local database/file, using record-level encryption and platform-protected keys where available.
2. Domain adapters for habit definitions and habit logs first, with compatibility reads so existing UI can read local records when present and fall back to current backend data.
3. A migration inventory API/UI that counts current cloud behavioral records by category without deleting anything.
4. A dry-run migration plan that can download and validate sample batches into the local vault pilot without changing cloud source data.
5. Tests proving plaintext sensitive values do not appear in vault payloads, migration inventory is idempotent, and existing guarded cloud paths remain fail-closed.

Pass 2B should not yet include:

- Actual cloud behavioral deletion.
- Full E2EE envelope sync.
- Full Ritual Vault export/import.
- Broad migration of every behavioral category.
- Re-enabling sensitive analytics/AI defaults.

Those should remain separate approval gates after the local source-of-truth and migration inventory are proven.

## Approval Needed

Explicit human approval is required before implementation can continue beyond Pass 2A.

Recommended approval wording:

`Approved for Pass 2B: implement local sensitive vault source-of-truth foundation and migration inventory/dry-run only.`
