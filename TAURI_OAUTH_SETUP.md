# Tauri OAuth Setup Guide

This guide explains how to configure OAuth (Google, Apple, etc.) to work properly in your Tauri desktop app.

## How It Works

When running in Tauri:
1. User clicks "Continue with Google" in the app
2. The OAuth handler intercepts the request
3. Google auth opens in your **system's default browser** (Safari, Chrome, etc.)
4. After authentication, Google redirects back to Clerk
5. Clerk redirects to your callback URL
6. The app completes the authentication

## Setup Steps

### 1. Configure Clerk Dashboard

1. Go to your [Clerk Dashboard](https://dashboard.clerk.com/)
2. Select your application
3. Navigate to **"Paths"** in the left sidebar
4. Under **"Sign-in"**, verify the redirect URL is set to:
   ```
   http://localhost:3000/auth/sso-callback
   ```

### 2. Test OAuth Flow

1. Start your Next.js dev server:
   ```bash
   npm run dev
   ```

2. Start Tauri in a separate terminal:
   ```bash
   npm run desktop
   ```

3. Click "Get Started" and then click "Continue with Google"

4. Your default browser should open with the Google sign-in page

5. After signing in with Google, you should be redirected back to the app

## Troubleshooting

### OAuth doesn't open in browser

**Check the console logs:**
- Look for `🔐 Configuring Tauri to open OAuth in system browser`
- Look for `🌐 window.open intercepted: [url]`
- Look for `🔐 OAuth URL detected, opening in system browser`

If you don't see these logs, the ClerkOAuthHandler component isn't loading.

### Browser opens but doesn't redirect back

This is expected behavior for now. After you authenticate in the browser:

1. The browser will show a success page or redirect to localhost
2. **Manually go back to your desktop app**
3. On the auth page, click "Continue with Google" again
4. Clerk should recognize you're already authenticated and log you in

### Future Enhancement: Deep Link Support

For a seamless experience where the browser automatically switches back to the app after auth, you would need to:

1. Register the `ritual://` deep link protocol (already done)
2. Configure Clerk to redirect to `ritual://auth/callback` instead of `http://localhost:3000/auth/callback`
3. This requires updating your Clerk redirect URLs in the dashboard

However, this requires **custom domains** and **production Clerk setup**, so we'll stick with the manual approach for development.

## Production Considerations

For production builds:

1. **Update redirect URLs** in Clerk dashboard to use your production domain
2. **Configure deep links** for seamless browser-to-app transitions
3. **Add error handling** for cases where the browser doesn't open
4. **Test on all platforms** (macOS, Windows, Linux)

## Files Modified

- `/src-tauri/tauri.conf.json` - Added deep link protocol registration
- `/src-tauri/src/main.rs` - Added deep link event handling
- `/lib/tauri-utils.ts` - Utility functions for Tauri detection
- `/components/clerk-oauth-handler.tsx` - OAuth interception for external browser
- `/app/auth/[[...rest]]/page.tsx` - Added OAuth handler component

## Technical Details

The OAuth handler works by:

1. **Detecting Tauri environment** using `window.__TAURI__`
2. **Overriding `window.open`** to intercept OAuth popups
3. **Detecting OAuth URLs** (accounts.google.com, appleid.apple.com, etc.)
4. **Using Tauri's shell API** to open URLs in the system browser
5. **Allowing non-OAuth URLs** to open normally

This approach is non-invasive and doesn't require changes to Clerk's core functionality.

