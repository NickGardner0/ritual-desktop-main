import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const callbackSourceUrl = new URL('../app/auth/sso-callback/page.tsx', import.meta.url)
const onboardingSourceUrl = new URL('../app/onboarding/page.tsx', import.meta.url)
const proxySourceUrl = new URL('../lib/server/proxy-helper.ts', import.meta.url)

test('account callback performs one bootstrap request without automatic retries', async () => {
  const source = await readFile(callbackSourceUrl, 'utf8')

  assert.match(source, /const response = await fetchBootstrap\(token\)/)
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
  const source = await readFile(proxySourceUrl, 'utf8')

  assert.match(source, /server-timing/)
  assert.match(source, /x-ritual-bootstrap-duration-ms/)
  assert.match(source, /x-ritual-bootstrap-mode/)
})
