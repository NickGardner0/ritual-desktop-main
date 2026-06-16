import test, { describe } from "node:test";
import assert from "node:assert/strict";

const {
  isSafeActivationRoute,
  onboardingRouteForStep,
  parseOnboardingStepFromRoute,
  resolveDashboardActivationRedirect,
  resolveOnboardingStep,
  resolveSsoRedirectRoute,
} = await import("../lib/activation-flow.mjs");

describe("activation flow route helpers", () => {
  test("SSO callback redirects only from backend nextRoute", () => {
    assert.equal(resolveSsoRedirectRoute("/onboarding?s=signup"), "/onboarding?s=signup");
    assert.equal(resolveSsoRedirectRoute("/onboarding?s=meet"), "/onboarding?s=meet");
    assert.equal(resolveSsoRedirectRoute("/onboarding?s=permissions"), "/onboarding?s=permissions");
    assert.equal(resolveSsoRedirectRoute("/dashboard"), "/dashboard");
  });

  test("SSO callback preserves safe dashboard return URLs only for dashboard completion", () => {
    assert.equal(
      resolveSsoRedirectRoute("/dashboard", "/dashboard?view=metrics"),
      "/dashboard?view=metrics",
    );
    assert.equal(resolveSsoRedirectRoute("/dashboard", "/settings"), "/dashboard");
    assert.equal(
      resolveSsoRedirectRoute("/onboarding?s=meet", "/dashboard?view=metrics"),
      "/onboarding?s=meet",
    );
  });

  test("unknown backend routes fail closed to dashboard, not onboarding", () => {
    assert.equal(resolveSsoRedirectRoute("/not-real"), "/dashboard");
    assert.equal(isSafeActivationRoute("/not-real"), false);
    assert.equal(isSafeActivationRoute("/onboarding?s=profile"), false);
  });

  test("dashboard server layout redirects incomplete activation only", () => {
    assert.equal(resolveDashboardActivationRedirect("/dashboard"), null);
    assert.equal(resolveDashboardActivationRedirect("/onboarding?s=signup"), "/onboarding?s=signup");
    assert.equal(
      resolveDashboardActivationRedirect("/onboarding?s=permissions"),
      "/onboarding?s=permissions",
    );
    assert.equal(resolveDashboardActivationRedirect("/not-real"), null);
  });

  test("onboarding step parsing supports V3 steps", () => {
    assert.equal(parseOnboardingStepFromRoute("/onboarding?s=meet"), "meet");
    assert.equal(parseOnboardingStepFromRoute("/onboarding?s=privacy"), "privacy");
    assert.equal(parseOnboardingStepFromRoute("/onboarding?s=profile"), null);
    assert.equal(parseOnboardingStepFromRoute("/dashboard"), null);
  });

  test("onboarding step resolution keeps UX cache ahead of backend minimum", () => {
    assert.equal(resolveOnboardingStep("/onboarding?s=meet", "permissions"), "permissions");
    assert.equal(resolveOnboardingStep("/onboarding?s=meet", null), "meet");
    assert.equal(onboardingRouteForStep("privacy"), "/onboarding?s=privacy");
  });
});
