# Deploy Habit Pipes via Tinybird UI

**Do NOT run `tb --cloud deploy`.** It would push unrelated resources and could cause drift. Use the Tinybird UI instead (same approach as [DEPLOY_HEART_RATE_UI.md](./DEPLOY_HEART_RATE_UI.md)).

**What we are deploying:**
1. `habit_daily_series` — endpoint (create or update)
2. `habit_daily_values` — endpoint (update)

---

## Before You Start

- Go to: https://cloud.tinybird.co/aws/us-east-1/ritual_/
- Open **Resources** or **Pipes** in the left sidebar
- Do **NOT** edit or overwrite: `weather_observations`, `habit_progress_since_start`, or other unrelated resources

---

## Step 1: Create or Update `habit_daily_series`

1. In Resources/Pipes, find `habit_daily_series` if it exists, or click **+ New resource** → **Endpoint** (or **Pipe**).
2. If creating new: set the name to **`habit_daily_series`**
3. Open the pipe in the code/SQL editor and replace its content with the full definition from `pipes/habit_daily_series.pipe`:

```bash
cat apps/tinybird/pipes/habit_daily_series.pipe
```

4. Paste that content into the Tinybird UI editor.
5. Click **Save** or **Deploy**.

---

## Step 2: Update `habit_daily_values`

1. Find `habit_daily_values` in Resources/Pipes.
2. Open it in the code/SQL editor.
3. Replace its content with the full definition from `pipes/habit_daily_values.pipe`:

```bash
cat apps/tinybird/pipes/habit_daily_values.pipe
```

4. Paste that content into the Tinybird UI editor.
5. Click **Save** or **Deploy**.

---

## Verification

- [ ] `habit_daily_series` exists and has the `habit_id` / `habit_ids` filter support
- [ ] `habit_daily_values` exists and has the `habit_id` / `habit_ids` filter support
- [ ] You did **NOT** overwrite: `weather_observations`, `habit_progress_since_start`, or other unrelated resources

---

## What Changed (Backend + Pipes)

These pipes now support:
- **`habit_id`** — single habit filter
- **`habit_ids`** — comma-separated list of habit IDs (e.g. `habit_ids=id1,id2,id3`)

The backend `watcher_service_computer_activity.py` was also updated so Tinybird reads are read-only by default (no refresh-before-read). Computer-activity endpoints no longer trigger delete-and-reingest on every request.
