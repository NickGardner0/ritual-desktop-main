import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isPublicRoute = createRouteMatcher([
  '/',
  '/welcome(.*)',
  '/onboarding(.*)',
  '/auth(.*)',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/sso-callback(.*)',
  '/api/integrations/whoop/callback(.*)',
  '/api/integrations/whoop/store-code(.*)',
  '/integrations/success(.*)',
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    const { userId } = await auth();
    if (!userId) {
      // No valid session. Don't call auth.protect() which throws a
      // NEXT_REDIRECT that the framework intercepts even inside try/catch.
      // The desktop app handles auth client-side via ClerkProvider; web
      // users landing here without a session will see the client-side
      // sign-in flow instead of an infinite redirect loop.
      return NextResponse.next();
    }
  }
}, {
  publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  debug: false,
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
