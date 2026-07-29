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
  assert.match(introSource, /width=\{40\}/)
  assert.match(introSource, /height=\{40\}/)
  assert.match(introSource, /className="mx-auto h-10 w-10"/)
  assert.match(introSource, /className="translate-y-6"/)
  assert.match(
    introSource,
    /The unified system for tracking, observing, and analyzing all of\s+your online and offline behavior/,
  )
  assert.doesNotMatch(introSource, /LiquidMetal|ritual-liquid-metal/)
  assert.doesNotMatch(packageSource, /@paper-design\/shaders-react/)
  assert.match(ritualMark, /viewBox="0 0 330 330"/)
  assert.match(ritualMark, /fill="black"/)
})

test('product story and insight goals describe Ritual functionality', async () => {
  const [productDemoSource, tasksSource] = await Promise.all([
    readDashboardFile('components/onboarding/steps/product-demo-step.tsx'),
    readDashboardFile('components/onboarding/steps/tasks-step.tsx'),
  ])

  assert.match(productDemoSource, /title="Ritual turns behavior into insight"/)
  assert.match(productDemoSource, /activity, health, habits, and routines/)
  assert.match(productDemoSource, /What would you like to understand\?/)
  assert.match(productDemoSource, /Show me what improves my sleep and focus\./)
  assert.doesNotMatch(productDemoSource, /Computer can tackle|support emails|AI agents/)

  assert.match(
    tasksSource,
    /title="What would you like Ritual to help you understand\?"/,
  )
  assert.match(tasksSource, /Choose a few to personalize your insights\./)
  assert.match(tasksSource, /Sleep improvements/)
  assert.match(tasksSource, /Hidden correlations/)
  assert.match(tasksSource, /Substance use/)
  assert.match(tasksSource, /Personalized insights/)
  assert.doesNotMatch(tasksSource, /Computer|Build an app|Create a spreadsheet|Triage my email/)
})

test('onboarding window and page canvases use the warm fcfcfa surface', async () => {
  const [globalStyles, onboardingWindow, onboardingPage, callbackPage] =
    await Promise.all([
      readDashboardFile('app/globals.css'),
      readDashboardFile('components/onboarding/onboarding-window.tsx'),
      readDashboardFile('app/onboarding/page.tsx'),
      readDashboardFile('app/auth/sso-callback/page.tsx'),
    ])

  assert.match(globalStyles, /--px-onboarding-stage: #fcfcfa;/)
  assert.match(globalStyles, /--px-onboarding-cream: #fcfcfa;/)
  assert.match(globalStyles, /background-color: #fcfcfa !important;/)
  assert.match(onboardingWindow, /bg-\[#fcfcfa\]/)
  assert.match(onboardingPage, /bg-\[#fcfcfa\]/)
  assert.match(callbackPage, /bg-\[#fcfcfa\]/)
})

test('tracking interests use behavior domains and updated recommendations copy', async () => {
  const workTypeSource = await readDashboardFile(
    'components/onboarding/steps/work-type-step.tsx',
  )

  assert.match(workTypeSource, /title="What would you like to track"/)
  assert.match(
    workTypeSource,
    /subtitle="This helps Ritual make recommendations and suggestions"/,
  )

  for (const label of [
    'Health',
    'Learning',
    'Productivity',
    'Work',
    'Sleep',
    'Side Projects',
    'Coding',
    'Finance',
    'Drugs',
    'Goals',
    'Supplements',
    'Habits',
  ]) {
    assert.match(workTypeSource, new RegExp(`label: "${label}"`))
  }

  assert.doesNotMatch(workTypeSource, /Business Owner|Software Engineering|Marketing/)
  assert.match(workTypeSource, /useState<Set<string>>/)
  assert.match(workTypeSource, /selected=\{selected\.has\(item\.id\)\}/)
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
