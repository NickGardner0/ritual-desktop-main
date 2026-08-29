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

export type ClerkSessionRecord = {
  id?: string | null;
  userId?: string | null;
  status?: string | null;
  createdAt?: number | Date | null;
};

type ClerkSessionListResult =
  | ClerkSessionRecord[]
  | { data?: ClerkSessionRecord[] | null };

type ClerkSessionApi = {
  getSessionList?: (params: {
    userId: string;
    status?: string;
    limit?: number;
  }) => Promise<ClerkSessionListResult>;
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

export function unwrapClerkSessionList(listed: unknown): ClerkSessionRecord[] {
  if (Array.isArray(listed)) return listed;
  if (listed && typeof listed === 'object') {
    const data = (listed as { data?: unknown }).data;
    if (Array.isArray(data)) return data;
  }
  return [];
}

function sessionCreatedAtMs(session: ClerkSessionRecord): number {
  const value = session.createdAt;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getTime();
  return 0;
}

export function selectActiveClerkSessionId(sessions: ClerkSessionRecord[]): string {
  const usable = sessions.filter((session) => {
    if (!session.id?.trim()) return false;
    const status = (session.status || 'active').toLowerCase();
    return status === 'active';
  });
  usable.sort((left, right) => sessionCreatedAtMs(right) - sessionCreatedAtMs(left));
  return usable[0]?.id?.trim() || '';
}

function describeClerkError(error: unknown): string {
  if (error && typeof error === 'object') {
    const candidate = error as {
      message?: string;
      status?: number;
      errors?: Array<{ code?: string; message?: string }>;
    };
    const details = (candidate.errors || [])
      .map((item) => item.code || item.message)
      .filter(Boolean)
      .join('; ');
    return [candidate.status ? `status ${candidate.status}` : '', candidate.message, details]
      .filter(Boolean)
      .join(' — ') || 'unknown Clerk error';
  }
  return error instanceof Error ? error.message : String(error);
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
  if (typeof sessions.getSessionList !== 'function' || typeof sessions.getToken !== 'function') {
    throw new Error('Clerk Backend getSessionList/getToken is unavailable');
  }
}

async function existingDesktopSessionId(
  sessions: ClerkSessionApi,
  userId: string,
): Promise<string> {
  const active = unwrapClerkSessionList(
    await sessions.getSessionList!({ userId, status: 'active', limit: 20 }),
  );
  const activeId = selectActiveClerkSessionId(active);
  if (activeId) return activeId;

  const recent = unwrapClerkSessionList(
    await sessions.getSessionList!({ userId, limit: 20 }),
  );
  const recentId = selectActiveClerkSessionId(recent);
  if (recentId) return recentId;

  throw new Error(
    'No active Clerk session exists for this user. Production Clerk instances cannot createSession; the browser OAuth session must still be active.',
  );
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
  try {
    const sessionId = await existingDesktopSessionId(sessions, userId);
    return await sessionPayload(sessions, users, sessionId, userId);
  } catch (error) {
    throw new Error(`Desktop Clerk session mint failed: ${describeClerkError(error)}`);
  }
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
