export const ONBOARDING_COMPLETED_KEY = 'ritual-onboarding-completed';
export const ONBOARDING_BACKEND_COMPLETED_KEY = 'ritual-onboarding-backend-completed';
export const FROM_WELCOME_KEY = 'ritual-from-welcome';
export const PERMISSIONS_ONBOARDING_REQUIRED_KEY = 'ritual-permissions-onboarding-required';
export const PERMISSIONS_ONBOARDING_COMPLETED_KEY = 'ritual-permissions-onboarding-completed';

function inBrowser() {
  return typeof window !== 'undefined';
}

export function needsPermissionsOnboarding(): boolean {
  if (!inBrowser()) return false;

  return (
    localStorage.getItem(PERMISSIONS_ONBOARDING_REQUIRED_KEY) === 'true' &&
    localStorage.getItem(PERMISSIONS_ONBOARDING_COMPLETED_KEY) !== 'true'
  );
}

export function getPostOnboardingRoute(defaultRoute = '/dashboard'): string {
  return needsPermissionsOnboarding() ? '/onboarding/permissions' : defaultRoute;
}

export function markPermissionsOnboardingRequired() {
  if (!inBrowser()) return;

  localStorage.setItem(PERMISSIONS_ONBOARDING_REQUIRED_KEY, 'true');
  localStorage.removeItem(PERMISSIONS_ONBOARDING_COMPLETED_KEY);
}

export function markPermissionsOnboardingCompleted() {
  if (!inBrowser()) return;

  localStorage.setItem(PERMISSIONS_ONBOARDING_COMPLETED_KEY, 'true');
  localStorage.removeItem(PERMISSIONS_ONBOARDING_REQUIRED_KEY);
}
