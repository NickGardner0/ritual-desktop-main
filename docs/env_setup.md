# Environment Setup Guide

This document contains the required environment variables for running Ritual.

---

## Frontend (`apps/dashboard/.env.local`)

Create a file named `.env.local` in `apps/dashboard/` with these variables:

```env
# ============================
# Clerk Authentication (Required)
# ============================
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/onboarding

# ============================
# Backend API (Required)
# ============================
NEXT_PUBLIC_PYTHON_API_URL=http://127.0.0.1:8000

# ============================
# Tinybird Analytics (Required)
# ============================
TINYBIRD_TOKEN=p.ey...
TINYBIRD_API_URL=https://api.us-east.aws.tinybird.co

# ============================
# AI Features (Required)
# ============================
OPENAI_API_KEY=sk-...

# ============================
# Whoop Integration (Optional)
# ============================
NEXT_PUBLIC_WHOOP_CLIENT_ID=
NEXT_PUBLIC_WHOOP_REDIRECT_URI=http://localhost:3000/api/integrations/whoop/callback

# ============================
# Observability (Optional)
# ============================
NEXT_PUBLIC_SENTRY_WEB_DSN=
NEXT_PUBLIC_SENTRY_DESKTOP_DSN=
SENTRY_WEB_DSN=
SENTRY_AUTH_TOKEN=
SENTRY_ORG=nick-gardner
SENTRY_SOURCEMAP_PROJECT=
SENTRY_ADDITIONAL_SOURCEMAP_PROJECTS=
NEXT_PUBLIC_SENTRY_ENVIRONMENT=
NEXT_PUBLIC_SENTRY_RELEASE=
OPENPANEL_CLIENT_ID=

# ============================
# Feature Flags (Optional)
# ============================
NEXT_PUBLIC_USE_PYTHON_BACKEND=true
NEXT_PUBLIC_DEBUG_API=false
```

---

## Backend (apps/backend/.env)

Create a file named `.env` in the `apps/backend/` directory:

```env
# ============================
# Database (Required)
# ============================
# Turso Cloud URL format: libsql://[HOST].turso.io?authToken=[TOKEN]
DATABASE_URL=libsql://your-db.turso.io?authToken=eyJ...
DB_POOL_SIZE=5
DB_MAX_OVERFLOW=10
DB_POOL_TIMEOUT=30

# ============================
# Clerk Authentication (Required)
# ============================
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=http://localhost:3000/sign-in

# ============================
# Tinybird Analytics (Required)
# ============================
TINYBIRD_TOKEN=p.ey...
TINYBIRD_API_URL=https://api.us-east.aws.tinybird.co

# ============================
# Whoop Integration (Optional)
# ============================
WHOOP_CLIENT_ID=
WHOOP_CLIENT_SECRET=
NEXT_PUBLIC_WHOOP_REDIRECT_URI=http://localhost:3000/api/integrations/whoop/callback
WHOOP_API_MAX_RETRIES=3
WHOOP_API_RETRY_BASE_DELAY=0.5

# ============================
# Wearables (Apple Health)
# ============================
WEARABLES_MASTER_SECRET=ritual-wearables-dev-secret

# ============================
# CORS (Optional)
# ============================
CORS_ORIGINS=http://localhost:3000,https://localhost:3000,tauri://localhost

# ============================
# Token Encryption (Required for integrations)
# ============================
# Generate with:
# python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
TOKEN_ENCRYPTION_KEY=

# ============================
# Observability (Optional)
# ============================
SENTRY_BACKEND_DSN=
SENTRY_ENVIRONMENT=
SENTRY_RELEASE=
```

---

## iOS Companion (AppConfig.swift)

Update `apps/ios-companion/Config/AppConfig.swift`:

```swift
struct AppConfig {
    static let apiBaseURL = "https://api.ritual.so" // or localhost for dev
}
```

The iOS app stores credentials in the Keychain after device registration.

---

## Getting API Keys

### Clerk
1. Go to [clerk.com](https://clerk.com)
2. Create an application
3. Copy the publishable and secret keys

### Tinybird
1. Go to [tinybird.co](https://tinybird.co)
2. Create a workspace
3. Get your admin token from Settings

### OpenAI
1. Go to [platform.openai.com](https://platform.openai.com)
2. Create an API key

### Turso
1. Go to [turso.tech](https://turso.tech)
2. Create a database
3. Copy the libSQL URL with auth token

### Whoop (Optional)
1. Go to [developer.whoop.com](https://developer.whoop.com)
2. Create an OAuth application
3. Configure redirect URI

---

*Last updated: January 2026*
