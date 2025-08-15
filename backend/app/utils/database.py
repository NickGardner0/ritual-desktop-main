"""
Database configuration for connecting to Supabase PostgreSQL
"""

import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from databases import Database
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Get connection details from environment variables
# Use SQLite for local development if no DATABASE_URL is provided
DATABASE_URL = os.getenv(
    "DATABASE_URL", 
    "sqlite:///./ritual.db"  # Local SQLite database for development
)

# For SQLAlchemy 1.4+, explicitly specify postgresql driver to avoid warnings
if DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg2://")

# Create engine and session
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# Async database instance for raw queries (SQLite doesn't need async for simple cases)
database = Database(DATABASE_URL) if not DATABASE_URL.startswith("sqlite") else None

# Dependency to get DB session - used in FastAPI endpoints
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close() 
