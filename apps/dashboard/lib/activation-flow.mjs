/** @typedef {"welcome" | "signup" | "meet" | "permissions" | "privacy"} OnboardingStep */

export const V3_ONBOARDING_STEPS = ["welcome", "signup", "meet", "permissions", "privacy"];

const ONBOARDING_ROUTES = new Set(
  V3_ONBOARDING_STEPS.map((step) => `/onboarding?s=${step}`),
);

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

  const match = route.match(/^\/onboarding\?s=([a-z-]+)$/);
  if (!match) {
    return null;
  }

  const step = match[1];
  return V3_ONBOARDING_STEPS.includes(step) ? step : null;
}

/**
 * @param {unknown} backendRoute
 * @param {string | null | undefined} cachedStep
 * @returns {OnboardingStep}
 */
export function resolveOnboardingStep(backendRoute, cachedStep) {
  const backendStep = parseOnboardingStepFromRoute(backendRoute);
  if (!backendStep) {
    return cachedStep && V3_ONBOARDING_STEPS.includes(cachedStep) ? cachedStep : "welcome";
  }

  if (!cachedStep || !V3_ONBOARDING_STEPS.includes(cachedStep)) {
    return backendStep;
  }

  const backendIdx = V3_ONBOARDING_STEPS.indexOf(backendStep);
  const cachedIdx = V3_ONBOARDING_STEPS.indexOf(cachedStep);
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
    return nextRoute;
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

  return nextRoute === "/dashboard" ? null : nextRoute;
}

/**
 * @param {OnboardingStep} step
 * @returns {`/onboarding?s=${OnboardingStep}`}
 */
export function onboardingRouteForStep(step) {
  return `/onboarding?s=${step}`;
}
