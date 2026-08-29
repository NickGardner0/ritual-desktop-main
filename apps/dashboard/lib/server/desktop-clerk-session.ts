import { clerkClient } from '@clerk/nextjs/server';

export type DesktopAuthProfile = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  fullName: string | null;
  imageUrl: string;
  primaryEmailAddress: { emailAddress: string } | null;
  primaryPhoneNumber: { phoneNumber: string } | null;
  twoFactorEnabled: boolean;
};

export type DesktopAuthSessionPayload = {
  accessToken: string;
  sessionId: string;
  userId: string;
  profile: DesktopAuthProfile;
};

type ClerkSessionApi = {
  createSession?: (params: { userId: string }) => Promise<{ id?: string | null }>;
  getSession?: (sessionId: string) => Promise<{ id?: string | null; userId?: string | null }>;
  getToken: (sessionId: string, template?: string, expiresInSeconds?: number) => Promise<unknown>;
};

type ClerkUserRecord = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  imageUrl?: string | null;
  twoFactorEnabled?: boolean;
  primaryEmailAddressId?: string | null;
  primaryPhoneNumberId?: string | null;
  emailAddresses?: Array<{ id?: string; emailAddress?: string }>;
  phoneNumbers?: Array<{ id?: string; phoneNumber?: string }>;
};

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
    return JSON.parse(Buffer.from(`${padded}${pad}`, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function configuredAuthorizedParties(): Set<string> {
  const fromEnv = (process.env.CLERK_AUTHORIZED_PARTIES || '').split(',');
  const defaults = [
    'https://desktop.ritualdb.com',
    'https://clerk.ritualdb.com',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ];
  return new Set(
    [...fromEnv, ...defaults]
      .map((value) => value.trim().replace(/\/$/, ''))
      .filter(Boolean),
  );
}

export function verifyMintedSessionTokenAzp(token: string): string | null {
  const azp = String(decodeJwtPayload(token)?.azp || '').trim().replace(/\/$/, '');
  if (!azp) return null;
  const allowed = configuredAuthorizedParties();
  if (azp === 'https://tauri.localhost') {
    // FastAPI must list this origin before desktop JWTs with this azp will authenticate.
    allowed.add(azp);
    console.info('Desktop session JWT azp is https://tauri.localhost');
  }
  if (!allowed.has(azp)) {
    console.warn('Desktop session JWT azp is not in FastAPI CLERK_AUTHORIZED_PARTIES', { azp });
  }
  return azp;
}

function extractJwt(resource: unknown): string {
  if (typeof resource === 'string' && resource.trim()) return resource.trim();
  if (resource && typeof resource === 'object') {
    const jwt = (resource as { jwt?: unknown }).jwt;
    if (typeof jwt === 'string' && jwt.trim()) return jwt.trim();
  }
  throw new Error('Clerk session token was empty');
}

function mapDesktopAuthProfile(user: ClerkUserRecord): DesktopAuthProfile {
  const email = user.emailAddresses?.find((item) => item.id === user.primaryEmailAddressId)
    ?? user.emailAddresses?.find((item) => item.emailAddress);
  const phone = user.phoneNumbers?.find((item) => item.id === user.primaryPhoneNumberId)
    ?? user.phoneNumbers?.find((item) => item.phoneNumber);
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return {
    id: user.id,
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
    username: user.username ?? null,
    fullName: fullName || null,
    imageUrl: user.imageUrl || '',
    primaryEmailAddress: email?.emailAddress
      ? { emailAddress: email.emailAddress }
      : null,
    primaryPhoneNumber: phone?.phoneNumber
      ? { phoneNumber: phone.phoneNumber }
      : null,
    twoFactorEnabled: Boolean(user.twoFactorEnabled),
  };
}

function assertClerkCanMintSessions(sessions: ClerkSessionApi): void {
  if (typeof sessions.createSession !== 'function' || typeof sessions.getToken !== 'function') {
    throw new Error('Clerk Backend createSession is unavailable');
  }
}

async function clerkSessionApi(): Promise<{ sessions: ClerkSessionApi; users: { getUser: (userId: string) => Promise<ClerkUserRecord> } }> {
  const client = await clerkClient();
  return {
    sessions: client.sessions as ClerkSessionApi,
    users: client.users as { getUser: (userId: string) => Promise<ClerkUserRecord> },
  };
}

async function sessionPayload(
  sessions: ClerkSessionApi,
  users: { getUser: (userId: string) => Promise<ClerkUserRecord> },
  sessionId: string,
  userId: string,
): Promise<DesktopAuthSessionPayload> {
  const accessToken = extractJwt(await sessions.getToken(sessionId));
  verifyMintedSessionTokenAzp(accessToken);
  const user = await users.getUser(userId);
  return {
    accessToken,
    sessionId,
    userId,
    profile: mapDesktopAuthProfile(user),
  };
}

export async function mintDesktopClerkSession(userId: string): Promise<DesktopAuthSessionPayload> {
  const { sessions, users } = await clerkSessionApi();
  assertClerkCanMintSessions(sessions);
  const session = await sessions.createSession!({ userId });
  const sessionId = session.id?.trim() || '';
  if (!sessionId) throw new Error('Clerk createSession did not return a session id');
  return sessionPayload(sessions, users, sessionId, userId);
}

export async function refreshDesktopClerkSession(sessionId: string): Promise<DesktopAuthSessionPayload> {
  const { sessions, users } = await clerkSessionApi();
  if (typeof sessions.getToken !== 'function') {
    throw new Error('Clerk Backend getToken is unavailable');
  }
  const existing = typeof sessions.getSession === 'function'
    ? await sessions.getSession(sessionId)
    : { id: sessionId, userId: '' };
  const userId = existing.userId?.trim()
    || String(decodeJwtPayload(extractJwt(await sessions.getToken(sessionId)))?.sub || '').trim();
  if (!userId) throw new Error('Clerk session refresh did not include a user id');
  return sessionPayload(sessions, users, sessionId, userId);
}
