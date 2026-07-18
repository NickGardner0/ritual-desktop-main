# Ritual — Design System Reference

> A calm, compact personal operating system: warm paper surfaces, graphite text, native desktop restraint, and color used only when it carries meaning.

- **Status:** active production contract
- **Version:** `0.2.0`
- **Themes:** light and dark
- **Primary platform:** macOS desktop, with responsive web surfaces
**Visual reference:** open [`DESIGN.html`](./DESIGN.html) in a browser

## Read this first

This document is the design contract for agents and designers working on Ritual. It describes the intended system boundary, verified component APIs, semantic tokens, and composition rules.

The production-compatible contract lives in `packages/ui/src/globals.css` and is consumed by the dashboard. The root-level `variables.css`, `theme.css`, and `tokens.json` mirror that contract for Paper/v0 and agent workflows; they remain standalone and must not be imported into the dashboard.

When implementation and this document conflict:

1. Existing production behavior wins for consumers that have not deliberately migrated to a verified shared API.
2. Verified `@ritual/ui` component APIs win over invented APIs.
3. Update this document and the visual reference in the same change whenever the design contract changes.

## System architecture

Ritual follows the same practical architecture as mature Shadcn-derived systems:

- `@ritual/ui` is the private monorepo package for shared primitives.
- Radix UI supplies accessible behavior and state machines.
- Tailwind CSS supplies utility styling.
- CSS custom properties carry semantic theme values.
- `class-variance-authority` defines typed variants.
- `clsx` and `tailwind-merge` power the shared `cn()` helper.
- Product-specific compositions remain in the consuming app until they are genuinely reusable.

Canonical source locations:

| Source | Purpose |
|---|---|
| `packages/ui` | Installable private component package |
| `packages/ui/src/components` | Verified shared primitives |
| `packages/ui/src/globals.css` | Current production-compatible semantic contract |
| `packages/ui/tailwind.config.cjs` | Current Tailwind v3 preset |
| `tokens.json` | Framework-neutral machine-readable token source |
| `variables.css` | Framework-neutral CSS variable reference |
| `theme.css` | Tailwind v4/v0 adapter |
| `DESIGN.html` | Standalone visual review surface |

## Design character

Ritual should feel like a quiet desktop instrument, not a generic SaaS dashboard. The interface is compact, stable, and content-forward. Warm whites prevent the application from feeling clinical; graphite text avoids harsh pure black; translucent chrome supports the macOS shell without turning every surface into glass.

The visual hierarchy should come from spacing, text tone, and surface level before shadow, weight, or color. Floating controls borrow Cursor’s precise menu-card language: clean white surfaces, visible hairline borders, generous outer rounding, compact rounded rows, full-width dividers, and restrained elevation. Chromatic colors are functional punctuation: teal for focus and information, green for success, amber for warning, and red for destructive states.

### Principles

1. **Quiet by default.** Most screens should be neutral. Color earns attention by communicating state or action.
2. **Compact, never cramped.** Rows and controls are short, but groups retain clear 8–16px rhythm.
3. **Semantic before literal.** Use `surface-panel`, not “gray 100”; use `status-danger`, not an arbitrary red.
4. **Native where it helps.** Desktop chrome may use system typography, vibrancy, and platform conventions.
5. **Stable interaction.** Avoid layout shifts, ornamental motion, and hover effects that move content.
6. **One shared primitive.** Do not create a second general-purpose Button, Input, Card, Select, Tabs, Label, Badge, or Separator outside `@ritual/ui`.

## Color

### Light theme

