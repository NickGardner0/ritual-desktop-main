#!/usr/bin/env node

const configuredUrl = process.env.SCHEDULER_HEALTH_URL?.trim();
const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
const baseUrl = configuredUrl
  || (railwayDomain ? `https://${railwayDomain}/api/internal/scheduler/health` : '');
const token = process.env.INTERNAL_BACKEND_TOKEN?.trim();

if (!baseUrl) {
  console.error('Set SCHEDULER_HEALTH_URL or run with Railway service variables so RAILWAY_PUBLIC_DOMAIN is available.');
  process.exit(2);
}
if (!token) {
  console.error('INTERNAL_BACKEND_TOKEN is required for scheduler health verification.');
  process.exit(2);
}

const url = new URL(baseUrl);
if (!url.pathname || url.pathname === '/') {
  url.pathname = '/api/internal/scheduler/health';
}

let response;
try {
  response = await fetch(url, {
    headers: {
      'x-backend-token': token,
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(20_000),
  });
} catch (error) {
  console.error(`Scheduler health request failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const body = await response.json().catch(() => null);
if (
  !response.ok
  || body?.schemaVersion !== 2
  || body?.status !== 'healthy'
  || body?.jobCount !== 13
  || !Array.isArray(body?.duplicateOccurrenceIdentities)
) {
  console.error(JSON.stringify({ httpStatus: response.status, health: body }, null, 2));
  process.exit(1);
}
if (
  body.neverSucceeded?.length
  || body.staleJobs?.length
  || body.overlappingLeases?.length
  || body.duplicateOccurrenceIdentities?.length
) {
  console.error(JSON.stringify(body, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(body, null, 2));
