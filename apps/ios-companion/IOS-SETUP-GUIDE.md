# iOS Companion App Setup Guide

This guide will help you set up Clerk authentication and configure the iOS companion app for Ritual.

## Prerequisites

- ✅ Apple Developer Account (approved)
- ✅ Xcode 15+
- ✅ iOS 17+ device or simulator
- ✅ Clerk account with an application created
- ✅ Backend API running and accessible

## Step 1: Configure Clerk

### 1.1 Get Your Clerk Keys

1. Go to your [Clerk Dashboard](https://dashboard.clerk.com)
2. Select your application
3. Go to **API Keys** in the sidebar
4. Copy your **Publishable Key** (starts with `pk_test_` or `pk_live_`)

### 1.2 Get Your Clerk Frontend API Domain

1. In Clerk Dashboard, go to **Domains**
2. Note your Clerk frontend API domain (e.g., `rational-rattler-77.clerk.accounts.dev`)
3. This is used for associated domains configuration

### 1.3 Configure Associated Domains

The app is already configured with associated domains in `Project.swift`. Make sure the domain matches your Clerk instance:

```swift
"com.apple.developer.associated-domains": [
    "webcredentials:rational-rattler-77.clerk.accounts.dev"  // Update this!
]
```

**Important**: Replace `rational-rattler-77.clerk.accounts.dev` with your actual Clerk frontend API domain.

## Step 2: Configure Xcode Project

### 2.1 Add Configuration Values

You have two options for configuring the app:

#### Option A: Using Xcode Build Settings (Recommended)

1. Open `RitualCompanion.xcworkspace` in Xcode
2. Select the **RitualCompanion** target
3. Go to **Build Settings**
4. Search for "User-Defined" settings
5. Add the following build settings:

   - `CLERK_PUBLISHABLE_KEY` = Your Clerk publishable key
   - `CLERK_FRONTEND_API` = Your Clerk frontend API domain (e.g., `rational-rattler-77.clerk.accounts.dev`)
   - `API_BASE_URL_DEBUG` = Your local backend URL (e.g., `http://192.168.1.237:8000`)
   - `API_BASE_URL` = Your production backend URL (e.g., `https://api.ritual.app`)

#### Option B: Update Info.plist Directly

If you prefer, you can update the values directly in the generated `Info.plist` file, but they will be overwritten when regenerating with Tuist.

### 2.2 Update Associated Domains

1. In Xcode, select your target
2. Go to **Signing & Capabilities**
3. Find **Associated Domains**
4. Ensure it includes: `webcredentials:YOUR_CLERK_DOMAIN.clerk.accounts.dev`

## Step 3: Configure Backend API URL

### 3.1 For Local Development

Update `AppConfig.swift` or set the `API_BASE_URL_DEBUG` build setting to your Mac's local IP address:

1. Find your Mac's IP address:
   ```bash
   ifconfig | grep "inet " | grep -v 127.0.0.1
   ```
2. Update the debug URL (e.g., `http://192.168.1.237:8000`)

### 3.2 For Production

Set `API_BASE_URL` to your production backend URL (e.g., `https://api.ritual.app`)

## Step 4: Update Bundle Identifier

1. In Xcode, select your target
2. Go to **General** tab
3. Update **Bundle Identifier** to match your Apple Developer account (e.g., `com.yourcompany.ritual.companion`)

## Step 5: Configure Signing & Capabilities

### 5.1 Signing

1. In Xcode, go to **Signing & Capabilities**
2. Select your **Team** (your Apple Developer account)
3. Ensure **Automatically manage signing** is checked

### 5.2 Capabilities

The following capabilities should already be configured:

- ✅ **HealthKit** - For reading health data
- ✅ **Associated Domains** - For Clerk authentication

## Step 6: Test the App

### 6.1 Run on Simulator

1. Select an iOS 17+ simulator
2. Press `Cmd + R` to build and run
3. The app should launch and show the sign-in screen

### 6.2 Test Authentication Flow

1. Tap **Sign In with Ritual**
2. Complete the Clerk authentication flow
3. After signing in, tap **Connect to Ritual**
4. Grant HealthKit permissions when prompted
5. Tap **Sync Now** to test data sync

### 6.3 Verify Backend Connection

1. Check your backend logs to see device registration
2. Verify metrics are being received correctly

## Troubleshooting

### Issue: "Authentication failed" error

**Solution:**
- Verify your Clerk publishable key is correct
- Check that the associated domain matches your Clerk instance
- Ensure your backend is validating Clerk JWT tokens correctly

### Issue: "Invalid API URL" error

**Solution:**
- Check your `API_BASE_URL_DEBUG` or `API_BASE_URL` configuration
- Ensure your backend is running and accessible
- For local development, verify your Mac's IP address hasn't changed

### Issue: Associated Domains not working

**Solution:**
- Ensure the domain format is correct: `webcredentials:YOUR_DOMAIN.clerk.accounts.dev`
- Verify the domain matches your Clerk frontend API domain exactly
- Make sure you're testing on a real device (associated domains don't work in simulator)

### Issue: HealthKit permissions denied

**Solution:**
- Go to Settings > Privacy & Security > Health > Ritual
- Ensure all required permissions are enabled
- Reset permissions in simulator: Device > Erase All Content and Settings

### Issue: Device registration fails

**Solution:**
- Verify your backend `/api/wearables/apple/register_device` endpoint is working
- Check that the Clerk JWT token is being sent correctly
- Review backend logs for detailed error messages

## Next Steps

Once the app is configured and working:

1. **Test on a real device** - Associated domains require a real device
2. **Set up background sync** - Configure background delivery for HealthKit
3. **Add more metrics** - Extend HealthKitManager to sync additional health data
4. **Improve UI** - Customize the design to match your brand
5. **Add analytics** - Track app usage and sync success rates

## Additional Resources

- [Clerk iOS SDK Documentation](https://clerk.com/docs/quickstarts/ios)
- [HealthKit Documentation](https://developer.apple.com/documentation/healthkit)
- [Associated Domains Guide](https://developer.apple.com/documentation/xcode/supporting-universal-links-in-your-app)

## Support

If you encounter issues:

1. Check the Xcode console for detailed error messages
2. Review backend logs for API errors
3. Verify all configuration values are correct
4. Test with a fresh install (delete app and reinstall)

