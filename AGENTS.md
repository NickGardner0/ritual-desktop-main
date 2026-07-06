# Agent Rules

## Branch And Deploy Target

- Do not create new branches in this repository unless Nick explicitly asks for a new branch by name.
- All agent commits and pushes must target the existing `codex/release-0.1.1-prep` branch.
- Vercel and Railway deploy from `codex/release-0.1.1-prep`; treat it as the canonical working branch for ship-ready changes.
- Before committing, confirm the target branch is `codex/release-0.1.1-prep`. If the active checkout is on another branch, move or apply the intended changes onto `codex/release-0.1.1-prep` before committing.
- Do not push feature, task, experiment, or personal branches unless Nick explicitly requests that exact branch.
