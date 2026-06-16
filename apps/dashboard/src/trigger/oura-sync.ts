import { schedules, task } from "@trigger.dev/sdk/v3";
import { triggerBackendFetch } from "@/lib/api/trigger-client";

async function runOuraSync(payload: { hour?: number; daysBack?: number; forceFullSync?: boolean }) {
  const internalApiKey = process.env.INTERNAL_API_KEY;

  if (!internalApiKey) {
    throw new Error("INTERNAL_API_KEY environment variable is not set");
  }

  const response = await triggerBackendFetch("/api/wearables/connections/oura/sync-all", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Key": internalApiKey,
    },
    body: JSON.stringify({
      hour: payload.hour,
      days_back: payload.daysBack ?? 2,
      force_full_sync: payload.forceFullSync ?? false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Oura sync failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

export const syncOuraData = task({
  id: "sync-oura-data",
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 10000,
    factor: 2,
  },
  run: async (payload: { hour?: number; daysBack?: number; forceFullSync?: boolean }) => {
    return runOuraSync(payload);
  },
});

export const ouraHourlySyncSchedules = Array.from({ length: 24 }, (_, hour) =>
  schedules.task({
    id: `oura-sync-hour-${hour}`,
    cron: `0 ${hour} * * *`,
    run: async () => runOuraSync({ hour }),
  })
);
