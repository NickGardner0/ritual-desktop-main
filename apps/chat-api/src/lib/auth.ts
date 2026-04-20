import { createRemoteJWKSet, jwtVerify } from 'jose';

export class UnauthorizedError extends Error {
  status = 401;
}

function resolveClerkJwksUrl(): string {
  const explicitUrl = (process.env.CLERK_JWKS_URL || '').trim();
  if (explicitUrl) return explicitUrl;

  const signInUrl = (process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL || '').trim();
  if (signInUrl) {
    const frontendDomain = signInUrl.replace('https://', '').replace('/sign-in', '').split('/')[0];
    return `https://${frontendDomain}/.well-known/jwks.json`;
  }

  return 'https://api.clerk.com/v1/jwks';
}

const jwks = createRemoteJWKSet(new URL(resolveClerkJwksUrl()));

export function extractBearerToken(authorizationHeader: string | null | undefined): string | null {
  const authHeader = authorizationHeader || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return null;
  }

  const token = authHeader.slice(7).trim();
  return token || null;
}

export async function verifyBearerToken(authorizationHeader: string | null | undefined): Promise<string> {
  const token = extractBearerToken(authorizationHeader);
  if (!token) {
    throw new UnauthorizedError('Missing Bearer token');
  }

  try {
    await jwtVerify(token, jwks, {
      algorithms: ['RS256'],
    });
    return token;
  } catch (error) {
    throw new UnauthorizedError(
      error instanceof Error ? error.message : 'Invalid Bearer token',
    );
  }
}
