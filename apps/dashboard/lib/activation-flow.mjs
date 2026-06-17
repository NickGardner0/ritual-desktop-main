/** @typedef {"welcome" | "signup" | "setup"} OnboardingStep */

export const V3_ONBOARDING_STEPS = ["welcome", "signup", "setup"];

/** @type {Record<string, OnboardingStep>} */
const LEGACY_ONBOARDING_STEP_ALIASES = {
  meet: "setup",
  permissions: "setup",
  privacy: "setup",
};

const ONBOARDING_ROUTES = new Set([
  ...V3_ONBOARDING_STEPS.map((step) => `/onboarding?s=${step}`),
  ...Object.keys(LEGACY_ONBOARDING_STEP_ALIASES).map((step) => `/onboarding?s=${step}`),
]);

/**
 * @param {unknown} step
 * @returns {OnboardingStep | null}
 */
export function normalizeOnboardingStep(step) {
  if (typeof step !== "string") {
    return null;
  }

  if (V3_ONBOARDING_STEPS.includes(step)) {
    return step;
  }

  return LEGACY_ONBOARDING_STEP_ALIASES[step] ?? null;
}

/**
 * @param {unknown} route
 * @returns {route is `/onboarding?s=${OnboardingStep}` | "/dashboard"}
 */
export function isSafeActivationRoute(route) {
  return route === "/dashboard" || ONBOARDING_ROUTES.has(route);
}

/**
 * @param {unknown} route
 * @returns {OnboardingStep | null}
 */
export function parseOnboardingStepFromRoute(route) {
  if (typeof route !== "string") {
    return null;
  }

  const match = route.match(/^\/onboarding\?s=([a-z_]+)$/);
  if (!match) {
    return null;
  }

  return normalizeOnboardingStep(match[1]);
}

/**
 * @param {unknown} backendRoute
 * @param {string | null | undefined} cachedStep
 * @returns {OnboardingStep}
 */
export function resolveOnboardingStep(backendRoute, cachedStep) {
  const backendStep = parseOnboardingStepFromRoute(backendRoute);
  const normalizedCachedStep = normalizeOnboardingStep(cachedStep);

  if (!backendStep) {
    return normalizedCachedStep ?? "welcome";
  }

  if (!normalizedCachedStep) {
    return backendStep;
  }

  const backendIdx = V3_ONBOARDING_STEPS.indexOf(backendStep);
  const cachedIdx = V3_ONBOARDING_STEPS.indexOf(normalizedCachedStep);
  return V3_ONBOARDING_STEPS[Math.max(backendIdx, cachedIdx)];
}

/**
 * @param {unknown} nextRoute
 * @param {string | null | undefined} dashboardReturnUrl
 * @returns {`/onboarding?s=${OnboardingStep}` | "/dashboard" | string}
 */
export function resolveSsoRedirectRoute(nextRoute, dashboardReturnUrl) {
  if (nextRoute === "/dashboard") {
    return dashboardReturnUrl?.startsWith("/dashboard") ? dashboardReturnUrl : "/dashboard";
  }

  if (isSafeActivationRoute(nextRoute)) {
    const normalizedStep = parseOnboardingStepFromRoute(nextRoute);
    return normalizedStep ? onboardingRouteForStep(normalizedStep) : "/dashboard";
  }

  return "/dashboard";
}

/**
 * @param {unknown} nextRoute
 * @returns {`/onboarding?s=${OnboardingStep}` | null}
 */
export function resolveDashboardActivationRedirect(nextRoute) {
  if (!isSafeActivationRoute(nextRoute)) {
    return null;
  }

  if (nextRoute === "/dashboard") {
    return null;
  }

  const normalizedStep = parseOnboardingStepFromRoute(nextRoute);
  return normalizedStep ? onboardingRouteForStep(normalizedStep) : null;
}

/**
 * @param {OnboardingStep} step
 * @returns {`/onboarding?s=${OnboardingStep}`}
 */
export function onboardingRouteForStep(step) {
  return `/onboarding?s=${step}`;
}