| Role | Token | Value | Use |
|---|---|---:|---|
| Canvas | `--ritual-surface-canvas` | `#fefefe` | Application background |
| Raised | `--ritual-surface-raised` | `#ffffff` | Menus, cards requiring separation |
| Panel | `--ritual-surface-panel` | `#f4f4f3` | Grouped settings and secondary regions |
| Recessed | `--ritual-surface-recessed` | `#f7f8f5` | Wells, empty regions, subtle editors |
| Primary text | `--ritual-text-primary` | `#111111` | Titles, values, primary body copy |
| Secondary text | `--ritual-text-secondary` | `#666666` | Descriptions and supporting copy |
| Muted text | `--ritual-text-muted` | `#7a7a7a` | Metadata and low-priority labels |
| Default border | `--ritual-border-default` | `#dad9d7` | Inputs and explicit separators |
| Subtle border | `--ritual-border-subtle` | `rgba(15,23,42,.052)` | Hairlines and chrome edges |
| Primary action | `--ritual-interactive-primary` | `#27251e` | Highest-priority filled action |
| Brand action | `--ritual-brand-action` | `#000000` | Landing-aligned black CTA; hover is `#3d3c38` |
| Focus / info | `--ritual-focus-ring` | `#306774` | Keyboard focus and informational emphasis |

### Status colors

| Meaning | Light | Dark | Rule |
|---|---:|---:|---|
| Information | `#306774` | `#72a8b4` | Neutral information and focus |
| Success | `#167046` | `#55a67c` | Completed, connected, healthy |
| Warning | `#b45309` | `#d49a56` | Needs attention; not yet destructive |
| Danger | `#9f2d20` | `#d97368` | Errors, deletion, irreversible actions |

Never use status colors as decoration. Do not rely on color alone; pair state with text, iconography, or both.

## Typography

### Families

- **FK Grotesk Neue** — default product UI, navigation, forms, tables, and headings.
- **System UI** — native titlebar and platform-level chrome where matching macOS matters more than brand voice.
- **SF Mono fallback stack** — code, identifiers, file paths, timestamps where fixed-width alignment materially helps.

Settings may also offer selectable UI fonts (GT Standard, GT America, Waldenburg, Inter, DM Sans, Geist Sans). Do not introduce another default product font family without updating `tokens.json`, `variables.css`, this document, and the visual reference.

### Type scale

| Role | Size | Weight | Line height | Use |
|---|---:|---:|---:|---|
| Caption | 11px | 400 | 1.35 | Secondary metadata only |
| Label | 12px | 500 | 1.35 | Field labels, compact headings |
| Body small | 13px | 400 | 1.45 | Dense rows, menus, secondary UI |
| Body | 14px | 400 | 1.50 | Default product copy |
| Title small | 16px | 500 | 1.35 | Cards, panels, dialogs |
| Title | 20px | 500 | 1.25 | Page section titles |
| Heading | 24px | 500 | 1.20 | Primary page heading |
| Display | 32px | 500 | 1.12 | Rare onboarding or empty-state emphasis |

Use weight 500 for hierarchy before reaching for 600. Body copy remains 400. Avoid 700+ in product UI.

## Spacing and density

The base unit is **4px**. Prefer the named 4px scale: `4, 8, 12, 16, 20, 24, 32, 40, 48, 64`.

- Related icon and label: 6–8px gap.
- Controls within one field: 8px gap.
- Rows inside menus: 0–2px gap; groups use a full-width hairline divider.
- Rows within non-menu groups: 4–8px gap or a hairline divider.
- Field groups: 16px gap.
- Panel padding: 16–24px.
- Major page regions: 24–32px.
- Default sidebar row height: 30px.
- Default button and select height: 36px; compact controls: 28px.
- Compact grouped form rows: 40–44px; use 44px when rows contain mixed controls.
- Compact card padding: 16px. Supporting copy is normally 13–14px.

Do not invent 13px, 17px, or 23px layout gaps when a scale value communicates the same hierarchy.

## Shape and elevation

| Role | Radius | Guidance |
|---|---:|---|
| Compact control | 8px | Desktop toolbar, fields, and dense controls |
| Row / small tile | 8px | Navigation and menu hover rows |
| Card | 12px | General grouped content |
| Floating menu | 14px | Dropdowns, selects, popovers, and command menus |
| Dialog | 18px | Modal and prominent floating surfaces |
| Full | 9999px | Status dots, avatars, tags only—not ordinary buttons |

