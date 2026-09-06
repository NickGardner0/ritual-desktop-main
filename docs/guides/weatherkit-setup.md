# WeatherKit Setup (FastAPI)

This guide configures the server-side WeatherKit integration used by Ritual's Weather integration.

## 1) Apple Developer Setup

1. Open Apple Developer and create a **WeatherKit key**.
2. Record:
   - **Team ID**
   - **Key ID**
   - **Service ID** (identifier used as JWT subject)
3. Download the private key (`.p8`). Keep it server-side only.

## 2) Backend Environment Variables

Set these in `/Users/nickgardner/Desktop/ritual-desktop-main/apps/backend/.env`:

- `WEATHERKIT_TEAM_ID`
- `WEATHERKIT_KEY_ID`
- `WEATHERKIT_SERVICE_ID`
- `WEATHERKIT_PRIVATE_KEY_P8`

`WEATHERKIT_PRIVATE_KEY_P8` supports either:
- Full PEM text (escaped newlines `\n`), or
- Absolute path to the `.p8` file

Optional tuning:

- `WEATHERKIT_BASE_URL` (default `https://weatherkit.apple.com/api/v1/weather`)
- `WEATHERKIT_LANGUAGE` (default `en`)
- `WEATHERKIT_DATASETS` (default `currentWeather,forecastDaily`)
- `WEATHER_SYNC_MIN_INTERVAL_SECONDS` (default `600`)
- `WEATHER_SYNC_IP_WINDOW_SECONDS` (default `600`)
- `WEATHER_SYNC_IP_MAX_REQUESTS` (default `30`)
- `WEATHER_LOCATION_BUCKET_PRECISION` (default `2`)
- `WEATHER_FORWARD_TINYBIRD` (default `false`)

## 3) Database Migration

Run:

```bash
cd /Users/nickgardner/Desktop/ritual-desktop-main/apps/backend
python apps/backend/scripts/run_database_migrations.py
```

## 4) Verify WeatherKit Credentials

Start backend, then call:

```bash
curl "http://127.0.0.1:8000/api/health/weatherkit"
```

Expected: JSON with `ok: true` and current condition/temperature.

You can also test explicit coordinates/timezone:

```bash
curl "http://127.0.0.1:8000/api/health/weatherkit?lat=40.7128&lon=-74.0060&tz=America/New_York"
```

## Privacy Defaults

- Weather integration only syncs after explicit connect/sync action.
- Location is bucketed server-side for cache/rate-limit decisions.
- Raw lat/lon is not stored unless `storePreciseLocation=true` is explicitly provided.
- `weather_observations` stores normalized weather fields + user-facing location label.
