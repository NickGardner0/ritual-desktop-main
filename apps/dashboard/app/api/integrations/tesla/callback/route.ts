/**
 * Tesla OAuth Callback Handler
 *
 * Redirects the OAuth code to the frontend (web) or success page (desktop).
 * The frontend then exchanges the code with the Python backend.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const error = searchParams.get('error');
    const state = searchParams.get('state');

    let source = 'web';
    let sessionId: string | null = null;
    let sessionToken: string | null = null;
    try {
      if (state) {
        const stateData = JSON.parse(atob(state));
        source = stateData.source || 'web';
        sessionId = stateData.sessionId || null;
        sessionToken = stateData.sessionToken || null;
      }
    } catch {
      console.warn('Could not decode Tesla state parameter');
    }

    if (error) {
      console.error('Tesla OAuth error:', error);
      const errorDescription = searchParams.get('error_description') || error;

      if (source === 'desktop') {
        const errorUrl = new URL('/integrations/success', request.url);
        errorUrl.searchParams.set('error', errorDescription);
        if (sessionId) errorUrl.searchParams.set('sessionId', sessionId);
        if (sessionToken) errorUrl.searchParams.set('sessionToken', sessionToken);
        return NextResponse.redirect(errorUrl);
      }

      return NextResponse.redirect(
        new URL(`/integrations?tesla_error=${encodeURIComponent(errorDescription)}`, request.url),
      );
    }

    if (!code) {
      if (source === 'desktop') {
        const errorUrl = new URL('/integrations/success', request.url);
        errorUrl.searchParams.set('error', 'no_code');
        if (sessionId) errorUrl.searchParams.set('sessionId', sessionId);
        if (sessionToken) errorUrl.searchParams.set('sessionToken', sessionToken);
        return NextResponse.redirect(errorUrl);
      }
      return NextResponse.redirect(new URL('/integrations?tesla_error=no_code', request.url));
    }

    if (source === 'desktop') {
      const successUrl = new URL('/integrations/success', request.url);
      successUrl.searchParams.set('code', code);
      successUrl.searchParams.set('provider', 'tesla');
      if (sessionId) successUrl.searchParams.set('sessionId', sessionId);
      if (sessionToken) successUrl.searchParams.set('sessionToken', sessionToken);
      return NextResponse.redirect(successUrl);
    }

    return NextResponse.redirect(new URL(`/integrations?tesla_code=${code}`, request.url));
  } catch (error) {
    console.error('Tesla callback error:', error);
    return NextResponse.redirect(
      new URL(`/integrations?tesla_error=${encodeURIComponent(String(error))}`, request.url),
    );
  }
}
