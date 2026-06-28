# Privacy Simplification Scope Decision Log

Date: 2026-06-26

Status: approved and implemented as the privacy simplification Pass 2. See `docs/privacy/18-privacy-simplification-pass-2-after-report.md` for the implemented result and verification.

## Decision 1: Choose One Canonical Store

Recommendation: choose local DB/encrypted local vault canonical for V1.

Reason: the current implementation keeps encrypted local vault, live Markdown/JSONL vault, derived SQLite index, JSON snapshot, and server envelopes as overlapping data stores. Local DB canonical gives the simplest beta privacy guarantee: sensitive records are local first, encrypted locally where supported, and exported into user-owned files on demand.

Consequence: live Obsidian-style Markdown-as-database becomes V2. File-over-App remains real through export/mirror, but not as the runtime database.

Approval needed: yes.

## Decision 2: Treat File-over-App As Export/Mirror In V1

Recommendation: keep readable Ritual Vault export with `README.md`, `manifest.json`, `tracks/*.md`, `logs/YYYY/MM/YYYY-MM-DD.jsonl`, and daily note Markdown where applicable.

Reason: users still own their data, and the implementation can be much smaller. Live file watching, repair, conflict handling, and bidirectional Markdown parsing are the expensive parts.

Consequence: users can inspect and back up files, but external edits do not immediately drive the app database in V1.

Approval needed: yes, because this reverses the prior file-native canonical direction.

## Decision 3: Remove Native File Watcher And Native File Index From V1

Recommendation: defer `file_native_watcher.rs` and `file_native_index*.rs`.

Reason: these modules exist to make a live file-native database performant and reactive. They are not required when export is derived from the canonical local store.

Consequence: lower desktop maintenance cost and fewer Tauri permissions/commands. Search/analytics should query the canonical local store or remain cloud-gated where no local equivalent exists.

Approval needed: yes.

## Decision 4: Collapse Operational JSONL Category Explosion

Recommendation: do not keep `.ritual/data/*.jsonl` as broad runtime storage in V1.

Reason: `file-native-vault-data.ts` alone adds more than 3.4k lines and encodes many categories before the product has proven that file-native is the app database. Export can serialize representative records without permanent per-category runtime readers/writers.

Consequence: high-volume raw categories such as OCR frames, raw wearable payloads, AI messages, SMS/copilot events, and financial transactions remain in the canonical local store and are exported only when explicitly included.

Approval needed: yes.

## Decision 5: Keep Central Guardrails

Recommendation: keep and strengthen the shared/backend/desktop privacy policy boundary.

Reason: this is the most important safety layer and is not the source of over-engineering. The current implementation already has useful policy primitives in shared contracts, backend Python, and desktop Rust.

Consequence: Pass 2 should remove scattered checks by routing outbound Tinybird, OpenPanel, Sentry, AI, Trigger, provider, backend sync, and desktop cloud sync calls through this boundary.

Approval needed: no for principle, yes for specific code edits in Pass 2.

## Decision 6: Keep Safe Migration And Explicit Deletion

Recommendation: keep one migration path and one explicit cloud deletion path.

Reason: users with existing cloud behavioral data need a safe local import and deletion story. This is core to the privacy promise.

Consequence: remove local-vault-to-file-native promotion if file-native is not canonical. Keep idempotent cloud-to-local migration and local deletion receipts.

Approval needed: yes for deleting file-native promotion.

## Decision 7: Private Sync V1 Is Generic Envelopes, Not Full Device Platform

Recommendation: keep generic encrypted envelopes only if they remain small and verified. Put trusted devices, key grants, and revoke behind an experimental disabled flag if they prevent the line-count goal.

Reason: ciphertext-only sync is core if Private Sync is advertised. Trusted-device revoke is valuable, but it is not necessary for a beta Local Only plus export promise and adds substantial complexity.

Consequence: public UI should not claim mature per-device revoke unless the implementation is retained and tested. If flagged off, docs must say Private Sync is experimental or unavailable.

Approval needed: yes.

## Decision 8: Collapse Privacy UI

Recommendation: one privacy settings/data screen.

Reason: the current UI has a large main panel plus separate export, external erasure, Private Sync hardening, file-native folder, diagnostics, and bridge components. That mirrors implementation complexity.

Consequence: users see privacy mode, consents, migration, deletion, export, and sync status in one place. Advanced/deferred controls are removed or hidden.

Approval needed: yes.

## Decision 9: Reduce Tests By Boundary, Not By Safety

Recommendation: keep tests that prove privacy guarantees and delete tests that only verify removed implementation details.

Reason: line-count reduction must not come from deleting safety evidence. The remaining tests should prove Local Only isolation, telemetry redaction, ciphertext sync, readable export, migration safety, and deletion confirmation.

Consequence: many file-native category tests can be removed only after equivalent export/local-store boundary tests are in place.

Approval needed: no for principle, yes for concrete test deletions in Pass 2.

## Decision 10: No Pass 2 Without Explicit Approval

Recommendation: stop after this Pass 1 package.

Reason: the proposed simplification intentionally changes product architecture from the prior file-native-canonical implementation. That is a product-owner decision.

Consequence: no source, schema, migration, package, config, or test edits should happen until approval is given.

Approval needed: yes.

## Proceed Recommendation

Proceed with Pass 2 only if the product owner accepts Option A for V1.

Do not proceed with a line-count-driven deletion pass if the product owner still wants Ritual to be file-native Markdown-as-database immediately. In that case, the current implementation should be refactored more carefully around Option B, and the <=12k runtime target is probably unrealistic without breaking important file-native behavior.
