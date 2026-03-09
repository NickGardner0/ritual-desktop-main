#!/usr/bin/env python3
"""
Ritual Backend Startup Script
"""

import os
import sys
import subprocess
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

def check_requirements():
    """Check if all requirements are installed"""
    try:
        import fastapi
        import uvicorn
        import sqlalchemy
        logger.info("All requirements are installed")
        return True
    except ImportError as e:
        logger.error("Missing requirement: %s", e)
        logger.info("Please run: pip install -r requirements.txt")
        return False

def check_env_file():
    """Check if .env file exists"""
    env_file = Path(".env")
    if not env_file.exists():
        logger.warning(".env file not found")
        logger.info("Please copy .env.example to .env and configure your settings")
        return False
    logger.info(".env file found")
    return True

def main():
    """Main startup function"""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    logging.getLogger("watchfiles.main").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logger.info("Starting Ritual Backend API")
    
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
        logger.warning("Environment validation module not found (skipping)")
    except Exception as e:
        logger.error("Environment validation failed: %s", e)
        sys.exit(1)
    
    # Start the server
    try:
        import uvicorn
        
        host = os.getenv("API_HOST", "127.0.0.1")
        port = int(os.getenv("API_PORT", 8000))
        debug = os.getenv("DEBUG", "true").lower() == "true"
        
        logger.info("Starting server on http://%s:%s", host, port)
        logger.info("Debug mode: %s", debug)
        logger.info("API docs available at: http://localhost:8000/docs")
        
        # Use import string format to enable reload
        reload_excludes = None
        if debug:
            # Ignore local replica churn to avoid noisy watchfile events during sync.
            reload_excludes = [
                ".turso_replica.db",
                ".turso_replica.db-*",
                ".turso_replica.db.*",
                ".memory_cloud.db",
                ".memory_cloud.db-*",
                ".memory_cloud.db.*",
            ]

        uvicorn.run(
            "main:app",
            host=host,
            port=port,
            reload=debug,
            reload_includes=["*.py"],
            reload_excludes=reload_excludes,
        )
        
    except KeyboardInterrupt:
        logger.info("Server stopped by user")
    except Exception as e:
        logger.error("Error starting server: %s", e)
        sys.exit(1)

if __name__ == "__main__":
    main()
