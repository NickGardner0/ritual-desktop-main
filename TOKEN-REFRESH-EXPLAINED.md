# Token Refresh System - How It Works

## The Problem

Clerk JWT tokens expire quickly (typically 1-5 minutes) for security. When a user:
1. Opens the timer (token written)
2. Works for 2+ minutes
3. Stops the timer (token expired!)
4. Gets 401 authentication error ❌

## The Solution

Implemented an inter-process communication system using temporary files.

## Architecture

```
┌─────────────────┐      ┌──────────────────┐      ┌────────────────┐
│  Tauri/React    │      │   Temp Files     │      │  Swift Widget  │
│  (Dashboard)    │      │                  │      │  (Timer)       │
└─────────────────┘      └──────────────────┘      └────────────────┘
        │                          │                         │
        │  1. Write Token          │                         │
        ├─────────────────────────>│                         │
        │                          │  2. Read Token          │
        │                          │<────────────────────────│
        │                          │                         │
        │                          │  3. Timer Running...    │
        │                          │                         │
        │                          │  4. Write Refresh Req   │
        │                          │<────────────────────────│
        │  5. Poll & Detect        │                         │
        │<─────────────────────────│                         │
        │  6. Get Fresh Token      │                         │
        │  7. Write Fresh Token    │                         │
        ├─────────────────────────>│                         │
        │                          │  8. Read Fresh Token    │
        │                          │<────────────────────────│
        │                          │  9. Save Log (Success!) │
        │                          │                         │
```

## Files Used

All files are in `/var/folders/.../T/` (macOS temp directory):

### 1. `ritual_auth_token.txt`
- **Written by:** Dashboard (Tauri/React)
- **Read by:** Swift Widget
- **Contains:** Current Clerk JWT token
- **Updated:** When dashboard starts, and when refresh requested

### 2. `ritual_refresh_token_request.txt`
- **Written by:** Swift Widget
- **Read by:** Dashboard (Tauri/React)
- **Contains:** Timestamp of refresh request
- **Deleted:** After dashboard reads it

### 3. `ritual_timer_updated.txt`
- **Written by:** Swift Widget
- **Read by:** Dashboard (Tauri/React)
- **Contains:** Timestamp of last timer completion
- **Purpose:** Trigger dashboard to refresh habit data

## Code Flow

### When Timer Opens (Initial Token)

```typescript
// dashboard-layout.tsx
const openTimeTrackerWindow = async () => {
  const token = await getToken(); // Get Clerk token
  await invoke('write_auth_token_to_file', { token });
  await invoke('create_native_timer_widget');
}
```

```rust
// native_widget.rs
pub async fn write_auth_token_to_file(token: String) -> Result<String, String> {
    let token_file = temp_dir().join("ritual_auth_token.txt");
    fs::write(&token_file, &token)?;
    Ok(...)
}
```

### When Timer Stops (Token Refresh)

```swift
// TimerWidgetApp.swift
func logTimeToHabit() {
    // 1. Request fresh token
    requestFreshAuthToken()  // Writes ritual_refresh_token_request.txt
    
    // 2. Wait for fresh token
    waitForFreshToken { _ in
        // 3. Send log with fresh token
        self?.sendTimeLogToBackend(...)
    }
}
```

```typescript
// dashboard-layout.tsx
useEffect(() => {
    const checkForTokenRefreshRequests = async () => {
        const timestamp = await invoke('check_token_refresh_request');
        
        if (timestamp > 0 && timestamp !== lastTokenRefreshCheck) {
            // Fresh token requested!
            const token = await getToken(); // Get NEW Clerk token
            await invoke('write_auth_token_to_file', { token });
        }
    };
    
    // Poll every 500ms
    const interval = setInterval(checkForTokenRefreshRequests, 500);
    return () => clearInterval(interval);
}, [getToken, lastTokenRefreshCheck]);
```

## Why This Approach?

### Alternative Approaches Considered:

1. **Use longer-lived tokens** ❌
   - Security risk
   - Clerk doesn't support this well

2. **Swift calls Tauri commands directly** ❌
   - Swift widget is separate process
   - Can't access Tauri's IPC

3. **Use sockets/XPC** ❌
   - Overcomplicated
   - More dependencies

4. **Refresh token on timer** ❌
   - Would refresh every second (wasteful)
   - Token might still expire between refresh and use

### Why File Polling Works:

✅ **Simple** - No complex IPC needed
✅ **Reliable** - Filesystem is fast and reliable
✅ **Cross-process** - Works between separate processes
✅ **On-demand** - Only refreshes when needed
✅ **Lightweight** - 500ms polling is negligible
✅ **Portable** - Works on all platforms

## Performance

- **Polling frequency:** 500ms (2 checks per second)
- **Overhead:** Negligible (< 0.1ms per check)
- **Token size:** ~1-2KB
- **Disk writes:** Only when refresh needed (not every 500ms)

## Security

- Tokens stored in OS temp directory (cleared on reboot)
- Tokens have short lifespan (1-5 minutes)
- Only current user can read temp directory
- Token is deleted when app closes

## Testing

To verify it works:

1. Open timer
2. Wait 2+ minutes (let token expire)
3. Stop timer
4. Check backend logs - should see fresh token being used
5. Check database - log should be saved successfully!

## Debugging

If token refresh fails, check:

1. **Dashboard console:**
   ```
   🔄 Token refresh requested by Swift widget, writing fresh token...
   ✅ Fresh token written for Swift widget
   ```

2. **Swift logs:**
   ```
   🔄 Requesting fresh auth token before logging...
   🔐 Using Clerk authentication for habit log creation
   ```

3. **Backend logs:**
   ```
   INFO: 127.0.0.1:52255 - "POST /api/habits/{id}/logs HTTP/1.1" 200 OK
   ```

4. **Check temp files:**
   ```bash
   ls -la /tmp/ritual_*
   cat /tmp/ritual_auth_token.txt  # Should see JWT token
   ```

