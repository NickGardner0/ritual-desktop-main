import {
  ClerkProvider as ClerkReactProvider,
  SignedIn,
  SignedOut,
  SignIn,
  SignUp,
  SignInButton,
  SignUpButton,
  SignOutButton,
  UserButton,
  useAuth,
  useUser,
  useClerk,
  useSignIn,
  useSignUp,
  useSession,
  AuthenticateWithRedirectCallback,
  ClerkLoaded,
  ClerkLoading,
} from '@clerk/clerk-react';
import type { ComponentProps } from 'react';

export function ClerkProvider(props: ComponentProps<typeof ClerkReactProvider>) {
  const publishableKey =
    props.publishableKey
    || (import.meta.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY as string | undefined)
    || (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined)
    || '';
  return <ClerkReactProvider {...props} publishableKey={publishableKey} />;
}

export {
  SignedIn,
  SignedOut,
  SignIn,
  SignUp,
  SignInButton,
  SignUpButton,
  SignOutButton,
  UserButton,
  useAuth,
  useUser,
  useClerk,
  useSignIn,
  useSignUp,
  useSession,
  AuthenticateWithRedirectCallback,
  ClerkLoaded,
  ClerkLoading,
};
