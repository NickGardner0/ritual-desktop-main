# Deploy Heart-Rate Resources via Tinybird UI (Step-by-Step)

**Do NOT run `tb --cloud deploy`.** It would push unrelated resources (weather_observations, habit_daily_values, habit_progress_since_start) and cause drift. Use the UI instead.

**What we are creating (only these 3):**
1. `heart_rate_1m_rollups` — datasource
2. `heart_rate_summary` — endpoint
3. `heart_rate_series` — endpoint

---

## Before You Start

- Go to: https://cloud.tinybird.co/aws/us-east-1/ritual_/
- Open **Resources** in the left sidebar
- **Do NOT use the "Create new Data Source" modal that shows TypeScript SDK / Python SDK / Tinybird CLI tabs** — close it with X. That modal is the CLI helper, not the schema editor we need.
- Do not edit or overwrite: `habit_daily_values`, `habit_progress_since_start`, `weather_observations`

---

## Step 1: Create the Data Source

1. In Resources, click **+ New resource** (or the green "New resource" button).
2. Choose **Data Source** (not Endpoint, not Connection).
3. If you see options like **Write schema**, **Manual**, **Code editor**, or a schema text area — choose that.
4. If you only see the CLI helper modal (TypeScript/Python/CLI tabs) again, close it and look for another path (e.g. "Create from schema" or "Blank datasource"). If you can't find a schema editor, stop and report back.
5. Set the datasource name to: **`heart_rate_1m_rollups`**
6. Delete any placeholder content and paste exactly this:

```
DESCRIPTION >
    Canonical wearable heart-rate 1-minute rollups derived from WHOOP BLE collectors.
    This is append-only. Queries deduplicate by rollup `id` and latest `created_at`.

SCHEMA >
    `id` String `json:$.id`,
    `user_id` String `json:$.user_id`,
    `bucket_start` DateTime `json:$.bucket_start`,
    `date` Date `json:$.date`,
    `source_type` LowCardinality(String) `json:$.source_type`,
    `sample_count` Int32 `json:$.sample_count`,
    `bpm_avg` Float64 `json:$.bpm_avg`,
    `bpm_min` Int32 `json:$.bpm_min`,
    `bpm_max` Int32 `json:$.bpm_max`,
    `created_at` DateTime `json:$.created_at`

ENGINE "MergeTree"
ENGINE_PARTITION_KEY "toYYYYMM(date)"
ENGINE_SORTING_KEY "user_id, date, bucket_start, source_type"
ENGINE_TTL "date + INTERVAL 2 YEAR"
```

7. Click **Create** or **Save**.
8. **Verify:** The datasource `heart_rate_1m_rollups` appears under Data Sources. Your datasource count should increase by 1.

---

## Step 2: Create the `heart_rate_summary` Endpoint

1. Back in Resources, click **+ New resource**.
2. Choose **Endpoint** (or **Pipe** — in newer UI, Pipes create Endpoints).
3. Choose the **code editor** / **SQL editor** / **pipe editor** option if offered (not the CLI helper).
4. Set the name to: **`heart_rate_summary`**
5. Paste the full pipe definition below. Replace any placeholder content entirely.

