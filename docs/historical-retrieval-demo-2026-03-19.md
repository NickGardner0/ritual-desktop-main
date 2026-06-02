# Historical Retrieval Demo: 2026-03-19

## Recommended Demo Day

Use **2026-03-19** as the primary "golden day" for a retrieval demo.

Why this day:

- `context_snapshots`: `2039`
- `session_retrieval_docs`: `593`
- `session_retrieval_docs.contextual_retrieval_text` chars: `447,969`
- source mix:
  - `macos_accessibility_deep`: `1467`
  - `browser_extension`: `508`
  - `window_metadata_fallback`: `64`

This is the best day in the current local DB for a "rich output" demo because it combines:

- browser extension capture
- deep accessibility capture
- long-form retrieval docs
- several distinct, easy-to-explain themes

## Main Storylines Captured That Day

### 1. Resume / Tailscale / Teal workflow

The morning is dense with rich Teal + ChatGPT + Tailscale material:

- `app.tealhq.com`
- `chatgpt.com`
- `job-boards.greenhouse.io`
- `linkedin.com`

Example captured content includes:

- "Resume Advice for Tailscale"
- "Product Growth Engineer Remote (United States) About Tailscale"
- Teal resume builder content describing Ritual as a local-first behavioral data platform

### 2. Littlebird / context-awareness research

The same day also includes explicit Littlebird-related research:

- `support.littlebird.ai`
- `cloud.tinybird.co`

Example captured content includes:

- "Littlebird's context awareness"
- "Littlebird Help Center"

### 3. Metrics page / product design exploration

The evening includes product/design exploration that demos well:

- `perplexity.ai`
- `reddit.com`
- `openalternative.co`
- `mail.google.com`

Example captured content includes:

- "Can you help me design/add new features and functionality to my 'Metrics' page for my self-tracking app?"
- Quantified Self / personal-tracking discussions on Reddit

## Backup Demo Day

If you want a more engineering/product-build flavored backup day, use **2026-03-24**.

Why it is a good backup:

- stronger Cursor-heavy coding footprint
- stronger release/build/configuration narrative
- less "resume workflow" and more "product implementation"

Use `2026-03-24` if you want the demo to look more like:

- "What was I shipping?"
- "What config/release work was I doing?"
- "What UI/icon/dashboard work was I exploring?"

## Best On-Camera Query Set

Use queries that anchor to the date and a concrete theme. That makes the retrieval look intentional and reduces noise from more recent data.

Recommended query set for **2026-03-19**:

1. "What was I working on the morning of March 19, 2026?"
2. "Was I doing resume or job application work on March 19?"
3. "What did I research about Littlebird or context awareness on March 19?"
4. "What ideas did I explore for Ritual's Metrics page on March 19?"
5. "Which apps and websites were most involved in my work on March 19?"
6. "What was I doing in the evening on March 19 around 8 PM to 9 PM?"

If you want shorter, punchier queries for a recording:

1. "March 19 resume work"
2. "March 19 Littlebird research"
3. "March 19 Metrics page ideas"
4. "March 19 evening product research"

## Demo Framing

For a clean beta demo, say this explicitly:

- this is **historical captured data**
- the retrieval is running over a **known-good day**
- the goal is to show **answer quality and evidence richness**

Do **not** imply that the current live watcher generated this exact historical corpus if it did not.

## Export Helper

Use the export script at:

- `scripts/export-historical-demo-day.sh`

Example:

```bash
cd /Users/nickgardner/Desktop/ritual-desktop-main
bash scripts/export-historical-demo-day.sh 2026-03-19
```

This creates a folder under:

- `tmp/historical-demo-2026-03-19`

with:

- `overview.txt`
- `top_apps.tsv`
- `top_domains.tsv`
- `source_type_counts.tsv`
- `session_retrieval_docs.json`
- `context_snapshots.json`

## Best Practical Recommendation

For your screen recording:

- use **2026-03-19** as the primary demo day
- use the exported corpus as your reference material
- run 3 to 5 prepared queries from the list above
- keep the answers framed as historical retrieval, not live capture

That will get you much closer to the "rich output like Littlebird" look than trying to force the current unstable live watcher path into the demo.
