/** @typedef {"/dashboard" | "/onboarding?s=profile" | "/onboarding?s=first-behavior" | "/onboarding?s=connect"} ActivationNextRoute */
/** @typedef {"profile" | "first-behavior" | "connect"} OnboardingStep */

/**
 * @param {unknown} route
 * @returns {route is ActivationNextRoute}
 */
export function isSafeActivationRoute(route) {
  return route === "/dashboard"
    || route === "/onboarding?s=profile"
    || route === "/onboarding?s=first-behavior"
    || route === "/onboarding?s=connect";
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

  if (
    nextRoute === "/onboarding?s=profile"
    || nextRoute === "/onboarding?s=first-behavior"
    || nextRoute === "/onboarding?s=connect"
  ) {
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
  if (value === "first-behavior" || value === "connect") {
    return value;
  }
  return "profile";
}