```
DESCRIPTION >
    Summary analytics for canonical WHOOP BLE heart-rate rollups.
    Returns weighted period averages and period-over-period change.

TOKEN "heart_rate_summary_read" READ

NODE period_window
SQL >
    %
    SELECT
        {% if defined(start_date) %}
        toDate({{ String(start_date) }})
        {% else %}
        today() - INTERVAL {{ Int32(days_back, 30) }} DAY
        {% end %} AS current_start,
        {% if defined(end_date) %}
        toDate({{ String(end_date) }})
        {% else %}
        today()
        {% end %} AS current_end,
        dateDiff(
            'day',
            {% if defined(start_date) %}
            toDate({{ String(start_date) }})
            {% else %}
            today() - INTERVAL {{ Int32(days_back, 30) }} DAY
            {% end %},
            {% if defined(end_date) %}
            toDate({{ String(end_date) }})
            {% else %}
            today()
            {% end %}
        ) + 1 AS period_days

NODE deduplicated_rollups
DESCRIPTION >
    Keep the latest version of each logical rollup bucket after append-only re-syncs.

SQL >
    %
    SELECT
        id,
        user_id,
        bucket_start,
        date,
        source_type,
        sample_count,
        bpm_avg,
        bpm_min,
        bpm_max,
        created_at
    FROM heart_rate_1m_rollups
    WHERE user_id = {{ String(user_id, required=True) }}
      AND date >= (SELECT addDays(current_start, -period_days) FROM period_window)
      AND date <= (SELECT current_end FROM period_window)
      {% if defined(source_type) %}
      AND source_type = {{ String(source_type) }}
      {% end %}
    ORDER BY id, created_at DESC
    LIMIT 1 BY id

NODE daily_values
SQL >
    %
    SELECT
        date,
        avgWeighted(bpm_avg, sample_count) AS daily_avg_bpm,
        MIN(bpm_min) AS daily_min_bpm,
        MAX(bpm_max) AS daily_max_bpm,
        SUM(sample_count) AS total_samples
    FROM deduplicated_rollups
    GROUP BY date

NODE current_period_summary
SQL >
    %
    SELECT
        AVG(daily_avg_bpm) AS current_avg_bpm,
        MIN(daily_min_bpm) AS min_bpm,
        MAX(daily_max_bpm) AS max_bpm,
        SUM(total_samples) AS total_samples,
        COUNT(*) AS days_with_data,
        MIN(date) AS first_day,
        MAX(date) AS last_day
    FROM daily_values
    WHERE date >= (SELECT current_start FROM period_window)
      AND date <= (SELECT current_end FROM period_window)

NODE previous_period_summary
SQL >
    %
    SELECT
        AVG(daily_avg_bpm) AS previous_avg_bpm,
        COUNT(*) AS previous_days_with_data
    FROM daily_values
    WHERE date >= (SELECT addDays(current_start, -period_days) FROM period_window)
      AND date < (SELECT current_start FROM period_window)

NODE endpoint
TYPE ENDPOINT
SQL >
    %
    SELECT
        c.current_avg_bpm,
        c.min_bpm,
        c.max_bpm,
        c.total_samples,
        c.days_with_data,
        c.first_day,
        c.last_day,
        coalesce(p.previous_avg_bpm, 0) AS previous_avg_bpm,
        coalesce(p.previous_days_with_data, 0) AS previous_days_with_data,
        c.current_avg_bpm - coalesce(p.previous_avg_bpm, 0) AS absolute_change,
        CASE
            WHEN coalesce(p.previous_avg_bpm, 0) > 0
            THEN ((c.current_avg_bpm - p.previous_avg_bpm) / p.previous_avg_bpm) * 100
            WHEN c.current_avg_bpm > 0
            THEN 100.0
            ELSE 0.0
        END AS change_pct
    FROM current_period_summary c
    CROSS JOIN previous_period_summary p
```

6. Click **Create** or **Save**.
7. **Verify:** `heart_rate_summary` appears under **Endpoints** (not under a separate "Pipes" section if the UI distinguishes). Endpoint count should increase by 1.

---

## Step 3: Create the `heart_rate_series` Endpoint

1. Click **+ New resource** again.
2. Choose **Endpoint** (or **Pipe**).
3. Choose the code/SQL/pipe editor.
4. Set the name to: **`heart_rate_series`**
5. Paste this full pipe definition:

