# Agent Rules

## Branch And Deploy Target

- Do not create new branches in this repository unless Nick explicitly asks for a new branch by name.
- All agent commits and pushes must target the existing `codex/release-0.1.1-prep` branch.
- Vercel and Railway deploy from `codex/release-0.1.1-prep`; treat it as the canonical working branch for ship-ready changes.
- Before committing, confirm the target branch is `codex/release-0.1.1-prep`. If the active checkout is on another branch, move or apply the intended changes onto `codex/release-0.1.1-prep` before committing.
- Do not push feature, task, experiment, or personal branches unless Nick explicitly requests that exact branch.

## Ritual design system

# Ritual agent instructions

For any frontend, component, styling, layout, theme, icon, or interaction work:

1. Read `DESIGN.md` before editing.
2. Treat `packages/ui` as the canonical home for reusable UI primitives.
3. Verify component exports and props in source; never invent `@ritual/ui` APIs.
4. Use semantic tokens and established component variants instead of new reusable raw color values.
5. Keep `tokens.json`, `variables.css`, `theme.css`, `DESIGN.md`, and `DESIGN.html` synchronized when intentionally changing the design contract.
6. The root reference CSS files are not production imports. Do not wire them into the app unless the user explicitly requests adoption.

Feature-specific compositions can remain in their app. Preserve unrelated work in the dirty worktree.
