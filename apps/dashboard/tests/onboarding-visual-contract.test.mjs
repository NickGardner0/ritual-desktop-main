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
  assert.match(introSource, /The unified system for tracking, observing, and/)
  assert.match(introSource, /analyzing all of your online and offline behavior/)
  assert.match(introSource, /block whitespace-nowrap/)
  assert.doesNotMatch(introSource, /LiquidMetal|ritual-liquid-metal/)
  assert.doesNotMatch(packageSource, /@paper-design\/shaders-react/)
  assert.match(ritualMark, /viewBox="0 0 330 330"/)
  assert.match(ritualMark, /fill="black"/)
})

test('feature tour describes Ritual devices, imports, tasks, routines, and analytics', async () => {
  const [
    productDemoSource,
    sourcesPickerSource,
    tasksSource,
    compactFileScannerSource,
    scheduleSource,
    appsSource,
    notificationsSource,
  ] = await Promise.all([
    readDashboardFile('components/onboarding/steps/product-demo-step.tsx'),
    readDashboardFile('components/onboarding/sources-picker.tsx'),
    readDashboardFile('components/onboarding/steps/tasks-step.tsx'),
    readDashboardFile('components/onboarding/compact-file-scanner.tsx'),
    readDashboardFile('components/onboarding/steps/schedule-step.tsx'),
    readDashboardFile('components/onboarding/steps/apps-step.tsx'),
    readDashboardFile('components/onboarding/steps/notifications-step.tsx'),
  ])

  assert.match(productDemoSource, /title="Connect your devices"/)
  assert.match(productDemoSource, /Connect to the devices you use and wear/)
  assert.match(productDemoSource, /every day to automate self-tracking/)
  assert.match(productDemoSource, /<br \/>/)
  assert.match(productDemoSource, /SourcesPicker/)
  assert.doesNotMatch(productDemoSource, /Available sources/)

  assert.match(sourcesPickerSource, /placeholder="Search sources"/)
  assert.match(sourcesPickerSource, /Apple Health/)
  assert.match(sourcesPickerSource, /WHOOP/)
  assert.match(sourcesPickerSource, /Screen Time/)
  assert.match(sourcesPickerSource, /Computer Use/)
  assert.match(sourcesPickerSource, /Plaid/)
  assert.match(sourcesPickerSource, /role="switch"/)
  assert.match(sourcesPickerSource, /DEMO_SEQUENCE/)
  assert.match(sourcesPickerSource, /id: "apple-health", delay: 600/)
  assert.match(sourcesPickerSource, /id: "whoop", delay: 1100/)
  assert.match(sourcesPickerSource, /id: "oura", delay: 1600/)
  assert.match(sourcesPickerSource, /id: "screen-time", delay: 2100/)
  assert.match(sourcesPickerSource, /id: "computer-use", delay: 2600/)
  assert.match(sourcesPickerSource, /max-w-\[360px\]/)
  assert.match(sourcesPickerSource, /scrollTo\(\{/)
  assert.match(sourcesPickerSource, /source\.name\.toLowerCase\(\)\.includes\(query\)/)
  assert.match(sourcesPickerSource, /Add Source/)
  assert.match(sourcesPickerSource, /prefers-reduced-motion: reduce/)

  assert.match(tasksSource, /title="Import your data"/)
  assert.match(tasksSource, /CompactFileScanner/)
  assert.match(tasksSource, /You don't have to start self-tracking from scratch,/)
  assert.match(tasksSource, /import some or all your historical wearable data/)
  assert.match(tasksSource, /max-w-\[400px\]/)
  assert.doesNotMatch(tasksSource, /bg-\[var\(--px-onboarding-recessed\)\]/)
  assert.doesNotMatch(tasksSource, /rounded-\[16px\] border/)
  assert.doesNotMatch(tasksSource, /Drop files here to import/)

  assert.match(compactFileScannerSource, /apple_health_export\.xml/)
  assert.match(compactFileScannerSource, /whoop_import\.csv/)
  assert.match(compactFileScannerSource, /oura_ring_import\.csv/)
  assert.match(compactFileScannerSource, /ritual-compact-file-scan/)
  assert.match(compactFileScannerSource, /prefers-reduced-motion: reduce/)
  assert.match(compactFileScannerSource, /MenuSurface/)
  assert.doesNotMatch(compactFileScannerSource, /pointer-events-none absolute inset-0 flex items-center justify-center/)
  assert.match(compactFileScannerSource, /Parsed daily summary/)
  assert.match(compactFileScannerSource, /Export rows parsed: 2,418/)
  assert.match(compactFileScannerSource, /text-\[7\.5px\]/)
  assert.match(compactFileScannerSource, /leading-\[10\.5px\]/)

  assert.match(scheduleSource, /title="Tasks"/)
  assert.match(scheduleSource, /Schedule doctors appointment/)
  assert.match(scheduleSource, /Read 20 pages/)
  assert.match(scheduleSource, /Go to the gym/)
  assert.match(scheduleSource, /Work on new product feature/)
  assert.match(scheduleSource, /Drink 1\/2 gallon of water/)
  assert.match(scheduleSource, /MenuSurface/)
  assert.match(scheduleSource, /Quick Capture/)
  assert.match(scheduleSource, /Capture/)
  assert.match(scheduleSource, /min-h-\[420px\]/)
  assert.doesNotMatch(scheduleSource, /View by List/)
  assert.doesNotMatch(scheduleSource, /Review weekly goals/)
  assert.doesNotMatch(scheduleSource, /bg-\[var\(--px-onboarding-recessed\)\]/)
  assert.doesNotMatch(scheduleSource, /rounded-\[10px\] border border-\[var\(--px-onboarding-border\)\] bg-\[var\(--px-onboarding-chip\)\]/)

  assert.match(appsSource, /title="Routines"/)
  assert.match(appsSource, /Morning reset/)
  assert.match(appsSource, /Deep work block/)

  assert.match(notificationsSource, /title="Analytics"/)
  assert.match(notificationsSource, /Focus trend/)
  assert.match(notificationsSource, /Pattern found/)

  for (const source of [
    productDemoSource,
    tasksSource,
    scheduleSource,
    appsSource,
    notificationsSource,
  ]) {
    assert.doesNotMatch(
      source,
      /Computer can tackle|support emails|AI agents|Build an app|Triage my email/,
    )
  }
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
  assert.match(globalStyles, /--px-onboarding-chip: #fcfcfa;/)
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
