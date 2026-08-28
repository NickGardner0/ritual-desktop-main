export const DEFAULT_DESKTOP_HOSTED_ORIGIN = 'https://desktop.ritualdb.com';

type RitualWindow = Window & {
  __RITUAL_HOSTED_ORIGIN__?: string;
};

export type DesktopOAuthMode = 'sign_in' | 'sign_up';
export type DesktopOAuthStrategy = 'oauth_google' | 'oauth_apple';

export type DesktopOAuthHandoffFields = {
  handoffId: string;
  nonceChallenge: string;
  channel: string;
  protocol: string;
  expiresAtMs: number;
  appVersion: string;
  buildSha: string;
  bundleId: string;
  callbackScheme: string;
  target?: string | null;
};

function isTrustedHostedOrigin(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    return host === 'desktop.ritualdb.com' || host === 'ritualdb.com' || host.endsWith('.ritualdb.com');
  } catch {
    return false;
  }
}

export function getDesktopHostedOrigin(
  windowLike?: Pick<RitualWindow, '__RITUAL_HOSTED_ORIGIN__'> | null,
): string {
  const raw = windowLike?.__RITUAL_HOSTED_ORIGIN__
    ?? (typeof window === 'undefined' ? undefined : (window as RitualWindow).__RITUAL_HOSTED_ORIGIN__);
  const origin = raw?.trim().replace(/\/$/, '');
  if (origin && isTrustedHostedOrigin(origin)) {
    return origin;
  }
  return DEFAULT_DESKTOP_HOSTED_ORIGIN;
}

export const DESKTOP_AUTH_HANDOFF_API_PATH = '/api/auth/desktop-sign-in-token';

type DesktopAuthHandoffWindow = Pick<RitualWindow, '__RITUAL_HOSTED_ORIGIN__'> & {
  location?: { origin: string };
};

export function getDesktopAuthHandoffApiUrl(
  windowLike?: DesktopAuthHandoffWindow | null,
): string {
  const hosted = getDesktopHostedOrigin(windowLike);
  const pageOrigin = windowLike?.location?.origin
    ?? (typeof window === 'undefined' ? undefined : window.location.origin);
  if (pageOrigin && pageOrigin.replace(/\/$/, '') === hosted) {
    return DESKTOP_AUTH_HANDOFF_API_PATH;
  }
  return `${hosted}${DESKTOP_AUTH_HANDOFF_API_PATH}`;
}

export function shouldCompleteDesktopAuthOnHostedOrigin(
  pageOrigin?: string,
  hostedOrigin = getDesktopHostedOrigin(),
): boolean {
  const origin = (pageOrigin
    ?? (typeof window === 'undefined' ? '' : window.location.origin)).replace(/\/$/, '');
  return Boolean(origin) && origin !== hostedOrigin;
}

export function buildDesktopHostedAuthCallbackUrl(
  pathAndQuery: string,
  hostedOrigin = getDesktopHostedOrigin(),
): string {
  const path = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`;
  return `${hostedOrigin}${path}`;
}

export function buildDesktopOAuthStartUrl(
  mode: DesktopOAuthMode,
  strategy: DesktopOAuthStrategy,
  handoff: DesktopOAuthHandoffFields,
  hostedOrigin = getDesktopHostedOrigin(),
): string {
  const url = new URL('/auth/desktop-start-oauth', hostedOrigin);
  url.searchParams.set('mode', mode);
  url.searchParams.set('strategy', strategy);
  url.searchParams.set('handoff_id', handoff.handoffId);
  url.searchParams.set('nonce_challenge', handoff.nonceChallenge);
  url.searchParams.set('channel', handoff.channel);
  url.searchParams.set('protocol', handoff.protocol);
  url.searchParams.set('expires_at_ms', String(handoff.expiresAtMs));
  url.searchParams.set('app_version', handoff.appVersion);
  url.searchParams.set('build_sha', handoff.buildSha);
  url.searchParams.set('bundle_id', handoff.bundleId);
  url.searchParams.set('callback_scheme', handoff.callbackScheme);
  if (handoff.target) url.searchParams.set('target', handoff.target);
  return url.toString();
}
