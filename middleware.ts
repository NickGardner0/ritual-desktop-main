import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublicRoute = createRouteMatcher([
  '/',
  '/auth(.*)',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/sso-callback(.*)',
  '/api/integrations/whoop/callback(.*)', // Public for OAuth callback
  '/api/integrations/whoop/store-code(.*)', // Public for OAuth polling
  '/integrations/success(.*)', // Public for OAuth success page (closes browser)
  '/sentry-test(.*)', // Public for testing Sentry error tracking
  // Removed /api/chat/habits and /api/whisper from public routes
  // These routes now require authentication
]);

export default clerkMiddleware(async (auth, req) => {
  // Only protect non-public routes
  // Let Clerk handle its own redirects for token refresh
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
