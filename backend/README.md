# Ritual Backend API

This is the FastAPI backend service for the Ritual application.

## ⚙️ Prerequisites

- Python 3.11+
- Docker & Docker Compose (recommended for local/dev/prod environments)
- Supabase account and project

## 🛠️ Local Setup (without Docker)

### 1. Clone the repository
```bash
cd backend
```

### 2. Create a virtual environment and activate it:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

### 3. Install dependencies:
```bash
pip install -r requirements.txt
```

### 4. Create a `.env` file based on `.env.example`:
```env
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
DATABASE_URL=postgresql://user:pass@host:port/dbname
API_HOST=0.0.0.0
API_PORT=8000
DEBUG=True
UVICORN_WORKERS=2
```

## 🚀 Running the API

### 🧪 Development (with hot reload)
```bash
python run.py
```
Or directly:
```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 🐳 With Docker (Dev)
```bash
docker-compose up --build
```

### 🔐 With Docker (Production)
```bash
docker-compose -f docker-compose.prod.yml up --build -d
```

> Uses `.env.production` for safe secrets/config

## 📚 API Docs

- Swagger (Interactive): [http://localhost:8000/docs](http://localhost:8000/docs)
- ReDoc (Static): [http://localhost:8000/redoc](http://localhost:8000/redoc)

## 🧱 Project Structure
```
backend/
├── app/
│   ├── models/            # SQLAlchemy models (database)
│   ├── schemas/           # Pydantic schemas (validation)
│   ├── routes/            # API endpoints
│   ├── services/          # Business logic (if used)
│   ├── utils/             # DB/Supabase config helpers
│   └── main.py            # FastAPI app instance
├── .env                   # Local env vars (gitignored)
├── .env.production        # Production secrets (gitignored)
├── .env.example           # Template env file for setup
├── Dockerfile             # Image definition
├── docker-compose.yml     # Dev environment
├── docker-compose.prod.yml# Production environment
├── requirements.txt       # Python dependencies
├── run.py                 # Entrypoint script (runs Uvicorn)
└── README.md              # You're here
```

## 🌐 Integration with Next.js Frontend

1. Make API requests to `http://localhost:8000` (dev) or your deployed backend URL.
2. Update CORS settings in `app/main.py`:
```python
allow_origins=["http://localhost:3000", "https://yourfrontend.com"]
```
3. Set appropriate environment variables in Vercel, Netlify, etc.

---

For deployment help or CI/CD pipeline integration, see `/docs/deploy.md` (coming soon!)
