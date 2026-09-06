# Agent Rules

## Branch And Deploy Target

- Do not create new branches in this repository unless Nick explicitly asks for a new branch by name.
- All agent commits and pushes must target the existing `codex/release-0.1.1-prep` branch.
- Vercel and Railway deploy from `codex/release-0.1.1-prep`; treat it as the canonical working branch for ship-ready changes.
- Immediately before every `git commit` and `git push`, run `git branch --show-current` and confirm it prints `codex/release-0.1.1-prep`. If it does not, stop and move or apply the intended changes to the worktree that has the release branch checked out.
- Use `git worktree list` to locate the `codex/release-0.1.1-prep` worktree. Never assume the currently open workspace is the publish target, especially when it is dirty or checked out on a feature/task branch.
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