```
DESCRIPTION >
    Bucketed heart-rate time series derived from canonical 1-minute rollups.
    Supports `bucket=1m`, `bucket=hour`, and `bucket=day`.

TOKEN "heart_rate_series_read" READ

NODE period_window
SQL >
    %
    SELECT
        {% if defined(start_date) %}
        toDate({{ String(start_date) }})
        {% else %}
        today() - INTERVAL {{ Int32(days_back, 30) }} DAY
        {% end %} AS current_start,
        {% if defined(end_date) %}
        toDate({{ String(end_date) }})
        {% else %}
        today()
        {% end %} AS current_end

NODE deduplicated_rollups
SQL >
    %
    SELECT
        id,
        bucket_start,
        date,
        source_type,
        sample_count,
        bpm_avg,
        bpm_min,
        bpm_max,
        created_at
    FROM heart_rate_1m_rollups
    WHERE user_id = {{ String(user_id, required=True) }}
      AND date >= (SELECT current_start FROM period_window)
      AND date <= (SELECT current_end FROM period_window)
      {% if defined(source_type) %}
      AND source_type = {{ String(source_type) }}
      {% end %}
    ORDER BY id, created_at DESC
    LIMIT 1 BY id

NODE bucketed_series
SQL >
    %
    {% if String(bucket, 'day') == '1m' %}
    SELECT
        bucket_start,
        avgWeighted(bpm_avg, sample_count) AS bpm_avg,
        MIN(bpm_min) AS bpm_min,
        MAX(bpm_max) AS bpm_max,
        SUM(sample_count) AS sample_count
    FROM deduplicated_rollups
    GROUP BY bucket_start
    ORDER BY bucket_start ASC
    {% elif String(bucket, 'day') == 'hour' %}
    SELECT
        toStartOfHour(MIN(bucket_start)) AS bucket_start,
        avgWeighted(bpm_avg, sample_count) AS bpm_avg,
        MIN(bpm_min) AS bpm_min,
        MAX(bpm_max) AS bpm_max,
        SUM(sample_count) AS sample_count
    FROM deduplicated_rollups
    GROUP BY toStartOfHour(bucket_start)
    ORDER BY bucket_start ASC
    {% else %}
    SELECT
        toStartOfDay(MIN(bucket_start)) AS bucket_start,
        avgWeighted(bpm_avg, sample_count) AS bpm_avg,
        MIN(bpm_min) AS bpm_min,
        MAX(bpm_max) AS bpm_max,
        SUM(sample_count) AS sample_count
    FROM deduplicated_rollups
    GROUP BY toStartOfDay(bucket_start)
    ORDER BY bucket_start ASC
    {% end %}

NODE endpoint
TYPE ENDPOINT
SQL >
    %
    SELECT
        bucket_start,
        bpm_avg,
        bpm_min,
        bpm_max,
        sample_count
    FROM bucketed_series
```

6. Click **Create** or **Save**.
7. **Verify:** `heart_rate_series` appears under Endpoints.

---

## Final Checks

- [ ] `heart_rate_1m_rollups` exists under Data Sources
- [ ] `heart_rate_summary` exists under Endpoints
- [ ] `heart_rate_series` exists under Endpoints
- [ ] You did **NOT** edit: `habit_daily_values`, `habit_progress_since_start`, `weather_observations`

---

## After All 3 Exist: Run the Backfill

```bash
cd /Users/nickgardner/Desktop/ritual-desktop-main/apps/backend
python3 scripts/resync_heart_rate_rollups_to_tinybird.py
```

This syncs heart-rate rollups from Turso to Tinybird.  
**Note:** The Turso table `heart_rate_1m_rollups` must exist. If the script errors with "no such table", run the Turso migration first.

---

## If the UI Looks Different

- Some Tinybird workspaces use **Datafiles** or **Pipes** as the main resource type. A "Pipe" that ends with `NODE endpoint TYPE ENDPOINT` becomes an HTTP endpoint.
- If the UI asks for "Materialized" vs "Streaming" or similar, choose the option that creates an HTTP-queryable pipe.
- If you cannot find a schema/pipe code editor and only see the CLI helper, take a screenshot and report back — the workspace UI may need a different entry point.
