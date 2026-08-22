# Canonical authored-production LOC baseline

This is the single executable LOC baseline for the Ritual ship branch. It measures only git-tracked authored production files using the bucket and exclusion contract in `tools/architecture/production-loc.config.json`.

- Command: `npm run audit:loc`
- Verification: `npm run audit:loc:check`
- Head at measurement: `ccc4b472cf0c5e9d33af1885a79461a02fe252bc`
- Source digest: `55921bf9d7642b22b688888679e718cfbb46c96d96ab98b184c4ef87a2060341`
- Tokei: `14.0.0`
- Total: **187,601**
- Historical 180,000–185,000 target: **not met**

## Current buckets

| Bucket | Files | Code lines |
|---|---:|---:|
| Dashboard production | 509 | 83,004 |
| Shared packages | 60 | 9,618 |
| FastAPI application | 231 | 56,638 |
| Rust desktop, watcher, and ritual-db | 84 | 34,960 |
| Desktop hosted-shell bootstrap | 4 | 331 |
| Browser extension | 4 | 1,002 |
| Tinybird authored DSL | 24 | 2,048 |
| **Strict authored production, excluding iOS** | **916** | **187,601** |

## Historical reconciliation

| Claim | Lines | Current delta | Provenance |
|---|---:|---:|---|
| Original architecture audit | 192,474 | −4,873 | Dirty source snapshot documented by RITUAL_VS_BERD_ARCHITECTURE_AUDIT.md |
| Dirty feature-tree results claim | 183,970 | +3,631 | Uncommitted codex/tasks-routines-mvp snapshot; not a ship-branch result |
| Release overview estimate | 192,600 | −4,999 | Manual audit-comparable estimate; replaced by this executable baseline |

The 183.97k number is not a release-branch result and must not be used as proof that the original target was met. The former ~192.6k release value was an undocumented estimate. The original 192,474 count was a valid audit snapshot but described a dirty historical tree. This report supersedes those values for current ship-branch decisions.

The target band is descriptive, not permission to delete working product. If the total remains outside it after evidence-backed dead-code removal and owner consolidation, the architecture documents must report that result honestly.
