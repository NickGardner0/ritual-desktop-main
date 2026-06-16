import { schedules, task } from "@trigger.dev/sdk/v3";
import { triggerBackendFetch } from "@/lib/api/trigger-client";

async function runPlaidSync(payload: { hour?: number }) {
  const internalApiKey = process.env.INTERNAL_API_KEY;

  if (!internalApiKey) {
    throw new Error("INTERNAL_API_KEY environment variable is not set");
  }

  const response = await triggerBackendFetch("/api/financial/sync-all", {
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
    throw new Error(`Plaid sync failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

export const syncPlaidData = task({
  id: "sync-plaid-data",
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 10000,
    factor: 2,
  },
  run: async (payload: { hour?: number }) => {
    return runPlaidSync(payload);
  },
});

export const plaidHourlySyncSchedules = Array.from({ length: 24 }, (_, hour) =>
  schedules.task({
    id: `plaid-sync-hour-${hour}`,
    cron: `0 ${hour} * * *`,
    run: async () => runPlaidSync({ hour }),
  })
);
