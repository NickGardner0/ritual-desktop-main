import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const dashboardRoot = new URL('../', import.meta.url)

async function readDashboardFile(path) {
  return readFile(new URL(path, dashboardRoot), 'utf8')
}

test('onboarding uses the canonical Ritual mark instead of the animated shader', async () => {
  const [introSource, packageSource, ritualMark] = await Promise.all([
    readDashboardFile('components/onboarding/steps/intro-step.tsx'),
    readDashboardFile('package.json'),
    readDashboardFile('public/images/eclipse.svg'),
  ])

  assert.match(introSource, /src="\/images\/eclipse\.svg"/)
  assert.match(introSource, /width=\{72\}/)
  assert.match(introSource, /height=\{72\}/)
  assert.doesNotMatch(introSource, /LiquidMetal|ritual-liquid-metal/)
  assert.doesNotMatch(packageSource, /@paper-design\/shaders-react/)
  assert.match(ritualMark, /viewBox="0 0 330 330"/)
  assert.match(ritualMark, /fill="black"/)
})

test('every onboarding surface is scoped to FK Grotesk Neue', async () => {
  const [
    globalStyles,
    onboardingPage,
    callbackPage,
    setupShell,
    dashboardPreview,
    rootLayout,
    signUpPage,
    signInPage,
    permissionsRedirect,
    authCallback,
    desktopOauthBridge,
    desktopOauthStart,
  ] = await Promise.all([
    readDashboardFile('app/globals.css'),
    readDashboardFile('app/onboarding/page.tsx'),
    readDashboardFile('app/auth/sso-callback/page.tsx'),
    readDashboardFile('components/onboarding/perplexity-onboarding-shell.tsx'),
    readDashboardFile('components/onboarding/dashboard-preview-window.tsx'),
    readDashboardFile('app/layout.tsx'),
    readDashboardFile('app/sign-up/[[...sign-up]]/page.tsx'),
    readDashboardFile('app/sign-in/[[...sign-in]]/page.tsx'),
    readDashboardFile('app/onboarding/permissions/page.tsx'),
    readDashboardFile('app/auth/callback/page.tsx'),
    readDashboardFile('app/auth/desktop-oauth-bridge/page.tsx'),
    readDashboardFile('app/auth/desktop-start-oauth/page.tsx'),
  ])

  assert.match(globalStyles, /\.ritual-onboarding-font,/)
  assert.match(globalStyles, /font-family: var\(--ritual-font-fk\) !important;/)
  assert.match(onboardingPage, /ritual-onboarding-font/)
  assert.match(onboardingPage, /fontFamily: "'FK Grotesk Neue'/)
  assert.match(onboardingPage, /fontFamilyButtons: "'FK Grotesk Neue'/)
  assert.match(callbackPage, /ritual-onboarding-font/)
  assert.match(setupShell, /ritual-onboarding-font px-onboarding/)
  assert.match(dashboardPreview, /fontFamily: "var\(--ritual-font-fk\)"/)
  assert.doesNotMatch(dashboardPreview, /GeistSans/)
  assert.doesNotMatch(rootLayout, /Newsreader/)
  assert.match(signUpPage, /ritual-onboarding-font/)
  assert.match(signUpPage, /fontFamily: "'FK Grotesk Neue'/)
  assert.match(signInPage, /ritual-onboarding-font/)
  assert.match(signInPage, /fontFamily: "'FK Grotesk Neue'/)
  assert.match(permissionsRedirect, /ritual-onboarding-font/)
  assert.match(authCallback, /ritual-onboarding-font/)
  assert.match(desktopOauthBridge, /ritual-onboarding-font/)
  assert.match(desktopOauthStart, /ritual-onboarding-font/)
})
