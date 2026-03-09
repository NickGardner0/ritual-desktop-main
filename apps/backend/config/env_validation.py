"""
Environment Variable Validation

Validates that all required environment variables are set before the backend starts.
This helps catch configuration errors early in production.
"""

import os
import sys
import logging
from typing import List, Dict, Tuple

logger = logging.getLogger(__name__)

def validate_environment() -> Tuple[bool, List[str], List[str]]:
    """
    Validate required environment variables
    
    Returns:
        Tuple of (is_valid, missing_vars, warnings)
    """
    missing_vars: List[str] = []
    warnings: List[str] = []
    
    # Critical environment variables
    required_vars = [
        'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
        'CLERK_SECRET_KEY',
        'CLERK_JWKS_URL',
    ]

    memory_cloud_enabled = (os.getenv("RITUAL_MEMORY_CLOUD_ENABLED") or "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    if memory_cloud_enabled:
        required_vars.extend(
            [
                "TURBOPUFFER_API_KEY",
                "OPENAI_API_KEY",
                "COHERE_API_KEY",
            ]
        )
    
    # Highly recommended variables (warnings only)
    recommended_vars = [
        'DATABASE_URL',
        'TINYBIRD_TOKEN',
        'TURBOPUFFER_BASE_URL',
        'TURBOPUFFER_NAMESPACE_PREFIX',
        'OPENAI_EMBED_MODEL',
        'OPENAI_ANSWER_MODEL',
        'COHERE_RERANK_MODEL',
        'RITUAL_MEMORY_RETENTION_DAYS',
        'RITUAL_MEMORY_WATCHER_ALIASES_ENABLED',
        'RITUAL_MEMORY_WATCHER_ALIASES_SUNSET',
    ]
    
    # Check required variables
    for var in required_vars:
        if not os.getenv(var):
            missing_vars.append(var)
    
    # Check recommended variables (only in production)
    if os.getenv('NODE_ENV') == 'production' or os.getenv('DEBUG', 'true').lower() == 'false':
        for var in recommended_vars:
            if not os.getenv(var):
                warnings.append(f"Recommended environment variable missing: {var}")
    
    is_valid = len(missing_vars) == 0
    return is_valid, missing_vars, warnings


def validate_or_exit() -> None:
    """
    Validate and exit if critical variables are missing
    """
    is_valid, missing_vars, warnings = validate_environment()
    
    if not is_valid:
        error_message = f"""
❌ Missing required environment variables:
{chr(10).join(f'  - {v}' for v in missing_vars)}

Please check your .env file and ensure all required variables are set.
See .env.example for a template.
        """.strip()
        
        logger.error(error_message)
        sys.exit(1)
    
    # Log warnings
    if warnings:
        logger.warning("Environment warnings:")
        for warning in warnings:
            logger.warning("  - %s", warning)


def is_production() -> bool:
    """Check if we're running in production mode"""
    return os.getenv('NODE_ENV') == 'production' or os.getenv('DEBUG', 'true').lower() == 'false'


def is_development() -> bool:
    """Check if we're running in development mode"""
    return not is_production()
