# @ritual/ui

The private, framework-light UI package for Ritual applications.

This package owns the shared visual contract:

- semantic CSS variables and light/dark theme values;
- the shared Tailwind preset;
- accessible Radix-based primitives;
- component variants built with `class-variance-authority`;
- class composition through `clsx` and `tailwind-merge`;
- stable component APIs used by product features.

## Usage

Import components through explicit package entry points:

```tsx
import { Button } from "@ritual/ui/button";
import { Card, CardContent } from "@ritual/ui/card";
```

Applications must import `@ritual/ui/globals.css`, include `packages/ui/src` in
their Tailwind content paths, and extend `@ritual/ui/tailwind-config`.

## Ownership rule

General-purpose primitives belong here. Product-specific compositions remain in
their application until they are demonstrably shared. New visual decisions should
be expressed as semantic tokens or component variants instead of feature-local
hex colors and arbitrary values.

The current values preserve Ritual's existing appearance. Paper/v0 is where the
team can deliberately redesign tokens, typography, spacing, radii, and component
variants without changing consumers.

## Design reference

Before changing frontend styling or adding shared primitives, read the repository
root `DESIGN.md`. The standalone `DESIGN.html`, `tokens.json`, `variables.css`, and
`theme.css` form the review and agent/v0 handoff layer. They are intentionally not
production imports until a design-system migration is explicitly approved.
