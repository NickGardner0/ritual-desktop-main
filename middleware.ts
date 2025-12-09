import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublicRoute = createRouteMatcher([
  '/',
  '/welcome(.*)',
  '/onboarding(.*)',
  '/auth(.*)',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/sso-callback(.*)',
  '/api/integrations/whoop/callback(.*)', // Public for OAuth callback
  '/api/integrations/whoop/store-code(.*)', // Public for OAuth polling
  '/integrations/success(.*)', // Public for OAuth success page (closes browser)
  // Note: /api/chat/stream handles auth internally via Bearer token
  // Note: Debug routes (/debug, /api/debug/*) are protected by default
]);

export default clerkMiddleware(async (auth, req) => {
  // Only protect non-public routes
  // Let Clerk handle its own redirects for token refresh
  if (!isPublicRoute(req)) {
    try {
      await auth.protect();
    } catch (error) {
      // If auth.protect fails, log but don't crash
      console.error('Auth protection error:', error);
      // Let the request continue to avoid infinite loops
    }
  }
}, {
  // Add these options to prevent infinite redirects
  publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  debug: false // Set to true if you need to debug Clerk issues
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