Surfaces are mostly flat. Use a border or a one-step surface change before adding shadow. Popover and dialog shadows are reserved for content that actually floats above the application. A floating surface always uses `surface-floating`, `border-floating`, the matching floating radius, and the shared elevation token as a set—do not recreate only part of the recipe locally.

### Floating cards and menus

The shared Cursor-inspired contract is implemented by `@ritual/ui/menu` and the semantic variables in `@ritual/ui/globals.css`.

- Surface: `--surface-floating` / `--ritual-surface-floating`.
- Border: `--border-floating` / `--ritual-border-floating`.
- Radius: `--radius-floating` (14px); dialogs use `--radius-dialog` (18px).
- Elevation: `--shadow-popover`; dialogs use `--shadow-dialog`.
- Menu inset: 6px, with 32px rows and 10px horizontal row padding.
- Row hover and keyboard highlight: `--row-hover`, applied instantly with no transition.
- Dividers extend through the menu inset and use `--divider-subtle`.
- Supporting metadata is regular-weight muted text, not a smaller competing button style.

Radix Dropdown, Popover, Select, Dialog, and command-menu wrappers must consume `menuSurfaceVariants()` and `menuRowVariants()` or the corresponding shared presentation components. Feature code must not redefine the floating border, radius, shadow, or row hover.

## Motion

- Fast feedback: 100ms.
- Normal state transition: 160ms.
- Deliberate entrance/exit: 240ms maximum.
- Standard easing: `cubic-bezier(0.2, 0, 0, 1)`.
- Never animate routine row hover, table selection, or frequently repeated navigation feedback.
- Respect `prefers-reduced-motion` and remove nonessential animation.

## Verified shared components

Only the APIs below are currently guaranteed by `@ritual/ui`. Agents must not invent package exports or props that cannot be verified in source.

### Button

```tsx
import { Button } from "@ritual/ui/button";

<Button variant="default" size="default">Save changes</Button>
<Button variant="brand" size="compact">New routine</Button>
<Button variant="outline" size="compact">Set up</Button>
<Button variant="outline" size="sm">Cancel</Button>
<Button variant="ghost" size="icon-compact" aria-label="More options">…</Button>
```

Variants: `default`, `brand`, `destructive`, `outline`, `secondary`, `ghost`, `link`.

`brand` reproduces Ritual’s landing-page CTA: black with white text in light mode and `#3d3c38` on hover, with a 200ms color transition. Use it for the small number of product actions that intentionally match that brand treatment.

Sizes: `default` (36px), `sm` (32px), `compact` (28px), `lg` (40px), `icon` (36px), `icon-compact` (28px).
Use one primary action per local action group. Destructive styling is for an action that causes harm, not for every warning message.

### Input

```tsx
import { Input } from "@ritual/ui/input";

<Input type="text" placeholder="Routine name" aria-label="Routine name" />
<Input density="compact" placeholder="Routine name" aria-label="Routine name" />
```

Always provide a visible `Label` or an accessible name. Error text belongs adjacent to the field and must not be conveyed only by border color.
The default density remains 40px for backward compatibility. Use `density="compact"` for the 36px desktop form pattern; do not shrink every existing form globally.

### Label

```tsx
import { Label } from "@ritual/ui/label";

<Label htmlFor="routine-name">Routine name</Label>
```

### Card

```tsx
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@ritual/ui/card";

<Card density="compact">
  <CardHeader><CardTitle>Weekly review</CardTitle></CardHeader>
  <CardContent>Compact cards use 16px padding.</CardContent>
</Card>
```

Cards group related information. Do not wrap every page section in a card; the content canvas can provide structure on its own. Dense library cards may use a 14px regular-weight title when color and spacing already provide hierarchy.
The default density preserves existing 24px spacing. `density="compact"` opts a composition into 16px spacing, smaller supporting type, and a flat surface.

### Menu surface

```tsx
import { MenuList, MenuRow, MenuSeparator, MenuSurface } from "@ritual/ui/menu";

<MenuSurface>
  <MenuList>
    <MenuRow>Refresh changes</MenuRow>
    <MenuSeparator />
    <MenuRow>Collapse all</MenuRow>
  </MenuList>
</MenuSurface>
```

