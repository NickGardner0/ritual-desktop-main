import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Database } from '@/types/supabase';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const error = searchParams.get('error');
    const state = searchParams.get('state');

    // Handle OAuth errors
    if (error) {
      console.error('❌ Whoop OAuth error:', error);
      const errorDescription = searchParams.get('error_description') || error;
      return NextResponse.redirect(
        new URL(`/integrations?error=${encodeURIComponent(errorDescription)}`, request.url)
      );
    }

    if (!code) {
      return NextResponse.redirect(
        new URL('/integrations?error=no_code', request.url)
      );
    }

    // Note: In a production app, you should validate the state parameter
    // For now, we'll just log it
    console.log('🔐 Received state:', state);
    console.log('🔑 Received authorization code:', code);

    const clientId = process.env.WHOOP_CLIENT_ID;
    const clientSecret = process.env.WHOOP_CLIENT_SECRET;
    const redirectUri = process.env.NEXT_PUBLIC_WHOOP_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error('Whoop configuration missing');
    }

    // Exchange authorization code for access token
    const tokenResponse = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error('❌ Whoop token exchange failed:', errorData);
      throw new Error('Failed to exchange authorization code');
    }

    const tokenData = await tokenResponse.json();
    console.log('🔑 Token response:', JSON.stringify(tokenData, null, 2));
    
    const { access_token, refresh_token, expires_in } = tokenData;

    if (!access_token) {
      console.error('❌ No access token in response');
      throw new Error('No access token received from Whoop');
    }

    // Calculate token expiration time (default to 1 hour if not provided)
    const expiresAt = new Date(Date.now() + (expires_in || 3600) * 1000).toISOString();

    // Get user info from Whoop API
    const userInfoResponse = await fetch('https://api.prod.whoop.com/developer/v1/user/profile/basic', {
      headers: {
        'Authorization': `Bearer ${access_token}`,
      },
    });

    let whoopUserId = null;
    if (userInfoResponse.ok) {
      const userInfo = await userInfoResponse.json();
      whoopUserId = userInfo.user_id?.toString() || null;
    }

    // Extract user ID from the state parameter
    // State format: randomString:userId
    const supabase = createClient<Database>(supabaseUrl, supabaseServiceKey);
    
    let userId: string | null = null;
    
    if (state) {
      const stateParts = state.split(':');
      if (stateParts.length === 2) {
        userId = stateParts[1];
        console.log('✅ Extracted user ID from state:', userId);
      }
    }
    
    if (!userId) {
      console.error('❌ No user ID found in state parameter');
      return NextResponse.redirect(
        new URL('/integrations?error=auth_failed', request.url)
      );
    }

    // Store the connection in Supabase
    const { data: connection, error: dbError } = await supabase
      .from('whoop_connections')
      .upsert({
        user_id: userId,
        access_token,
        refresh_token: refresh_token || access_token, // Use access_token as fallback if no refresh_token
        token_expires_at: expiresAt,
        whoop_user_id: whoopUserId,
        is_active: true,
        last_synced_at: null,
      }, {
        onConflict: 'user_id',
      })
      .select()
      .single();

    if (dbError) {
      console.error('❌ Failed to store Whoop connection:', dbError);
      throw new Error('Failed to save connection');
    }

    console.log('✅ Whoop connection saved successfully:', connection.id);

    // Redirect back to integrations page with success message
    return NextResponse.redirect(
      new URL('/integrations?connected=whoop', request.url)
    );
  } catch (error) {
    console.error('❌ Whoop callback error:', error);
    return NextResponse.redirect(
      new URL('/integrations?error=callback_failed', request.url)
    );
  }
}

