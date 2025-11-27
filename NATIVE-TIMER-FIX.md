# Native Timer Fix - Summary

## Issues Fixed

### 1. **Habits Not Loading** ❌ → ✅
**Problem:** The Swift timer widget was hardcoded to fetch habits from Supabase, but your app uses a Python FastAPI backend.

**Fix:** Updated `TimerWidgetApp.swift` to:
- Fetch habits from `http://127.0.0.1:8000/api/habits` (Python backend)
- Use Clerk authentication token (not Supabase keys)

### 2. **Wrong User ID in Logs** ❌ → ✅
**Problem:** Timer logs were being saved with a hardcoded user ID, so all users would see each other's timer sessions!

**Fix:** Updated `TimerWidgetApp.swift` to:
- Send logs to Python backend API (`/api/habits/{habit_id}/logs`) instead of directly to Tinybird
- Let the backend extract the user ID from the Clerk JWT token
- This ensures each user only sees their own data

### 3. **Token Expiration** ❌ → ✅ (Critical!)
**Problem:** Clerk JWT tokens expire quickly (often within 1 minute). The token was written when the timer opened, but by the time the user stopped the timer, it had expired, causing a 401 authentication error.

**Fix:** Implemented automatic token refresh:
- Swift widget writes a "refresh request" file before logging
- Dashboard monitors for refresh requests every 500ms
- When detected, dashboard gets a fresh Clerk token and writes it to the temp file
- Swift widget then uses the fresh token to save the log

### 4. **Redundant Files Cluttering Directory** ❌ → ✅
**Problem:** The `native-timer` directory had 5 redundant Swift files that weren't being used.

**Fix:** Removed:
- `NativeTimer.swift` (alternative timer implementation)
- `TimerWidget.swift` (minimal timer implementation)
- `MinimalWidget.swift` (console-only timer)
- `bridge.h` (unused C header)
- `timer_widget.h` (unused C header)

**Kept:**
- `TimerWidgetApp.swift` (the actual timer widget)
- `MicrophonePermission.swift` (for AI chat feature)
- `SpeechRecognition.swift` (for AI chat feature)
- `build_widget.sh` (build script)

## How to Test

### Prerequisites
1. Make sure the Python backend is running: `cd backend && python start.py`
2. Make sure you're logged in to the app
3. The backend should be running on `http://127.0.0.1:8000`

### Testing Steps

1. **Test Habit Loading:**
   - Click the "Tracker" button at the top of your dashboard
   - The native Swift timer should open
   - Click the habit dropdown (shows "No Habits" by default)
   - You should see all your actual habits from your account

2. **Test Timer Tracking:**
   - Select a habit from the dropdown
   - Click the play button to start the timer
   - Let it run for a few seconds
   - Click the stop button
   - You should see a success message

3. **Test Data Persistence:**
   - Go back to your dashboard
   - Check the habit you just tracked - it should show the time you logged
   - Check the analytics page - the data should appear there too

## Technical Details

### API Changes

**Before:**
```swift
// Hardcoded Supabase URL
let supabaseURL = "https://bvwgycgdmrozxfmyxpuy.supabase.co"
let supabaseKey = "eyJhbGc..."

// Direct Tinybird write with hardcoded user ID
let userId = "05cbe689-f7ec-487b-adb6-ad50c7dc767b"
let url = URL(string: "https://api.us-east.aws.tinybird.co/v0/events?name=habit_logs")
```

**After:**
```swift
// Python backend API
let pythonAPIURL = "http://127.0.0.1:8000"

// Fetch habits
let url = URL(string: "\(pythonAPIURL)/api/habits")

// Create habit log (habit_id in URL path)
let url = URL(string: "\(pythonAPIURL)/api/habits/\(habitId)/logs")

// Let backend handle user identification via Clerk JWT
request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
```

### API Endpoints Used

1. **GET** `/api/habits` - Fetch all habits for authenticated user
2. **POST** `/api/habits/{habit_id}/logs` - Create a habit log entry

Both endpoints require Clerk authentication token in the Authorization header.

### Authentication Flow

1. User clicks "Tracker" button
2. Frontend calls Tauri command `write_auth_token_to_file` with Clerk JWT
3. Token is saved to temp directory: `ritual_auth_token.txt`
4. Swift widget reads token from temp file
5. All API requests include token in Authorization header
6. **When user stops timer:**
   - Swift writes refresh request: `ritual_refresh_token_request.txt`
   - Dashboard detects request (polling every 500ms)
   - Dashboard gets fresh Clerk token via `getToken()`
   - Dashboard writes fresh token to `ritual_auth_token.txt`
   - Swift reads fresh token and makes API call
7. Python backend validates token and extracts user ID
8. Data is saved under the correct user

### Token Refresh Mechanism

The Swift widget and Tauri app communicate via temporary files:

**Files used:**
- `/tmp/ritual_auth_token.txt` - Current Clerk JWT token
- `/tmp/ritual_refresh_token_request.txt` - Trigger file for token refresh
- `/tmp/ritual_timer_updated.txt` - Trigger for dashboard refresh

**Why this approach:**
- Swift widget runs as separate process (can't directly call Tauri commands)
- Polling temp files is lightweight and works across processes
- Clerk tokens expire quickly (1-5 minutes) for security
- This ensures token is always fresh when saving data

## Next Steps

If you encounter any issues:

1. **Check Backend is Running:**
   ```bash
   curl http://127.0.0.1:8000/api/habits
   ```

2. **Check Logs:**
   - Look at the terminal running the Python backend
   - Check for any authentication errors
   - Look for habit fetching logs

3. **Rebuild Widget (if needed):**
   ```bash
   cd src-tauri/native-timer
   bash build_widget.sh
   ```

## Files Modified

1. **`src-tauri/native-timer/TimerWidgetApp.swift`**
   - Updated `fetchRealHabits()` - Changed from Supabase to Python API
   - Updated `createHabitLog()` - Changed from direct Tinybird to Python API
   - Added `requestFreshAuthToken()` - Writes token refresh request file
   - Added `waitForFreshToken()` - Waits for fresh token before logging
   - Updated `logTimeToHabit()` - Now requests fresh token before saving

2. **`src-tauri/src/native_widget.rs`**
   - Added `check_token_refresh_request()` - Monitors for refresh requests

3. **`src-tauri/src/main.rs`**
   - Registered new `check_token_refresh_request` command

4. **`components/dashboard-layout.tsx`**
   - Added `useEffect` hook to monitor token refresh requests
   - Polls every 500ms and writes fresh token when requested

5. **Files Deleted:**
   - `src-tauri/native-timer/NativeTimer.swift`
   - `src-tauri/native-timer/TimerWidget.swift`
   - `src-tauri/native-timer/MinimalWidget.swift`
   - `src-tauri/native-timer/bridge.h`
   - `src-tauri/native-timer/timer_widget.h`

## Security Note

The timer widget now properly uses Clerk authentication tokens, ensuring:
- Each user only sees their own habits
- Timer logs are saved under the correct user account
- No hardcoded credentials or user IDs

