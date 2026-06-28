export const FROM_WELCOME_KEY = 'ritual-from-welcome';
export const SIGN_UP_INTENT_KEY = 'ritual-sign-up-intent';
export const DEVICE_AUTHENTICATED_KEY = 'ritual-device-authenticated';

function inBrowser() {
  return typeof window !== 'undefined';
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

export function cameFromWelcomeFlow(): boolean {
  return readSessionFlag(FROM_WELCOME_KEY);
}

export function markFromWelcomeFlow(): void {
  writeSessionFlag(FROM_WELCOME_KEY);
}

export function clearFromWelcomeFlow(): void {
  removeSessionFlag(FROM_WELCOME_KEY);
}

export function hasPendingSignUpIntent(): boolean {
  return readSessionFlag(SIGN_UP_INTENT_KEY);
}

export function markSignUpIntent(): void {
  writeSessionFlag(SIGN_UP_INTENT_KEY);
}

export function clearSignUpIntent(): void {
  removeSessionFlag(SIGN_UP_INTENT_KEY);
}

export function markDeviceAuthenticated(): void {
  if (!inBrowser()) return;
  window.localStorage.setItem(DEVICE_AUTHENTICATED_KEY, 'true');
}

export function hasDeviceAuthenticated(): boolean {
  if (!inBrowser()) return false;
  return window.localStorage.getItem(DEVICE_AUTHENTICATED_KEY) === 'true';
}
