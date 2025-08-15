"""
Script to run the FastAPI application
"""

import os
import uvicorn
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# API Configuration
API_HOST = os.getenv("API_HOST", "0.0.0.0")
API_PORT = int(os.getenv("API_PORT", "8000"))
DEBUG = os.getenv("DEBUG", "False").lower() in ("true", "1", "t")
WORKERS = 1 if DEBUG else int(os.getenv("UVICORN_WORKERS", "2"))

print(f"Starting Ritual API on {API_HOST}:{API_PORT} | Debug: {DEBUG} | Workers: {WORKERS}")

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=API_HOST,
        port=API_PORT,
        reload=DEBUG,
        workers=WORKERS,
        log_level="info" if DEBUG else "error",
    )
