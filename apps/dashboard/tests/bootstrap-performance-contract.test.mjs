import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const callbackSourceUrl = new URL('../app/auth/sso-callback/page.tsx', import.meta.url)
const dashboardLayoutSourceUrl = new URL('../app/(dashboard)/layout.tsx', import.meta.url)
const onboardingSourceUrl = new URL('../app/onboarding/page.tsx', import.meta.url)
const proxySourceUrl = new URL('../lib/server/proxy-helper.ts', import.meta.url)
const proxyResponseSourceUrl = new URL('../lib/server/proxy-response-init.mjs', import.meta.url)
const railwayConfigUrl = new URL('../../backend/railway.json', import.meta.url)

test('account callback performs one bootstrap request without automatic retries', async () => {
  const source = await readFile(callbackSourceUrl, 'utf8')

  assert.match(source, /bootstrap = await fetchBootstrap\(resolvedGetToken, resolvedUserId\)/)
  assert.doesNotMatch(source, /BOOTSTRAP_RETRY_DELAYS_MS/)
  assert.doesNotMatch(source, /Still setting up your account/)
})

test('callback hands bootstrap routing state to onboarding instead of refetching it', async () => {
  const callbackSource = await readFile(callbackSourceUrl, 'utf8')
  const onboardingSource = await readFile(onboardingSourceUrl, 'utf8')

  assert.match(callbackSource, /storeBootstrapHandoff\(bootstrap\)/)
  assert.match(onboardingSource, /consumeBootstrapHandoff\(\)/)
  assert.match(onboardingSource, /bootstrapSyncUserRef\.current === user\.id/)
})

test('backend timing headers are forwarded to the browser', async () => {
  const proxySource = await readFile(proxySourceUrl, 'utf8')
  const proxyResponseSource = await readFile(proxyResponseSourceUrl, 'utf8')
  const source = `${proxySource}\n${proxyResponseSource}`

  assert.match(source, /createProxiedSuccessResponse/)
  assert.match(source, /server-timing/)
  assert.match(source, /x-ritual-bootstrap-duration-ms/)
  assert.match(source, /x-ritual-bootstrap-mode/)
})

test('dashboard activation failures fail closed through bootstrap recovery', async () => {
  const source = await readFile(dashboardLayoutSourceUrl, 'utf8')

  assert.match(
    source,
    /DASHBOARD_BOOTSTRAP_RECOVERY_ROUTE = '\/auth\/sso-callback\?reason=dashboard-bootstrap'/,
  )
  assert.match(source, /createServerBackendClient/)
  assert.match(source, /get_user_bootstrap_api_user_bootstrap_get/)
  assert.match(source, /recoverFromBootstrapFailure\(/)
  assert.match(source, /'fetch_failed'/)
  assert.match(source, /'bad_status'/)
  assert.match(source, /'invalid_json'/)
  assert.doesNotMatch(source, /recordBootstrapFailure\('(?:fetch_failed|bad_status|invalid_json)'[\s\S]*?\n\s*return;/)
})

test('callback recovers saved onboarding progress after transient bootstrap failures', async () => {
  const source = await readFile(callbackSourceUrl, 'utf8')

  assert.match(source, /readPersistedOnboardingRoute\(\)/)
  assert.match(source, /recovering saved onboarding route/)
  assert.match(source, /router\.replace\(persistedOnboardingRoute\)/)
  assert.match(source, /error instanceof BootstrapError\s*\?\s*null/)
})

test('Railway backend deploys only when backend files change', async () => {
  const config = JSON.parse(await readFile(railwayConfigUrl, 'utf8'))

  assert.deepEqual(config.build.watchPatterns, ['/apps/backend/**'])
})
