# Ritual agent instructions

For any frontend, component, styling, layout, theme, icon, or interaction work:

1. Read `DESIGN.md` before editing.
2. Treat `packages/ui` as the canonical home for reusable UI primitives.
3. Verify component exports and props in source; never invent `@ritual/ui` APIs.
4. Use semantic tokens and established component variants instead of new reusable raw color values.
5. Keep `tokens.json`, `variables.css`, `theme.css`, `DESIGN.md`, and `DESIGN.html` synchronized when intentionally changing the design contract.
6. The root reference CSS files are not production imports. Do not wire them into the app unless the user explicitly requests adoption.

Feature-specific compositions can remain in their app. Preserve unrelated work in the dirty worktree.
