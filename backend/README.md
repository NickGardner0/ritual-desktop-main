# Backend Directory

This directory now contains only Supabase-related configuration and documentation.

## Current Architecture

The Ritual app now uses **Supabase directly** from the frontend instead of a custom Python FastAPI backend.

### Frontend Integration
- **Habit Management**: `lib/habits-service.ts` - Direct Supabase client for CRUD operations
- **Authentication**: Supabase Auth integration in `contexts/AuthContext.tsx`
- **Database**: PostgreSQL database hosted on Supabase

### Files in this directory
- `.env` - Supabase configuration (API keys, database URL)
- `README.md` - This documentation

## Previous Architecture (Removed)
The following Python FastAPI components have been removed as they're no longer needed:
- FastAPI application server
- SQLAlchemy models and database setup
- Custom authentication middleware
- Docker configuration
- Python dependencies

## Development
All backend functionality is now handled through:
1. Supabase dashboard for database management
2. Direct client calls from the frontend
3. Supabase Auth for user authentication
