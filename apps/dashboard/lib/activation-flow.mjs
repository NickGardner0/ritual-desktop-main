/** @typedef {"/dashboard" | "/onboarding?s=profile" | "/onboarding?s=first-behavior"} ActivationNextRoute */
/** @typedef {"profile" | "first-behavior"} OnboardingStep */

/**
 * @param {unknown} route
 * @returns {route is ActivationNextRoute}
 */
export function isSafeActivationRoute(route) {
  return route === "/dashboard"
    || route === "/onboarding?s=profile"
    || route === "/onboarding?s=first-behavior";
}

/**
 * @param {unknown} nextRoute
 * @param {string | null | undefined} dashboardReturnUrl
 * @returns {ActivationNextRoute | string}
 */
export function resolveSsoRedirectRoute(nextRoute, dashboardReturnUrl) {
  if (nextRoute === "/dashboard") {
    return dashboardReturnUrl?.startsWith("/dashboard") ? dashboardReturnUrl : "/dashboard";
  }

  if (nextRoute === "/onboarding?s=profile" || nextRoute === "/onboarding?s=first-behavior") {
    return nextRoute;
  }

  return "/dashboard";
}

/**
 * @param {unknown} nextRoute
 * @returns {ActivationNextRoute | null}
 */
export function resolveDashboardActivationRedirect(nextRoute) {
  if (!isSafeActivationRoute(nextRoute)) {
    return null;
  }

  return nextRoute === "/dashboard" ? null : nextRoute;
}

/**
 * @param {string | null | undefined} value
 * @returns {OnboardingStep}
 */
export function readOnboardingStep(value) {
  return value === "first-behavior" ? "first-behavior" : "profile";
}
