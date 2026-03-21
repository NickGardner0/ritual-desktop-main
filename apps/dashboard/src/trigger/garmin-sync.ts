import { schedules, task } from "@trigger.dev/sdk/v3";

async function runGarminSync(payload: { hour?: number }) {
  const apiBaseUrl =
    process.env.PYTHON_API_URL || process.env.NEXT_PUBLIC_PYTHON_API_URL || "http://127.0.0.1:8000";
  const internalApiKey = process.env.INTERNAL_API_KEY;

  if (!internalApiKey) {
    throw new Error("INTERNAL_API_KEY environment variable is not set");
  }

  const response = await fetch(`${apiBaseUrl}/api/wearables/connections/garmin/sync-all`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Key": internalApiKey,
    },
    body: JSON.stringify({
      hour: payload.hour,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Garmin sync failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

export const syncGarminData = task({
  id: "sync-garmin-data",
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 10000,
    factor: 2,
  },
  run: async (payload: { hour?: number }) => {
    return runGarminSync(payload);
  },
});

export const garminHourlySyncSchedules = Array.from({ length: 24 }, (_, hour) =>
  schedules.task({
    id: `garmin-sync-hour-${hour}`,
    cron: `0 ${hour} * * *`,
    run: async () => runGarminSync({ hour }),
  })
);
