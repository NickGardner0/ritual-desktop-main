# Desktop OAuth Fix for Whoop Integration

## Problems Fixed

### Problem 1: Connection Not Syncing to Desktop App
When clicking "Connect" for Whoop in the desktop app:
1. OAuth page opened in system browser ✅
2. After completing OAuth, the connection was saved in the **browser version** of the app
3. The **desktop app** remained disconnected ❌

### Problem 2: Full App Showing in Browser
After OAuth completion, users would see the full app interface in their browser instead of just staying in the desktop app. This was confusing and not the intended UX.

## Solution

### Part 1: Automatic Polling (Syncs Connection to Desktop)
1. User clicks "Connect" in desktop app
2. OAuth opens in system's default browser (Safari, Chrome, etc.)
3. Desktop app immediately starts polling the backend every 2 seconds
4. User completes OAuth in browser
5. Backend receives and stores the connection
6. Desktop app detects the connection through polling
7. Desktop app updates UI and shows success message ✅

### Part 2: Session-Based Code Transfer (Fixes Browser Auth Issue)
The challenge was that the browser doesn't have the user's Clerk auth token (separate session from desktop app), so it couldn't exchange the OAuth code with the backend.

Solution:
1. Desktop app generates a unique session ID when starting OAuth
2. Session ID is encoded in OAuth state parameter
3. After OAuth, callback redirects to `/integrations/success?code=XXX&sessionId=YYY`
4. Success page **stores** the code temporarily (no auth required)
5. Desktop app's polling **retrieves** the code using session ID
6. Desktop app (which has auth) **exchanges** the code with Python backend
7. Success page attempts to auto-close browser tab
8. User never sees the full app interface in browser ✅

## Technical Changes

### File: `app/(dashboard)/integrations/page.tsx`

#### 1. Encode Source in State Parameter
```typescript
// Encode source (desktop/web) in state parameter
const stateData = {
  random: randomState,
  source: isTauri() ? 'desktop' : 'web'
}
const state = btoa(JSON.stringify(stateData))
```

#### 2. Added Polling Mechanism
```typescript
// Polls backend every 2 seconds to check if user completed OAuth
function startPollingForConnection() {
  // Polls up to 60 times (2 minutes max)
  // Automatically stops when connection is detected
  // Shows success message when connected
}
```

#### 3. Updated Connect Handler
```typescript
async function handleWhoopConnect() {
  // Opens OAuth in system browser with source in state
  await openInBrowser(authUrl.toString())
  
  // Only poll in desktop mode (web uses standard redirect)
  if (isTauri()) {
    startPollingForConnection()
  }
}
```

### File: `app/api/integrations/whoop/callback/route.ts`

#### 1. Decode State to Check Source
```typescript
// Decode state parameter to see if from desktop or web
let source = 'web';
if (state) {
  const stateData = JSON.parse(atob(state));
  source = stateData.source || 'web';
}
```

#### 2. Redirect Based on Source
```typescript
if (source === 'desktop') {
  // Redirect to minimal success page
  return NextResponse.redirect(
    new URL(`/integrations/success?code=${code}`, request.url)
  );
} else {
  // Redirect to full integrations page
  return NextResponse.redirect(
    new URL(`/integrations?whoop_code=${code}`, request.url)
  );
}
```

### File: `app/integrations/success/page.tsx` (NEW)

#### Minimal Success Page for Desktop Users
```typescript
// Stores OAuth code temporarily (no auth required)
// Shows simple success message
// Attempts to auto-close browser tab
export default function IntegrationSuccessPage() {
  // 1. Receives code + sessionId from URL
  // 2. Stores code in temporary storage
  // 3. Shows success message
  // 4. Tries to close window
  // 5. User returns to desktop app
}
```

### File: `app/api/integrations/whoop/store-code/route.ts` (NEW)

#### Temporary Code Storage Endpoint
```typescript
// Stores OAuth codes temporarily (no auth required)
// Desktop app retrieves codes using session ID
const codeStore = new Map<sessionId, {code, timestamp}>();

// POST: Store code with session ID
// GET: Retrieve code by session ID (one-time use)
// Auto-cleanup: Removes codes older than 5 minutes
```

## User Experience Flow

### Desktop App (Tauri)
1. Click "Connect" → Shows "Connecting..." spinner
2. Desktop app generates unique session ID
3. Browser opens with Whoop OAuth page
4. Complete authentication in browser
5. **Browser shows minimal success page** (not full app) 📱
6. Success page stores OAuth code with session ID
7. Success page attempts to auto-close
8. Desktop app's polling retrieves the stored code
9. Desktop app exchanges code with Python backend
10. Shows success alert: "✅ Whoop connected successfully!"
11. User continues in desktop app ✅

### Web App (Browser)
1. Click "Connect" → Opens OAuth in new tab
2. Complete authentication
3. Redirects back to full integrations page
4. Standard OAuth redirect flow (no polling needed)

## Fallback Handling

If polling times out after 2 minutes:
- Performs one final connection check
- If still not connected, shows message: "⏱️ Connection timeout. If you completed the authorization in your browser, please refresh the page."
- User can manually refresh to see connection status

## Benefits

✅ **No Whoop API changes needed** - Still uses standard OAuth flow
✅ **Works for both web and desktop** - Smart detection of environment via state parameter
✅ **Solves browser auth issue** - Session-based code transfer (no auth required in browser)
✅ **Automatic detection** - Desktop app polls and retrieves stored codes
✅ **Clean browser experience** - Desktop users never see full app in browser
✅ **Auto-closing tab** - Attempts to close browser tab automatically
✅ **Secure** - Codes expire after 5 minutes, one-time use only
✅ **Simple** - In-memory storage (no database changes needed)
✅ **Clear messaging** - Simple "return to desktop app" message
✅ **Good UX** - Clear feedback at every step

## Testing

To test desktop flow:
1. Start desktop app: `npm run desktop`
2. Go to Integrations page
3. Click "Connect" on Whoop
4. OAuth should open in your default browser
5. Complete Whoop authentication
6. **Browser shows simple success page** (not full app)
7. Browser tab attempts to auto-close
8. Within 2-4 seconds, **desktop app shows success message**

To test web flow:
1. Open browser to `http://localhost:3000`
2. Go to Integrations page
3. Click "Connect" on Whoop
4. Complete OAuth in new tab
5. **Redirects back to full integrations page** (normal web flow)

## Alternative Solutions Considered

1. **Deep Links (`ritual://`)** - Would require changing Whoop OAuth app config
2. **WebSocket Push** - More complex, overkill for this use case
3. **Manual Return Button** - Poor UX, requires user action

The polling solution is the best balance of simplicity and user experience.

