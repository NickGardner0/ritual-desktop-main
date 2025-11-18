/**
 * Whoop OAuth Callback Handler
 * 
 * This is now a simple redirect handler that passes the OAuth code
 * to the frontend, which will then send it to the Python backend.
 * 
 * Migration Note: No longer uses Supabase - all integration logic
 * is now handled by the Python FastAPI backend.
 */

import { NextRequest, NextResponse } from 'next/server';

// Force dynamic rendering since we use searchParams
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const error = searchParams.get('error');
    const state = searchParams.get('state');

    // Decode state to check if request came from desktop app and get session ID
    let source = 'web'; // default to web
    let sessionId = null;
    try {
      if (state) {
        const stateData = JSON.parse(atob(state));
        source = stateData.source || 'web';
        sessionId = stateData.sessionId || null;
      }
    } catch (e) {
      console.warn('Could not decode state parameter:', e);
    }

    console.log(`📱 OAuth callback from: ${source}${sessionId ? ` (session: ${sessionId})` : ''}`);

    // Handle OAuth errors
    if (error) {
      console.error('❌ Whoop OAuth error:', error);
      const errorDescription = searchParams.get('error_description') || error;
      
      // For desktop app, redirect to success page with error
      if (source === 'desktop') {
        const errorUrl = new URL('/integrations/success', request.url);
        errorUrl.searchParams.set('error', errorDescription);
        if (sessionId) errorUrl.searchParams.set('sessionId', sessionId);
        return NextResponse.redirect(errorUrl);
      }
      
      return NextResponse.redirect(
        new URL(`/integrations?whoop_error=${encodeURIComponent(errorDescription)}`, request.url)
      );
    }

    if (!code) {
      console.error('❌ No authorization code received from Whoop');
      
      // For desktop app, redirect to success page with error
      if (source === 'desktop') {
        const errorUrl = new URL('/integrations/success', request.url);
        errorUrl.searchParams.set('error', 'no_code');
        if (sessionId) errorUrl.searchParams.set('sessionId', sessionId);
        return NextResponse.redirect(errorUrl);
      }
      
      return NextResponse.redirect(
        new URL('/integrations?whoop_error=no_code', request.url)
      );
    }

    console.log('✅ Whoop OAuth code received');

    // For desktop app: Redirect to success page with code and session ID
    // The success page will store the code, and the desktop app's polling will retrieve it
    if (source === 'desktop') {
      console.log('📱 Desktop source detected - redirecting to success page');
      
      const successUrl = new URL('/integrations/success', request.url);
      successUrl.searchParams.set('code', code);
      if (sessionId) {
        successUrl.searchParams.set('sessionId', sessionId);
        console.log(`🎫 Passing session ID to success page: ${sessionId}`);
      }
      
      return NextResponse.redirect(successUrl);
    }

    // For web app: Redirect to integrations page with the code
    // The frontend will handle exchanging it with the Python backend
    console.log('🌐 Web source detected - redirecting to integrations page');
    return NextResponse.redirect(
      new URL(`/integrations?whoop_code=${code}`, request.url)
    );
    
  } catch (error) {
    console.error('❌ Whoop callback error:', error);
    return NextResponse.redirect(
      new URL(`/integrations?whoop_error=${encodeURIComponent(String(error))}`, request.url)
    );
  }
}