`MenuSurface`, `MenuList`, and `MenuRow` provide the visual contract. Use Radix primitives for menu behavior and consume the exported `menuSurfaceVariants` / `menuRowVariants` helpers from those wrappers.

### Select

```tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ritual/ui/select";

<Select defaultValue="daily">
  <SelectTrigger density="compact" aria-label="Trigger frequency">
    <SelectValue />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="daily">Daily</SelectItem>
    <SelectItem value="weekly">Weekly</SelectItem>
  </SelectContent>
</Select>
```

Select is Radix-based and owns keyboard navigation, focus management, and popover positioning. Use its items instead of native `<select>` when the menu must match Ritual styling. Trigger densities are `default` (36px) and `compact` (28px).

### Tabs

```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@ritual/ui/tabs";

<Tabs defaultValue="suggested">
  <TabsList variant="underline">
    <TabsTrigger value="suggested">Suggested</TabsTrigger>
    <TabsTrigger value="calendar">Calendar</TabsTrigger>
  </TabsList>
  <TabsContent value="suggested">…</TabsContent>
</Tabs>
```

Variants: `underline` (default) and `segmented`. Use underline tabs for content categories and libraries; segmented tabs are for compact, mutually exclusive modes. Underline labels use regular-weight primary neutral text in every state—selection is communicated by the underline, not a blue-grey inactive color.

### Badge

```tsx
import { Badge } from "@ritual/ui/badge";

<Badge variant="secondary">Draft</Badge>
```

Variants: `default`, `secondary`, `destructive`, `outline`. Badges are short state labels, not action buttons.

### Separator

```tsx
import { Separator } from "@ritual/ui/separator";

<Separator orientation="horizontal" />
```

Use spacing instead of a separator when grouping is already clear.

### Class composition

```tsx
import { cn } from "@ritual/ui/cn";
```

Use `cn()` for conditional classes. Do not concatenate dynamic Tailwind classes that cannot be statically discovered.

## Composition patterns

### Application shell

- Native/translucent titlebar at 36px.
- Compact sidebar with 30px rows.
- Content canvas stays opaque and visually quiet.
- Selected navigation uses a subtle neutral fill before chromatic color.

### Settings panel

- Use one grouped panel for a coherent category.
- Rows align label/description left and control right.
- Keep row heights consistent within a group.
- Separate irreversible actions into a clearly named danger region.

### Data-dense list

- Keep baseline alignment exact.
- Use tabular numerals when comparisons matter.
- Hover changes background only; do not translate or scale rows.
- Preserve keyboard focus independent of hover.

### Menu card

- Keep the card content inset at 6px.
- Use 32px rows with 8px row radii and no hover animation.
- Align labels, muted metadata, checks, chevrons, and shortcuts on one baseline.
- Use separators between conceptual groups, not between every item.
- Search fields may sit flush at the top, separated from results by a hairline.

### Empty state

- State what is missing in plain language.
- Explain why the first action is useful.
- Offer one primary next step, optionally one quiet secondary action.
- Do not fill the space with decorative illustration by default.

## Icons

Use the established icon path for the surface being changed. General-purpose new UI should prefer the package’s eventual centralized icon layer; until one exists, do not mix icon families inside a single feature.

- Default icon color: `--ritual-icon-default`.
- Muted icon color: `--ritual-icon-muted`.
- Default product icon size: 16px; sidebar icons may use 18px.
- Match stroke width and optical size within an action group.
- Every icon-only action requires an accessible label and usually a tooltip.

## Accessibility contract

- All interactive controls must be keyboard reachable.
- Visible focus uses `--ritual-focus-ring` and must remain distinguishable in both themes.
- Text and meaningful icons should meet WCAG AA contrast.
- Touch targets should be at least 44×44px on touch-first surfaces; compact desktop controls may be visually smaller while retaining an adequate hit area.
- Do not remove focus outlines without providing an equally visible replacement.
- Respect reduced motion, increased contrast, and text scaling.
- Dialogs, menus, tooltips, labels, switches, and composite widgets should use Radix primitives when available.

