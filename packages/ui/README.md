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
import { Input } from "@ritual/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ritual/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@ritual/ui/tabs";
```

Density is opt-in for existing form and card consumers. Buttons use the compact
desktop contract by default: 36px for `default`, 32px for `sm`, and 28px for
`compact`.

```tsx
<Button size="compact">Set up</Button>
<Button variant="brand" size="compact">New routine</Button>
<Input density="compact" aria-label="Routine name" />
<Card density="compact"><CardContent>Dense content</CardContent></Card>

<Select defaultValue="daily">
  <SelectTrigger density="compact"><SelectValue /></SelectTrigger>
  <SelectContent><SelectItem value="daily">Daily</SelectItem></SelectContent>
</Select>

<Tabs defaultValue="suggested">
  <TabsList variant="underline">
    <TabsTrigger value="suggested">Suggested</TabsTrigger>
  </TabsList>
</Tabs>
```

The `brand` button variant matches the landing-page CTA: black at rest,
`#3d3c38` on hover, and the corresponding warm inverse treatment in dark mode.

Applications must import `@ritual/ui/globals.css`, include `packages/ui/src` in
their Tailwind content paths, and extend `@ritual/ui/tailwind-config`.

## Ownership rule

General-purpose primitives belong here. Product-specific compositions remain in
their application until they are demonstrably shared. New visual decisions should
be expressed as semantic tokens or component variants instead of feature-local
hex colors and arbitrary values.

Existing Input and Card consumers preserve their current density until they opt
in. Button's shared default follows the 36px desktop contract, and new Select and
Tabs consumers inherit the documented Ritual menu and category patterns.

## Design reference

Before changing frontend styling or adding shared primitives, read the repository
root `DESIGN.md`. The standalone `DESIGN.html`, `tokens.json`, `variables.css`, and
`theme.css` form the review and agent/v0 handoff layer. They are intentionally not
production imports until a design-system migration is explicitly approved.
