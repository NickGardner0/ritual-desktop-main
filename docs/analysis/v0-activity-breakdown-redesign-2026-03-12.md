# v0 Task: Redesign Activity Breakdown To Match Metrics Spark Cards

## Goal
Redesign the `Activity Breakdown` section on the Metrics page so it feels like a natural continuation of the spark-card grid above it, not a separate app or admin panel.

This is a design exploration task. Do not redesign the entire Metrics page. Focus on the `Activity Breakdown` section only.

## Current context
The Metrics page has two different visual personalities:

1. The top section uses dense, compact, Perplexity-style spark cards.
2. The lower `Activity Breakdown` section is much roomier and behaves like a utility/workspace panel.

The result is that the top and bottom of the page feel like they came from different products.

The redesign direction should make the spark cards define the page personality.

## Existing implementation references
- Metrics page container: `apps/dashboard/components/analytics/metrics-view.tsx`
- Activity Breakdown section mount point: `apps/dashboard/components/analytics/metrics-view.tsx`
- Activity Breakdown component: `apps/dashboard/components/computer-activity/ComputerActivityPanel.tsx`
- Existing spark-card style: `apps/dashboard/components/analytics/habit-metric-card.tsx`

## Design direction
Use the current Metrics page design language:
- white cards
- light gray borders
- `rounded-sm`
- compact spacing
- restrained grayscale UI
- red/green trend emphasis only where it matters
- dense information layout
- “scan first, inspect second” behavior

The redesigned `Activity Breakdown` should feel like an analytics cluster built from the same system as the spark cards.

## What should change
Rebuild the current large `Activity Breakdown` panel into a tighter, spark-card-aligned section with this hierarchy:

1. A compact section header
2. A row of compact computer-activity summary cards
3. Two dense ranked cards:
   - `Top Apps`
   - `Top Websites`
4. Optional compact trend/detail card if needed

Avoid the feeling of a giant report container with nested toolbars.

## Specific problems to solve
- The section is too spacious compared with the spark cards above it.
- The large outer panel feels like a different product surface.
- The current “Active time” block feels like a dashboard report tile, not a spark-style metric card.
- The segmented controls dominate too much of the section.
- The ranked lists feel like utility tables instead of dense insight cards.
- The transition from spark cards to Activity Breakdown is abrupt.

## Redesign requirements

### 1. Preserve the current product tone
Do not introduce a radically different visual style.
Do not make it glossy, overly colorful, playful, or startup-generic.
Keep the existing quiet, Perplexity-inspired minimalism.

### 2. Make the section feel denser
The lower section should visually inherit the top grid’s compactness.
Reduce unnecessary whitespace.
Tighten padding and vertical rhythm.

### 3. Reduce “big panel” feeling
The section should feel modular rather than monolithic.
It should read as a cluster of related metric cards, not one giant admin box.

### 4. Keep it readable
Dense does not mean cramped.
Maintain clear hierarchy for:
- section title
- selected source / time range
- primary values
- ranked lists
- secondary metadata

### 5. Preserve the key information
The redesign still needs to support:
- Desktop / iPhone source switching
- time range switching
- primary active-time metric
- top apps ranking
- top websites ranking
- optional detail / drill-down affordance

### 6. Match the spark-card personality
The new section should feel like the answer to:
"What is driving the metrics above?"

Not:
"Now you are entering a separate analysis tool."

## Desired layout direction

Aim for a structure like this:

- `Activity Breakdown` header row
  - compact title
  - small utility actions on the right
  - compact inline segmented controls

- Summary row
  - 3 to 5 compact activity cards that visually rhyme with the habit spark cards
  - examples:
    - Active Time
    - Focus Time
    - Top App
    - Top Website
    - Context Switches

- Breakdown row
  - left card: `Top Apps`
  - right card: `Top Websites`
  - each is dense, ranked, and visually aligned with the Metrics page card system

- Optional detail row
  - only if necessary
  - should still feel card-based and compact

## Wireframe target

Use this as the design target, not a strict implementation:

```text
Activity Breakdown
[Desktop | iPhone]  [6H | 12H | 1D | 7D | 30D | 90D | ALL]                 [Refresh] [Close]

[ Active Time    ][ Focus Time     ][ Top App         ][ Top Website     ]
[ 9.0h   +12.4%  ][ 4.2h   -3.1%   ][ Chrome  5h 28m  ][ x.com   2h 17m  ]
[ tiny sparkline ][ tiny sparkline ][ tiny sparkline  ][ tiny sparkline  ]

[ Top Apps                                                        ][ Top Websites                                                    ]
[ Chrome            5h 28m   small bar / delta                    ][ x.com              2h 17m   small bar / delta                  ]
[ Codex             1h 15m   small bar / delta                    ][ mail.google.com       57m   small bar / delta                  ]
[ Claude              58m    small bar / delta                    ][ app.uselumen.com      47m   small bar / delta                  ]
[ ritual-desktop      35m    small bar / delta                    ][ youtube.com           40m   small bar / delta                  ]
[ ...                                                             ][ ...                                                             ]
```

## Visual guidance

### Use
- same border treatment as the spark cards
- same corner radius language
- similar internal padding logic
- compact uppercase labels where appropriate
- small secondary metadata
- tight grid alignment
- subtle hover states
- strong but restrained type hierarchy

### Avoid
- oversized empty containers
- large isolated stat callouts that break rhythm
- bulky toolbar feeling
- heavy chart chrome
- large list/table spacing
- anything that looks like a settings panel or admin dashboard

## UX guidance
- Default experience should be highly scannable.
- A user should understand “where my time went” within 2 to 3 seconds.
- Lists should be easy to compare horizontally and vertically.
- Controls should feel lightweight and secondary.
- The section should visually bridge from “habit metric signals” to “usage drivers.”

## Deliverable
Produce a high-fidelity React + Tailwind mockup for the redesigned `Activity Breakdown` section only.

The output should include:
- the rebuilt layout
- realistic placeholder values
- the compact summary row
- top apps card
- top websites card
- compact controls
- styling consistent with the current Metrics page spark cards

## Important constraint
This is not a generic SaaS dashboard redesign.
It should feel like it belongs directly beneath the existing Metrics spark-card grid in Ritual.
