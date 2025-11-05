# Environment Variables Guide

## Quick Setup

1. Create `.env.local` in the project root for Next.js variables
2. Create `backend/.env` for Python backend variables
3. **NEVER** commit these files to git (already in .gitignore)

## Required Variables

### Frontend (Next.js) - `.env.local`

```bash
# Python Backend API URL (REQUIRED)
NEXT_PUBLIC_PYTHON_API_URL=http://127.0.0.1:8000

# Clerk Authentication (REQUIRED)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxxxx
CLERK_SECRET_KEY=sk_test_xxxxx
```

### Backend (Python) - `backend/.env`

```bash
# Clerk Secret (for JWT verification) (REQUIRED)
CLERK_SECRET_KEY=sk_test_xxxxx

# Tinybird Analytics (REQUIRED)
TINYBIRD_TOKEN=p.eyJ1IjogIjxxxxxx
TINYBIRD_ENV=cloud
TINYBIRD_API_URL=https://api.us-east.aws.tinybird.co

# Internal API Security (REQUIRED)
# Generate with: openssl rand -hex 32
INTERNAL_API_KEY=your_random_32_char_hex_string_here

# Database (OPTIONAL - defaults to SQLite)
DATABASE_URL=sqlite+aiosqlite:///./ritual.db

# WHOOP Integration (OPTIONAL)
WHOOP_CLIENT_ID=your_client_id
WHOOP_CLIENT_SECRET=your_client_secret
WHOOP_REDIRECT_URI=http://localhost:3000/integrations/whoop/callback

# AI Services (OPTIONAL)
GROQ_API_KEY=gsk_xxxxx
OPENAI_API_KEY=sk-xxxxx

# Server Config (OPTIONAL)
API_HOST=0.0.0.0
API_PORT=8000
DEBUG=true
```

## How to Get Keys

### Clerk (Authentication)
1. Sign up at https://dashboard.clerk.com/
2. Create a new application
3. Copy the publishable and secret keys
4. Add both to frontend `.env.local` and backend `.env`

### Tinybird (Analytics)
1. Sign up at https://www.tinybird.co/
2. Create a workspace
3. Go to Tokens section
4. Create a new token with read/write permissions
5. Copy to `TINYBIRD_TOKEN`

### Internal API Key (Security)
Generate a secure random key:
```bash
openssl rand -hex 32
```

### WHOOP (Optional)
1. Apply at https://developer.whoop.com/
2. Create an application
3. Copy client ID and secret

### Groq (Optional - for voice transcription)
1. Sign up at https://console.groq.com/
2. Generate an API key

### OpenAI (Optional - for AI features)
1. Sign up at https://platform.openai.com/
2. Generate an API key

## Production Configuration

### Frontend Production
```bash
NEXT_PUBLIC_PYTHON_API_URL=https://api.yourdomain.com
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_xxxxx
CLERK_SECRET_KEY=sk_live_xxxxx
```

### Backend Production
```bash
# Use production keys
CLERK_SECRET_KEY=sk_live_xxxxx
TINYBIRD_TOKEN=p.eyJ1IjogIjxxxxxx  # Production token

# Strong internal API key
INTERNAL_API_KEY=use_a_very_long_random_string_here

# Disable debug mode
DEBUG=false

# CORS for production domains
CORS_ORIGINS=https://yourdomain.com,https://app.yourdomain.com

# Database (consider PostgreSQL for production)
DATABASE_URL=postgresql+asyncpg://user:pass@host:5432/ritual
```

## Verification

Check if all required variables are set:

### Frontend:
```bash
npm run dev
# Should not show "API URL not configured" error
```

### Backend:
```bash
cd backend
python -c "from dotenv import load_dotenv; import os; load_dotenv(); print('✅ All vars loaded' if os.getenv('CLERK_SECRET_KEY') and os.getenv('TINYBIRD_TOKEN') else '❌ Missing vars')"
```

## Common Issues

### "Invalid authentication token"
- Check `CLERK_SECRET_KEY` is the same in frontend and backend
- Make sure you're using the correct key for your environment (test/live)

### "Tinybird connection failed"
- Verify `TINYBIRD_TOKEN` is correct
- Check if your token has proper permissions
- Ensure `TINYBIRD_ENV=cloud` if using cloud

### "Database connection error"
- Check `DATABASE_URL` format
- Ensure database file/server is accessible
- For SQLite, check file permissions

## Security Checklist

- [ ] Never commit `.env` files
- [ ] Use different keys for development and production
- [ ] Rotate keys regularly
- [ ] Use strong random strings for `INTERNAL_API_KEY`
- [ ] Restrict Tinybird token permissions to minimum needed
- [ ] Enable MFA on all service accounts
- [ ] Monitor API key usage

## Sample Files

Create these files in your project:

### `.env.local` (project root)
```bash
NEXT_PUBLIC_PYTHON_API_URL=http://127.0.0.1:8000
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxxxx
CLERK_SECRET_KEY=sk_test_xxxxx
```

### `backend/.env`
```bash
CLERK_SECRET_KEY=sk_test_xxxxx
TINYBIRD_TOKEN=p.eyJ1IjogIjxxxxxx
TINYBIRD_ENV=cloud
TINYBIRD_API_URL=https://api.us-east.aws.tinybird.co
INTERNAL_API_KEY=$(openssl rand -hex 32)
DATABASE_URL=sqlite+aiosqlite:///./ritual.db
DEBUG=true
```

