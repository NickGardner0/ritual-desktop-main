# Canonical authored-production LOC baseline

This is the single executable LOC baseline for the Ritual ship branch. It measures only git-tracked authored production files using the bucket and exclusion contract in `tools/architecture/production-loc.config.json`.

- Command: `npm run audit:loc`
- Verification: `npm run audit:loc:check`
- Head at measurement: `67ffdfae96d4400390e8fdcfc332c13e6da2e101`
- Source digest: `d6b9fefdf00b6f84147a18bae32b5bda366d65c5f1a3de28c7a271af325fb63b`
- Tokei: `14.0.0`
- Total: **199,118**
- Historical 180,000–185,000 target: **not met**

## Current buckets

| Bucket | Files | Code lines |
|---|---:|---:|
| Dashboard production | 525 | 86,123 |
| Shared packages | 69 | 10,327 |
| FastAPI application | 240 | 58,666 |
| Rust desktop, watcher, and ritual-db | 91 | 39,909 |
| Desktop hosted-shell bootstrap | 4 | 299 |
| Desktop local Vite SPA | 18 | 744 |
| Browser extension | 4 | 1,002 |
| Tinybird authored DSL | 24 | 2,048 |
| **Strict authored production, excluding iOS** | **975** | **199,118** |

## Historical reconciliation

| Claim | Lines | Current delta | Provenance |
|---|---:|---:|---|
| Original architecture audit | 192,474 | +6,644 | Dirty source snapshot documented by RITUAL_VS_BERD_ARCHITECTURE_AUDIT.md |
| Dirty feature-tree results claim | 183,970 | +15,148 | Uncommitted codex/tasks-routines-mvp snapshot; not a ship-branch result |
| Release overview estimate | 192,600 | +6,518 | Manual audit-comparable estimate; replaced by this executable baseline |

The 183.97k number is not a release-branch result and must not be used as proof that the original target was met. The former ~192.6k release value was an undocumented estimate. The original 192,474 count was a valid audit snapshot but described a dirty historical tree. This report supersedes those values for current ship-branch decisions.

The target band is descriptive, not permission to delete working product. If the total remains outside it after evidence-backed dead-code removal and owner consolidation, the architecture documents must report that result honestly.
