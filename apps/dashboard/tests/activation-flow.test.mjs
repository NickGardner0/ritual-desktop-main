import test, { describe } from "node:test";
import assert from "node:assert/strict";

const {
  isSafeActivationRoute,
  readOnboardingStep,
  resolveDashboardActivationRedirect,
  resolveSsoRedirectRoute,
} = await import("../lib/activation-flow.mjs");

describe("activation flow route helpers", () => {
  test("SSO callback redirects only from backend nextRoute", () => {
    assert.equal(resolveSsoRedirectRoute("/onboarding?s=profile"), "/onboarding?s=profile");
    assert.equal(resolveSsoRedirectRoute("/onboarding?s=first-behavior"), "/onboarding?s=first-behavior");
    assert.equal(resolveSsoRedirectRoute("/dashboard"), "/dashboard");
  });

  test("SSO callback preserves safe dashboard return URLs only for dashboard completion", () => {
    assert.equal(
      resolveSsoRedirectRoute("/dashboard", "/dashboard?view=metrics"),
      "/dashboard?view=metrics",
    );
    assert.equal(resolveSsoRedirectRoute("/dashboard", "/settings"), "/dashboard");
    assert.equal(
      resolveSsoRedirectRoute("/onboarding?s=profile", "/dashboard?view=metrics"),
      "/onboarding?s=profile",
    );
  });

  test("unknown backend routes fail closed to dashboard, not onboarding", () => {
    assert.equal(resolveSsoRedirectRoute("/not-real"), "/dashboard");
    assert.equal(isSafeActivationRoute("/not-real"), false);
  });

  test("dashboard server layout redirects incomplete activation only", () => {
    assert.equal(resolveDashboardActivationRedirect("/dashboard"), null);
    assert.equal(resolveDashboardActivationRedirect("/onboarding?s=profile"), "/onboarding?s=profile");
    assert.equal(
      resolveDashboardActivationRedirect("/onboarding?s=first-behavior"),
      "/onboarding?s=first-behavior",
    );
    assert.equal(resolveDashboardActivationRedirect("/not-real"), null);
  });

  test("onboarding step parsing supports only profile and first-behavior", () => {
    assert.equal(readOnboardingStep("first-behavior"), "first-behavior");
    assert.equal(readOnboardingStep("profile"), "profile");
    assert.equal(readOnboardingStep("permissions"), "profile");
    assert.equal(readOnboardingStep(null), "profile");
  });
});
