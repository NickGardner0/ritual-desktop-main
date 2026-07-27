import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const dashboardWindowSourceUrl = new URL('../lib/tauri-utils.ts', import.meta.url)
const nativeWindowSourceUrl = new URL('../../desktop/src-tauri/src/main.rs', import.meta.url)
const homeSourceUrl = new URL('../app/home-client.tsx', import.meta.url)
const ssoCallbackSourceUrl = new URL('../app/auth/sso-callback/page.tsx', import.meta.url)

test('dashboard and native window defaults share the 1260 by 770 frame contract', async () => {
  const [dashboardSource, nativeSource] = await Promise.all([
    readFile(dashboardWindowSourceUrl, 'utf8'),
    readFile(nativeWindowSourceUrl, 'utf8'),
  ])

  assert.match(dashboardSource, /const DEFAULT_WINDOW_WIDTH = 1260;/)
  assert.match(dashboardSource, /const DEFAULT_WINDOW_HEIGHT = 770;/)
  assert.match(nativeSource, /const MAIN_WINDOW_DEFAULT_WIDTH: f64 = 1260\.0;/)
  assert.match(nativeSource, /const MAIN_WINDOW_DEFAULT_HEIGHT: f64 = 770\.0;/)
})

test('auth redirects restore the dashboard frame only for pending onboarding', async () => {
  const [homeSource, ssoCallbackSource] = await Promise.all([
    readFile(homeSourceUrl, 'utf8'),
    readFile(ssoCallbackSourceUrl, 'utf8'),
  ])

  assert.match(
    homeSource,
    /const restoreDashboardOnRedirect = hasPendingSignUpIntent\(\);/,
  )
  assert.doesNotMatch(
    homeSource,
    /const restoreDashboardOnRedirect = isNewUser === true;/,
  )
  assert.match(
    ssoCallbackSource,
    /if \(shouldRestoreWindowSize\) \{\s+await restoreDashboardWindowSize\(\)/,
  )
})
