export const ONBOARDING_COMPLETED_KEY = 'ritual-onboarding-completed';
export const ONBOARDING_BACKEND_COMPLETED_KEY = 'ritual-onboarding-backend-completed';
export const FROM_WELCOME_KEY = 'ritual-from-welcome';
export const PERMISSIONS_ONBOARDING_REQUIRED_KEY = 'ritual-permissions-onboarding-required';
export const PERMISSIONS_ONBOARDING_COMPLETED_KEY = 'ritual-permissions-onboarding-completed';
export const DEVICE_AUTHENTICATED_KEY = 'ritual-device-authenticated';

function inBrowser() {
  return typeof window !== 'undefined';
}

function buildScopedKey(baseKey: string, userId?: string | null): string {
  const normalizedUserId = userId?.trim();
  return normalizedUserId ? `${baseKey}:${normalizedUserId}` : baseKey;
}

function readLocalFlag(baseKey: string, userId?: string | null): boolean {
  if (!inBrowser()) return false;
  return window.localStorage.getItem(buildScopedKey(baseKey, userId)) === 'true';
}

function writeLocalFlag(baseKey: string, userId?: string | null): void {
  if (!inBrowser()) return;
  window.localStorage.setItem(buildScopedKey(baseKey, userId), 'true');
}

function removeLocalFlag(baseKey: string, userId?: string | null): void {
  if (!inBrowser()) return;
  window.localStorage.removeItem(buildScopedKey(baseKey, userId));
}

function readSessionFlag(baseKey: string): boolean {
  if (!inBrowser()) return false;
  return window.sessionStorage.getItem(baseKey) === 'true';
}

function writeSessionFlag(baseKey: string): void {
  if (!inBrowser()) return;
  window.sessionStorage.setItem(baseKey, 'true');
}

function removeSessionFlag(baseKey: string): void {
  if (!inBrowser()) return;
  window.sessionStorage.removeItem(baseKey);
}

export function hasCompletedOnboarding(userId?: string | null): boolean {
  return readLocalFlag(ONBOARDING_COMPLETED_KEY, userId);
}

export function markOnboardingCompleted(userId?: string | null): void {
  writeLocalFlag(ONBOARDING_COMPLETED_KEY, userId);
  markDeviceAuthenticated();
}

export function clearOnboardingCompleted(userId?: string | null): void {
  removeLocalFlag(ONBOARDING_COMPLETED_KEY, userId);
}

export function hasCompletedBackendOnboarding(userId?: string | null): boolean {
  return readLocalFlag(ONBOARDING_BACKEND_COMPLETED_KEY, userId);
}

export function markBackendOnboardingCompleted(userId?: string | null): void {
  writeLocalFlag(ONBOARDING_BACKEND_COMPLETED_KEY, userId);
  markDeviceAuthenticated();
}

export function clearBackendOnboardingCompleted(userId?: string | null): void {
  removeLocalFlag(ONBOARDING_BACKEND_COMPLETED_KEY, userId);
}

export function cameFromWelcomeFlow(): boolean {
  return readSessionFlag(FROM_WELCOME_KEY);
}

export function markFromWelcomeFlow(): void {
  writeSessionFlag(FROM_WELCOME_KEY);
}

export function clearFromWelcomeFlow(): void {
  removeSessionFlag(FROM_WELCOME_KEY);
}

export function markDeviceAuthenticated(): void {
  if (!inBrowser()) return;
  window.localStorage.setItem(DEVICE_AUTHENTICATED_KEY, 'true');
}

export function hasDeviceAuthenticated(): boolean {
  if (!inBrowser()) return false;
  return window.localStorage.getItem(DEVICE_AUTHENTICATED_KEY) === 'true';
}

export function needsPermissionsOnboarding(userId?: string | null): boolean {
  return (
    readLocalFlag(PERMISSIONS_ONBOARDING_REQUIRED_KEY, userId) &&
    !readLocalFlag(PERMISSIONS_ONBOARDING_COMPLETED_KEY, userId)
  );
}

export function markPermissionsOnboardingRequired(userId?: string | null) {
  writeLocalFlag(PERMISSIONS_ONBOARDING_REQUIRED_KEY, userId);
  removeLocalFlag(PERMISSIONS_ONBOARDING_COMPLETED_KEY, userId);
}

export function markPermissionsOnboardingCompleted(userId?: string | null) {
  writeLocalFlag(PERMISSIONS_ONBOARDING_COMPLETED_KEY, userId);
  removeLocalFlag(PERMISSIONS_ONBOARDING_REQUIRED_KEY, userId);
  markDeviceAuthenticated();
}

export function getPostOnboardingRoute(defaultRoute = '/dashboard', userId?: string | null): string {
  return needsPermissionsOnboarding(userId) ? '/onboarding/permissions' : defaultRoute;
}
