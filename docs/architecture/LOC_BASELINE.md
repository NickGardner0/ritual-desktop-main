# Canonical authored-production LOC baseline

This is the single executable LOC baseline for the Ritual ship branch. It measures only git-tracked authored production files using the bucket and exclusion contract in `tools/architecture/production-loc.config.json`.

- Command: `npm run audit:loc`
- Verification: `npm run audit:loc:check`
- Head at measurement: `65ced577031db252495f505318229dc98b15090d`
- Source digest: `b25e9ad709ff1186a377ce5454eed378b1c047f13a5ba005e8401d614959639c`
- Tokei: `14.0.0`
- Total: **187,086**
- Historical 180,000–185,000 target: **not met**

## Current buckets

| Bucket | Files | Code lines |
|---|---:|---:|
| Dashboard production | 509 | 82,917 |
| Shared packages | 60 | 9,547 |
| FastAPI application | 231 | 56,281 |
| Rust desktop, watcher, and ritual-db | 84 | 34,960 |
| Desktop hosted-shell bootstrap | 4 | 331 |
| Browser extension | 4 | 1,002 |
| Tinybird authored DSL | 24 | 2,048 |
| **Strict authored production, excluding iOS** | **916** | **187,086** |

## Historical reconciliation

| Claim | Lines | Current delta | Provenance |
|---|---:|---:|---|
| Original architecture audit | 192,474 | −5,388 | Dirty source snapshot documented by RITUAL_VS_BERD_ARCHITECTURE_AUDIT.md |
| Dirty feature-tree results claim | 183,970 | +3,116 | Uncommitted codex/tasks-routines-mvp snapshot; not a ship-branch result |
| Release overview estimate | 192,600 | −5,514 | Manual audit-comparable estimate; replaced by this executable baseline |

The 183.97k number is not a release-branch result and must not be used as proof that the original target was met. The former ~192.6k release value was an undocumented estimate. The original 192,474 count was a valid audit snapshot but described a dirty historical tree. This report supersedes those values for current ship-branch decisions.

The target band is descriptive, not permission to delete working product. If the total remains outside it after evidence-backed dead-code removal and owner consolidation, the architecture documents must report that result honestly.
