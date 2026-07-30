# Appearance port notes

Ritual ports Buzz’s Appearance UX + Shiki-derived theme engine under
`apps/dashboard/lib/theme/` and `components/appearance/`.

## Coexistence with chrome materials

- **Theme engine** owns semantic shadcn CSS variables (`--background`,
  `--foreground`, `--primary`, sidebar content tokens, etc.) and the
  `light` / `dark` class on `<html>`.
- **Chrome appearance** (`ChromeAppearanceContext`: frosted / white / soft /
  zed) continues to own `--sidebar-vibrancy-*` and `--titlebar-glass-*`.
- Non-Ritual palettes may look less on-brand with frosted glass; both
  controls remain available.

## Brand themes

`ritual` / `ritual-dark` are first-party aliases (Buzz’s `buzz` / `buzz-dark`
role). They use Ritual’s current light/dark token intent, pin a neutral
accent, and set `data-ritual-theme` on the document root.

## Attribution

See `apps/dashboard/lib/theme/NOTICE` (Apache-2.0, Block Buzz).
