"""
Database configuration for connecting to Supabase PostgreSQL
This is an alias to the main database configuration for backward compatibility.
"""

from app.utils.database import Base, engine, SessionLocal, database, get_db

# Re-export everything for backward compatibility
__all__ = ['Base', 'engine', 'SessionLocal', 'database', 'get_db'] 