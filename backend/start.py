#!/usr/bin/env python3
"""
Ritual Backend Startup Script
"""

import os
import sys
import subprocess
from pathlib import Path

def check_requirements():
    """Check if all requirements are installed"""
    try:
        import fastapi
        import uvicorn
        import sqlalchemy
        print("✅ All requirements are installed")
        return True
    except ImportError as e:
        print(f"❌ Missing requirement: {e}")
        print("Please run: pip install -r requirements.txt")
        return False

def check_env_file():
    """Check if .env file exists"""
    env_file = Path(".env")
    if not env_file.exists():
        print("⚠️  .env file not found")
        print("Please copy .env.example to .env and configure your settings")
        return False
    print("✅ .env file found")
    return True

def main():
    """Main startup function"""
    print("🚀 Starting Ritual Backend API...")
    
    # Load environment variables FIRST (before any checks)
    from dotenv import load_dotenv
    load_dotenv()
    
    # Check requirements
    if not check_requirements():
        sys.exit(1)
    
    # Check environment file exists
    if not check_env_file():
        sys.exit(1)
    
    # Validate environment variables (after loading .env)
    try:
        from config.env_validation import validate_or_exit
        validate_or_exit()
    except ImportError:
        print("⚠️  Environment validation module not found (skipping)")
    except Exception as e:
        print(f"❌ Environment validation failed: {e}")
        sys.exit(1)
    
    # Start the server
    try:
        import uvicorn
        
        host = os.getenv("API_HOST", "127.0.0.1")
        port = int(os.getenv("API_PORT", 8000))
        debug = os.getenv("DEBUG", "true").lower() == "true"
        
        print(f"🌐 Starting server on http://{host}:{port}")
        print(f"📊 Debug mode: {debug}")
        print("📖 API docs available at: http://localhost:8000/docs")
        print()
        
        # Use import string format to enable reload
        uvicorn.run("main:app", host=host, port=port, reload=debug)
        
    except KeyboardInterrupt:
        print("\n👋 Server stopped by user")
    except Exception as e:
        print(f"❌ Error starting server: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
