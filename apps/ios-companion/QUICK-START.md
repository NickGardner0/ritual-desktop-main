# Quick Start Guide

## Quick Configuration Checklist

1. **Get Clerk Keys**
   - Publishable Key: `pk_test_...` or `pk_live_...`
   - Frontend API Domain: `your-instance.clerk.accounts.dev`

2. **Update Xcode Build Settings**
   Add these User-Defined settings:
   ```
   CLERK_PUBLISHABLE_KEY = pk_test_...
   CLERK_FRONTEND_API = your-instance.clerk.accounts.dev
   API_BASE_URL_DEBUG = http://YOUR_LOCAL_IP:8000
   API_BASE_URL = https://api.ritual.app
   ```

3. **Update Associated Domain**
   In `Project.swift`, line 39:
   ```swift
   "webcredentials:your-instance.clerk.accounts.dev"
   ```

4. **Update Bundle ID**
   Change `com.ritual.companion` to your own bundle ID in Xcode

5. **Run the App**
   ```bash
   cd apps/ios-companion
   tuist generate  # If using Tuist
   open RitualCompanion.xcworkspace
   ```

## First Run

1. Sign in with Clerk
2. Connect to Ritual
3. Grant HealthKit permissions
4. Sync your data!

See `IOS-SETUP-GUIDE.md` for detailed instructions.