## Do

- Import verified primitives from `@ritual/ui/*` in new shared code.
- Use semantic variables and component variants instead of raw colors.
- Keep new interfaces compact and aligned to the 4px scale.
- Use neutral hierarchy first and chromatic color second.
- Test light and dark modes, keyboard navigation, empty states, loading, errors, and long content.
- Update `DESIGN.html` when a token or component visual contract changes.

## Don’t

- Do not import `variables.css` or `theme.css` into the production app without explicit approval; they are reference artifacts today.
- Do not copy a Shadcn component into a feature directory when an `@ritual/ui` primitive exists.
- Do not invent `@ritual/ui` exports, variants, or props.
- Do not add feature-local hex colors for reusable concepts.
- Do not use color as the only indication of state.
- Do not use gradients, glows, oversized shadows, or springy motion as default decoration.
- Do not turn every surface into glass; vibrancy belongs primarily to native chrome.
- Do not introduce a new visual system from an unrelated reference without reconciling it here.

## Instructions for agents and v0

Treat this repository as both the design-system source and a real consuming application, as recommended by [v0 Design Systems 2.0](https://v0.app/docs/design-systems-2).

When generating Ritual UI:

1. Read this file first.
2. Inspect `packages/ui/package.json` and the exact component source before using an export.
3. Use `tokens.json` for machine-readable values and `variables.css` for framework-neutral CSS.
4. In a Tailwind v4/v0 starter, load `variables.css` before `theme.css`.
5. In the existing Ritual dashboard, continue using its established `@ritual/ui` Tailwind v3 integration; do not install a second component library.
6. If a required shared primitive does not exist, add it to `@ritual/ui` with Radix behavior, CVA variants, typed props, documentation, and a visual example.
7. Keep feature-specific compositions in the app until reuse is demonstrated.
8. Never claim an unverified component or token exists.

Suggested v0 import sources:

- GitHub repository containing Ritual.
- `packages/ui` as the installable design-system source.
- `apps/dashboard` as the real consumer.
- `DESIGN.md`, `DESIGN.html`, `tokens.json`, `variables.css`, and `theme.css` as guidelines and attachments.

During v0’s starter review, verify component imports, token wiring, font loading, light/dark behavior, keyboard focus, and that the starter did not fall back to unrelated default Shadcn styling. v0’s documentation emphasizes that the saved starter becomes the foundation for future chats, so do not approve a visually or technically inaccurate starter.

## Governance

A design-system change is complete only when applicable layers agree:

- Machine source: `tokens.json`
- CSS reference: `variables.css`
- Tailwind/v0 adapter: `theme.css`
- Written guidance: `DESIGN.md`
- Visual evidence: `DESIGN.html`
- Production implementation: `packages/ui` only when adoption is explicitly approved

Record intentional breaking component changes in `packages/ui/README.md`. Prefer additive migrations and compatibility exports over large import rewrites.

## Quick reference

```css
/* Surfaces */
var(--ritual-surface-canvas)
var(--ritual-surface-raised)
var(--ritual-surface-floating)
var(--ritual-surface-panel)
var(--ritual-surface-recessed)

/* Content */
var(--ritual-text-primary)
var(--ritual-text-secondary)
var(--ritual-text-muted)
var(--ritual-icon-default)

/* Interaction */
var(--ritual-interactive-primary)
var(--ritual-interactive-hover)
var(--ritual-interactive-selected)
var(--ritual-focus-ring)
var(--ritual-border-floating)
var(--ritual-divider-subtle)
var(--ritual-radius-floating)
var(--ritual-shadow-popover)

/* Status */
var(--ritual-status-info)
var(--ritual-status-success)
var(--ritual-status-warning)
var(--ritual-status-danger)
```

This production-aligned contract codifies Ritual’s current direction without declaring the visual design finished. Future Paper/v0 exploration should revise this contract and the production-ready `@ritual/ui` APIs together.
