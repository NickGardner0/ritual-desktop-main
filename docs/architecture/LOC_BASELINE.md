# Canonical authored-production LOC baseline

This is the single executable LOC baseline for the Ritual ship branch. It measures only git-tracked authored production files using the bucket and exclusion contract in `tools/architecture/production-loc.config.json`.

- Command: `npm run audit:loc`
- Verification: `npm run audit:loc:check`
- Head at measurement: `3204c747196b5e86561dd84dcac2dbd04c58a28d`
- Source digest: `8477d9be4888fb6842065fcacf0317f012959018481c7d68694fa036f07d69db`
- Tokei: `14.0.0`
- Total: **202,662**
- Historical 180,000–185,000 target: **not met**

## Current buckets

| Bucket | Files | Code lines |
|---|---:|---:|
| Dashboard production | 557 | 88,074 |
| Shared packages | 94 | 11,026 |
| FastAPI application | 230 | 58,469 |
| Rust desktop, watcher, and ritual-db | 92 | 40,444 |
| Desktop hosted-shell bootstrap | 4 | 299 |
| Desktop local Vite SPA | 26 | 1,300 |
| Browser extension | 4 | 1,002 |
| Tinybird authored DSL | 24 | 2,048 |
| **Strict authored production, excluding iOS** | **1,031** | **202,662** |

## Historical reconciliation

| Claim | Lines | Current delta | Provenance |
|---|---:|---:|---|
| Original architecture audit | 192,474 | +10,188 | Dirty source snapshot documented by RITUAL_VS_BERD_ARCHITECTURE_AUDIT.md |
| Dirty feature-tree results claim | 183,970 | +18,692 | Uncommitted codex/tasks-routines-mvp snapshot; not a ship-branch result |
| Release overview estimate | 192,600 | +10,062 | Manual audit-comparable estimate; replaced by this executable baseline |

The 183.97k number is not a release-branch result and must not be used as proof that the original target was met. The former ~192.6k release value was an undocumented estimate. The original 192,474 count was a valid audit snapshot but described a dirty historical tree. This report supersedes those values for current ship-branch decisions.

The target band is descriptive, not permission to delete working product. If the total remains outside it after evidence-backed dead-code removal and owner consolidation, the architecture documents must report that result honestly.
