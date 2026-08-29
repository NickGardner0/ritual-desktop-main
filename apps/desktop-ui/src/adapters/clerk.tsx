import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';

import { getDesktopHostedOrigin } from '@/lib/desktop-auth-origin';
import {
  desktopClearAuthState,
  desktopGetAuthToken,
  openInBrowser,
  type DesktopNativeAuthSession,
} from '@/lib/native-gateway';

type DesktopAuthUser = {
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

type DesktopAuthState = {
  isLoaded: boolean;
  isSignedIn: boolean;
  user: DesktopAuthUser | null;
  userId: string | null;
  sessionId: string | null;
  getToken: (options?: { skipCache?: boolean }) => Promise<string | null>;
  signOut: (options?: { redirectUrl?: string }) => Promise<void>;
  openUserProfile: () => void;
};

const DesktopAuthContext = createContext<DesktopAuthState | null>(null);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function mapNativeProfile(session: DesktopNativeAuthSession | null): DesktopAuthUser | null {
  if (!session?.sessionId || !session.userId) return null;
  const profile = asRecord(session.profile) || {};
  const email = asRecord(profile.primaryEmailAddress);
  const phone = asRecord(profile.primaryPhoneNumber);
  const firstName = typeof profile.firstName === 'string' ? profile.firstName : null;
  const lastName = typeof profile.lastName === 'string' ? profile.lastName : null;
  const username = typeof profile.username === 'string' ? profile.username : null;
  const fullName = typeof profile.fullName === 'string' && profile.fullName
    ? profile.fullName
    : [firstName, lastName].filter(Boolean).join(' ').trim() || null;
  return {
    id: session.userId,
    firstName,
    lastName,
    username,
    fullName,
    imageUrl: typeof profile.imageUrl === 'string' ? profile.imageUrl : '',
    primaryEmailAddress: typeof email?.emailAddress === 'string'
      ? { emailAddress: email.emailAddress }
      : null,
    primaryPhoneNumber: typeof phone?.phoneNumber === 'string'
      ? { phoneNumber: phone.phoneNumber }
      : null,
    twoFactorEnabled: Boolean(profile.twoFactorEnabled),
  };
}

function hasNativeSession(session: DesktopNativeAuthSession | null): boolean {
  return Boolean(session?.sessionId?.trim() && session.userId?.trim() && session.token?.trim());
}

export function DesktopAuthProvider({ children }: { children?: ReactNode }) {
  const router = useRouter();
  const [isLoaded, setIsLoaded] = useState(false);
  const [session, setSession] = useState<DesktopNativeAuthSession | null>(null);

  const applySession = useCallback((next: DesktopNativeAuthSession | null) => {
    setSession(hasNativeSession(next) ? next : null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await desktopGetAuthToken({ refresh: true });
        if (!cancelled) applySession(next);
      } catch {
        if (!cancelled) applySession(null);
      } finally {
        if (!cancelled) setIsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applySession]);

  const getToken = useCallback(async (options?: { skipCache?: boolean }) => {
    try {
      const next = await desktopGetAuthToken({ refresh: Boolean(options?.skipCache) });
      applySession(next);
      return hasNativeSession(next) ? next!.token : null;
    } catch {
      applySession(null);
      return null;
    }
  }, [applySession]);

  const signOut = useCallback(async (options?: { redirectUrl?: string }) => {
    await desktopClearAuthState().catch(() => null);
    applySession(null);
    router.replace(options?.redirectUrl || '/sign-in');
  }, [applySession, router]);

  const openUserProfile = useCallback(() => {
    void openInBrowser(getDesktopHostedOrigin());
  }, []);

  const user = useMemo(() => mapNativeProfile(session), [session]);
  const value = useMemo<DesktopAuthState>(() => ({
    isLoaded,
    isSignedIn: Boolean(user),
    user,
    userId: user?.id ?? null,
    sessionId: session?.sessionId ?? null,
    getToken,
    signOut,
    openUserProfile,
  }), [getToken, isLoaded, openUserProfile, session?.sessionId, signOut, user]);

  return createElement(DesktopAuthContext.Provider, { value }, children);
}

function useDesktopAuth(): DesktopAuthState {
  const value = useContext(DesktopAuthContext);
  if (!value) {
    throw new Error('Desktop auth hooks must be used inside DesktopAuthProvider.');
  }
  return value;
}

export function ClerkProvider({
  children,
}: {
  children?: ReactNode;
  [key: string]: unknown;
}) {
  return createElement(DesktopAuthProvider, null, children);
}

export function useAuth() {
  const auth = useDesktopAuth();
  return {
    isLoaded: auth.isLoaded,
    isSignedIn: auth.isSignedIn,
    userId: auth.userId,
    sessionId: auth.sessionId,
    getToken: auth.getToken,
  };
}

export function useUser() {
  const auth = useDesktopAuth();
  return {
    isLoaded: auth.isLoaded,
    isSignedIn: auth.isSignedIn,
    user: auth.user,
  };
}

export function useClerk() {
  const auth = useDesktopAuth();
  return {
    signOut: auth.signOut,
    openUserProfile: auth.openUserProfile,
  };
}

export function useSession() {
  const auth = useDesktopAuth();
  return {
    isLoaded: auth.isLoaded,
    isSignedIn: auth.isSignedIn,
    session: auth.sessionId ? { id: auth.sessionId } : null,
  };
}

export function useSignIn() {
  return {
    isLoaded: true,
    signIn: {
      create: async () => {
        throw new Error('Desktop native sessions do not activate Clerk tickets in the webview.');
      },
    },
    setActive: async () => {},
  };
}

export function useSignUp() {
  return {
    isLoaded: true,
    signUp: {
      create: async () => {
        throw new Error('Desktop native sessions do not start Clerk sign-up in the webview.');
      },
    },
    setActive: async () => {},
  };
}

export function SignedIn({ children }: { children?: ReactNode }) {
  const { isLoaded, isSignedIn } = useUser();
  if (!isLoaded || !isSignedIn) return null;
  return children;
}

export function SignedOut({ children }: { children?: ReactNode }) {
  const { isLoaded, isSignedIn } = useUser();
  if (!isLoaded || isSignedIn) return null;
  return children;
}

export function ClerkLoaded({ children }: { children?: ReactNode }) {
  const { isLoaded } = useUser();
  return isLoaded ? children : null;
}

export function ClerkLoading({ children }: { children?: ReactNode }) {
  const { isLoaded } = useUser();
  return isLoaded ? null : children;
}

export function SignIn() {
  return null;
}

export function SignUp() {
  return null;
}

export function SignInButton({ children }: { children?: ReactNode }) {
  return children ?? null;
}

export function SignUpButton({ children }: { children?: ReactNode }) {
  return children ?? null;
}

export function SignOutButton({ children }: { children?: ReactNode }) {
  const { signOut } = useClerk();
  return createElement('button', { type: 'button', onClick: () => void signOut() }, children);
}

export function UserButton() {
  return null;
}

export function AuthenticateWithRedirectCallback() {
  return null;
}
