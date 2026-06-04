import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const DESKTOP_USER_AGENT_FRAGMENT = 'RitualDesktop/';

const isPublicRoute = createRouteMatcher([
  '/',
  '/monitoring(.*)',
  '/desktop-only(.*)',
  '/privacy(.*)',
  '/data-retention(.*)',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/auth/callback(.*)',
  '/auth/sso-callback(.*)',
  '/auth/desktop-start-oauth(.*)',
  '/auth/desktop-oauth-bridge(.*)',
  '/api/auth/desktop-sign-in-token(.*)',
  '/api/integrations/whoop/callback(.*)',
  '/api/integrations/whoop/store-code(.*)',
  '/api/sendblue/webhook(.*)',
  '/api/chat/sms(.*)',
  '/integrations/success(.*)',
  '/integrations(.*)',
]);

export const proxy = clerkMiddleware(async (auth, req) => {
  const isProduction = process.env.NODE_ENV === 'production';
  const userAgent = req.headers.get('user-agent') || '';
  const isDesktopRequest = userAgent.includes(DESKTOP_USER_AGENT_FRAGMENT);

  if (isProduction && !isDesktopRequest && !isPublicRoute(req)) {
    if (req.nextUrl.pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Ritual desktop routes are only available inside the macOS app.' },
        { status: 403 },
      );
    }

    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = '/desktop-only';
    redirectUrl.search = '';
    return NextResponse.redirect(redirectUrl);
  }

  if (!isPublicRoute(req)) {
    const { userId } = await auth();
    if (!userId) {
      if (req.nextUrl.pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const redirectUrl = req.nextUrl.clone();
      redirectUrl.pathname = '/sign-in';
      redirectUrl.search = '';
      return NextResponse.redirect(redirectUrl);
    }
  }
}, {
  publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  debug: false,
});

export default proxy;

export const config = {
  matcher: [
    '/((?!_next|monitoring|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
