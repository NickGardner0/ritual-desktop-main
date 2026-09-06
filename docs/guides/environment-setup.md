# Environment Variables Setup Guide

This guide covers all environment variables needed to run Ritual Desktop in production.

## Quick Start

1. Copy the template below to `apps/dashboard/.env.local` (development) or `apps/dashboard/.env.production.local` (production)
2. Fill in the values from your various service dashboards
3. Never commit actual secrets to git

---

## Required Variables

These are **essential** for the app to function:

### Clerk Authentication

Get these from [Clerk Dashboard](https://dashboard.clerk.com/) → Your App → API Keys

```bash
# Public key (exposed to browser - safe to use in client code)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_xxxxxxxxxxxxx

# Secret key (server-side only - NEVER expose to client)
CLERK_SECRET_KEY=sk_live_xxxxxxxxxxxxx
```

### Python Backend API

Your deployed Python backend URL:

```bash
# Used by both client and server components
NEXT_PUBLIC_PYTHON_API_URL=https://api.yourdomain.com

# Server-side only (for API routes and server actions)
PYTHON_API_URL=https://api.yourdomain.com
```

**For local development:** Use `http://127.0.0.1:8000`

### OpenAI

Get your API key from [OpenAI Platform](https://platform.openai.com/api-keys):

```bash
OPENAI_API_KEY=sk-xxxxxxxxxxxxx
```

### Tinybird Analytics

Get these from [Tinybird Dashboard](https://app.tinybird.co/) → Tokens:

```bash
TINYBIRD_TOKEN=p.xxxxxxxxxxxxx
TINYBIRD_API_URL=https://api.us-east.aws.tinybird.co
```

### Database (Turso)

Get these from [Turso Dashboard](https://turso.tech/app):

```bash
DATABASE_URL=libsql://your-database-name.turso.io
DATABASE_AUTH_TOKEN=your-auth-token
```

---

## Whoop Integration

Required only if you're using the Whoop wearable integration:

```bash
# From https://developer.whoop.com/
WHOOP_CLIENT_ID=your-whoop-client-id
WHOOP_CLIENT_SECRET=your-whoop-client-secret

# Client-side (for OAuth redirect)
NEXT_PUBLIC_WHOOP_CLIENT_ID=your-whoop-client-id
NEXT_PUBLIC_WHOOP_REDIRECT_URI=https://yourdomain.com/api/integrations/whoop/callback
```

---

## Optional Variables

### OpenPanel Analytics

For product analytics tracking:

```bash
NEXT_PUBLIC_OPENPANEL_CLIENT_ID=your-client-id
OPENPANEL_SECRET_KEY=your-secret-key
```

### Sentry Error Tracking

For error monitoring in production:

```bash
NEXT_PUBLIC_SENTRY_DSN=https://xxxxx@xxxxx.ingest.sentry.io/xxxxx
```

### Groq API

Alternative to OpenAI for Whisper transcription (faster, cheaper):

```bash
GROQ_API_KEY=gsk_xxxxxxxxxxxxx
```

### Internal API Key

For secure server-to-server communication (FastAPI scheduler → Next workflow execute):

```bash
# Generate with: openssl rand -base64 32
INTERNAL_API_KEY=your-secure-random-string
```

---

## Complete Template

Copy this entire block to your `apps/dashboard/.env.local` file:

```bash
# ==============================================================================
# RITUAL DESKTOP - PRODUCTION ENVIRONMENT VARIABLES
# ==============================================================================

# ------------------------------------------------------------------------------
# REQUIRED
# ------------------------------------------------------------------------------

# Clerk Authentication
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_
CLERK_SECRET_KEY=sk_live_

# Python Backend
NEXT_PUBLIC_PYTHON_API_URL=https://api.yourdomain.com
PYTHON_API_URL=https://api.yourdomain.com

# OpenAI
OPENAI_API_KEY=sk-

# Tinybird
TINYBIRD_TOKEN=p.
TINYBIRD_API_URL=https://api.us-east.aws.tinybird.co

# Database
DATABASE_URL=libsql://
DATABASE_AUTH_TOKEN=

# ------------------------------------------------------------------------------
# WHOOP INTEGRATION (if using)
# ------------------------------------------------------------------------------

WHOOP_CLIENT_ID=
WHOOP_CLIENT_SECRET=
NEXT_PUBLIC_WHOOP_CLIENT_ID=
NEXT_PUBLIC_WHOOP_REDIRECT_URI=https://yourdomain.com/api/integrations/whoop/callback

# ------------------------------------------------------------------------------
# OPTIONAL
# ------------------------------------------------------------------------------

# Analytics
NEXT_PUBLIC_OPENPANEL_CLIENT_ID=
OPENPANEL_SECRET_KEY=

# Error Tracking
NEXT_PUBLIC_SENTRY_DSN=

# Voice Transcription (alternative to OpenAI)
GROQ_API_KEY=

# Server-to-server auth
INTERNAL_API_KEY=
```

---

## Python Backend Environment

The Python backend (`apps/backend/`) needs its own environment variables. Create `apps/backend/.env`:

```bash
# Database
DATABASE_URL=libsql://your-database.turso.io
DATABASE_AUTH_TOKEN=your-turso-auth-token

# Clerk (for token verification)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_
CLERK_SECRET_KEY=sk_live_

# Tinybird
TINYBIRD_TOKEN=p.
TINYBIRD_API_URL=https://api.us-east.aws.tinybird.co

# Whoop (if using)
WHOOP_CLIENT_ID=
WHOOP_CLIENT_SECRET=
NEXT_PUBLIC_WHOOP_REDIRECT_URI=https://yourdomain.com/api/integrations/whoop/callback
WHOOP_API_MAX_RETRIES=3
WHOOP_API_RETRY_BASE_DELAY=0.5

# Server Config
API_HOST=0.0.0.0
API_PORT=8000
DEBUG=false

# Security
INTERNAL_API_KEY=
CORS_ORIGINS=https://yourdomain.com,tauri://localhost
TOKEN_ENCRYPTION_KEY=generate-with-python-c-"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
TURSO_LOCAL_ENCRYPTION_KEY=generate-with-openssl-rand-base64-32
```

---

## Deployment Checklist

### Vercel (Next.js Frontend)

1. Go to Project Settings → Environment Variables
2. Add all `NEXT_PUBLIC_*` variables for "Production" environment
3. Add server-side secrets (`CLERK_SECRET_KEY`, `OPENAI_API_KEY`, etc.)

### Railway/Render (Python Backend)

1. Add all backend environment variables
2. Ensure `CORS_ORIGINS` includes your frontend domain
3. Set `DEBUG=false` for production

### Tauri Desktop App

The Tauri app connects to your production Next.js server. Ensure:

1. Your Next.js app is deployed and accessible
2. Update any hardcoded URLs if needed
3. The `CORS_ORIGINS` in your backend includes `tauri://localhost`

---

## Security Notes

1. **Never commit `.env` files** - They're in `.gitignore` for a reason
2. **Use different keys for dev/prod** - Create separate Clerk/Tinybird projects
3. **Rotate secrets regularly** - Especially if they may have been exposed
4. **`NEXT_PUBLIC_*` vars are exposed** - Only use for non-sensitive data
5. **Server-side secrets** - Use for API keys, database credentials, etc.

---

## Troubleshooting

### "Unauthorized" errors
- Check `CLERK_SECRET_KEY` is set correctly
- Ensure tokens haven't expired

### "Cannot connect to backend"
- Verify `NEXT_PUBLIC_PYTHON_API_URL` is correct
- Check CORS settings on your backend

### "Tinybird errors"
- Verify `TINYBIRD_TOKEN` has correct permissions
- Check `TINYBIRD_API_URL` matches your region

### "OpenAI API errors"
- Ensure `OPENAI_API_KEY` is valid
- Check your OpenAI account has credits/quota
