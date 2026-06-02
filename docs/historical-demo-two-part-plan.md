# Historical Demo Plan

## Recommended Structure

Use a **two-part demo** instead of trying to pretend one local day contains every capture mode.

That is the honest and strongest setup with the data currently preserved on disk.

## Part 1: Old Recorder OCR Demo

Use **2026-02-27** from the recorder-era backup DB.

Why this day wins over `2026-03-02`:

- more OCR frames: `14,444` vs `9,618`
- more OCR text: `26,980,732` chars vs `14,545,862`
- broader app mix
- still strong coding/product evidence

High-signal app mix on `2026-02-27`:

- `Google Chrome`
- `ritual-desktop`
- `Codex`
- `Figma`
- `Cursor`
- `ChatGPT`

This day is best for showing:

- dense OCR capture
- coding and product-building evidence
- long-form textual retrieval

Important caveat:

- this day also contains some potentially personal/sensitive OCR content from `Preview` and other non-product windows
- for an internal demo that is fine if you control the queries
- for a public-facing beta recording, you may want the safer fallback below

### Public-Safe OCR Fallback

Use **2026-03-02** if you want a cleaner, more product-focused OCR day.

Why it is safer:

- still strong OCR density: `9,618` frames and `14,545,862` OCR chars
- heavily concentrated in `Google Chrome`, `Codex`, `ritual-desktop`, and `Cursor`
- less mixed with non-product/personal document content than `2026-02-27`

Use `2026-03-02` if the recording should feel more like:

- building Ritual
- coding in Cursor/Codex
- reviewing frontend/product changes

Use it for questions like:

1. `What product or engineering work was I doing on February 27, 2026?`
2. `Was I working on Ritual frontend or dashboard code on February 27?`
3. `What tools was I using most on February 27?`
4. `Was I working in Figma, Cursor, Codex, or the Ritual app that day?`

## Part 2: Browser + Accessibility Demo

Use **2026-03-19** from the newer snapshot DB.

Why this day is the best complement:

- `2039` snapshots
- `593` retrieval docs
- `1467` `macos_accessibility_deep`
- `508` `browser_extension`

This day is best for showing:

- browser-driven retrieval
- accessibility-based app context
- more "Littlebird-like" cross-app narrative retrieval

Use it for questions like:

1. `What did I research about Littlebird on March 19, 2026?`
2. `Did I do resume or job application work on March 19?`
3. `What ideas did I explore for Ritual's Metrics page on March 19?`
4. `Which sites and apps dominated my work on March 19?`

## Best Practical Demo Order

1. Start with **2026-02-27**.
   Show that Ritual can retrieve rich OCR-heavy engineering/product context.
2. Then switch to **2026-03-19**.
   Show that Ritual can retrieve broader browser/accessibility context across multiple tools and sites.

This sequence works better than the reverse order because:

- the OCR day establishes raw evidence richness first
- the March 19 day then establishes cross-app retrieval breadth

## Exported Corpus Locations

Recorder-era OCR export:

- `tmp/historical-ocr-demo-2026-02-27`

Public-safe OCR fallback export:

- `tmp/historical-ocr-demo-2026-03-02`

Browser/accessibility export:

- `tmp/historical-demo-2026-03-19`

## Demo Framing

Say this clearly during the recording:

- this is a **historical demo corpus**
- the corpus is drawn from **known-good captured days**
- the purpose is to demonstrate **retrieval quality**, not to claim that the current live watcher produced all of this data today

## If You Want One "Stitched" Story

Treat the stitched story as:

- **February 27, 2026** = OCR-heavy engineering/product work
- **March 19, 2026** = browser/accessibility-rich research and planning

Do not merge them into a fake single date in the UI. Keep the date context visible so the demo stays truthful.
