# Ritual Python FastAPI Backend

This directory contains the new Python FastAPI backend that replaces the TypeScript/Supabase architecture with a simplified Python-only approach.

## Architecture Overview

```
Next.js Frontend → Python FastAPI Backend → Tinybird Analytics
                                        ↓
                                   SQLite/PostgreSQL
```

### What This Backend Handles
- **Habit Management**: Full CRUD operations for habits
- **Habit Logging**: Track habit completions with analytics
- **Authentication**: JWT token validation (initially Supabase-compatible)
- **Real-time Updates**: WebSocket connections for live UI updates
- **Analytics**: Integration with Tinybird for advanced analytics
- **Wearable Integrations**: Ready for 10+ device integrations

## Quick Start

### 1. Install Dependencies
```bash
cd backend
pip install -r requirements.txt
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your configuration
```

### 3. Start the Server
```bash
python start.py
```

The API will be available at:
- **API**: http://localhost:8000
- **Docs**: http://localhost:8000/docs
- **WebSocket**: ws://localhost:8000/ws/{user_id}

## API Endpoints

### Habits
- `POST /api/habits` - Create habit
- `GET /api/habits` - Get user's habits  
- `PUT /api/habits/{id}` - Update habit
- `DELETE /api/habits/{id}` - Delete habit

### Habit Logs
- `POST /api/habits/{id}/logs` - Log habit completion
- `GET /api/habits/{id}/logs` - Get habit logs
- `GET /api/habit-logs` - Get all user's logs

### Analytics (Tinybird)
- `GET /api/analytics/habits/summary` - Habit metrics
- `GET /api/analytics/habits/trends` - Trend analysis

### Real-time
- `WebSocket /ws/{user_id}` - Live updates

## Migration Strategy

This backend is designed to **mirror your existing TypeScript service interface exactly**, so your frontend won't break during migration.

### Phase 1: Parallel Deployment
1. Run Python backend alongside existing setup
2. Test all endpoints work correctly
3. Verify real-time updates function

### Phase 2: Frontend Migration  
1. Update frontend API calls to point to Python backend
2. Replace Supabase real-time with WebSocket connections
3. Test all functionality

### Phase 3: Complete Migration
1. Remove TypeScript services
2. Switch to Tinybird-only data storage
3. Remove Supabase dependencies

## Project Structure

```
backend/
├── main.py                 # FastAPI application
├── start.py               # Startup script
├── requirements.txt       # Python dependencies
├── ritual.db              # SQLite database
├── .env.example          # Environment template
├── models/
│   ├── habit_models.py   # Pydantic models
│   └── user_models.py    # User models
├── services/
│   ├── habits_service.py    # Habit business logic
│   ├── auth_service.py      # Authentication
│   ├── tinybird_service.py  # Tinybird integration
│   ├── whoop_service.py     # WHOOP integration
│   ├── user_service.py      # User management
│   └── websocket_manager.py # Real-time updates
├── database/
│   ├── models.py         # SQLAlchemy models
│   └── connection.py     # Database setup
└── tests/
    ├── debug_habits.py   # Habit debugging utilities
    ├── test_backend.py   # Backend integration tests
    ├── test_endpoints.py # API endpoint tests
    ├── simple_test.py    # Simple connectivity tests
    ├── verify_habits.py  # Habit verification utilities
    └── test_ritual.db    # Test database
```

## Benefits of This Architecture

✅ **Simplified**: Single backend language (Python)  
✅ **Scalable**: Ready for 10+ wearable integrations  
✅ **Analytics-Ready**: Built-in Tinybird integration  
✅ **Real-time**: WebSocket support for live updates  
✅ **Migration-Safe**: Mirrors existing API interface  
✅ **Future-Proof**: Easy to add ML/AI features

## Development

### Running in Development Mode
```bash
# Install dependencies
pip install -r requirements.txt

# Copy environment file
cp .env.example .env

# Start with auto-reload
python start.py
```

### Database Migrations
The backend uses SQLAlchemy with automatic table creation on startup. For production, you may want to use Alembic for proper migrations.

### Testing

The `tests/` directory contains test and debug utilities:

```bash
# Run backend tests
cd backend
python tests/test_backend.py

# Run endpoint tests
python tests/test_endpoints.py

# Debug habits
python tests/debug_habits.py

# Verify habit data consistency
python tests/verify_habits.py
```

For more comprehensive testing, consider migrating to pytest:
```bash
pip install pytest pytest-asyncio
pytest tests/
```

### Testing the API
1. Start the backend: `python start.py`
2. Visit http://localhost:8000/docs for interactive API documentation
3. Test WebSocket connections at ws://localhost:8000/ws/{user_id}

### Integration with Existing Frontend
The API endpoints are designed to match your existing TypeScript service methods, so migration should be seamless.
