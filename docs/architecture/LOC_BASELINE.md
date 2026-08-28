# Canonical authored-production LOC baseline

This is the single executable LOC baseline for the Ritual ship branch. It measures only git-tracked authored production files using the bucket and exclusion contract in `tools/architecture/production-loc.config.json`.

- Command: `npm run audit:loc`
- Verification: `npm run audit:loc:check`
- Head at measurement: `2ce237896b7aa3b269edd5c08b7dce0d2066ac89`
- Source digest: `95d1a9be97f8ac1e0a17e50ba7cc243d17723d7278d04359893c70b4f8dcfda3`
- Tokei: `14.0.0`
- Total: **197,854**
- Historical 180,000–185,000 target: **not met**

## Current buckets

| Bucket | Files | Code lines |
|---|---:|---:|
| Dashboard production | 522 | 85,691 |
| Shared packages | 69 | 10,327 |
| FastAPI application | 240 | 58,666 |
| Rust desktop, watcher, and ritual-db | 90 | 39,456 |
| Desktop hosted-shell bootstrap | 4 | 299 |
| Desktop local Vite SPA | 17 | 365 |
| Browser extension | 4 | 1,002 |
| Tinybird authored DSL | 24 | 2,048 |
| **Strict authored production, excluding iOS** | **970** | **197,854** |

## Historical reconciliation

| Claim | Lines | Current delta | Provenance |
|---|---:|---:|---|
| Original architecture audit | 192,474 | +5,380 | Dirty source snapshot documented by RITUAL_VS_BERD_ARCHITECTURE_AUDIT.md |
| Dirty feature-tree results claim | 183,970 | +13,884 | Uncommitted codex/tasks-routines-mvp snapshot; not a ship-branch result |
| Release overview estimate | 192,600 | +5,254 | Manual audit-comparable estimate; replaced by this executable baseline |

The 183.97k number is not a release-branch result and must not be used as proof that the original target was met. The former ~192.6k release value was an undocumented estimate. The original 192,474 count was a valid audit snapshot but described a dirty historical tree. This report supersedes those values for current ship-branch decisions.

The target band is descriptive, not permission to delete working product. If the total remains outside it after evidence-backed dead-code removal and owner consolidation, the architecture documents must report that result honestly.
