"""
Ritual FastAPI Backend
Primary API entrypoint for dashboard, desktop, and mobile clients.
"""

import logging
import os

import sentry_sdk
from dotenv import load_dotenv
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.logging import LoggingIntegration

from app_factory import create_app

load_dotenv(".env.development", override=True)
load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("watchfiles.main").setLevel(logging.WARNING)

SENTRY_DSN = os.getenv("SENTRY_BACKEND_DSN") or os.getenv("SENTRY_DSN")
SENTRY_ENVIRONMENT = (
    os.getenv("SENTRY_ENVIRONMENT")
    or os.getenv("RAILWAY_ENVIRONMENT")
    or ("development" if os.getenv("DEBUG", "false").lower() == "true" else "production")
)
SENTRY_RELEASE = os.getenv("SENTRY_RELEASE") or os.getenv("RAILWAY_GIT_COMMIT_SHA")

if SENTRY_DSN:
    sentry_sdk.init(
        dsn=SENTRY_DSN,
        environment=SENTRY_ENVIRONMENT,
        release=SENTRY_RELEASE,
        enable_logs=True,
        traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.1")),
        integrations=[
            FastApiIntegration(transaction_style="endpoint"),
            LoggingIntegration(
                sentry_logs_level=logging.INFO,
                level=logging.INFO,
                event_level=logging.ERROR,
            ),
        ],
    )
    logger.info("Sentry backend monitoring enabled")
    if os.getenv("SENTRY_BACKEND_SMOKE_TEST", "0").lower() in {"1", "true", "yes", "on"}:
        sentry_sdk.set_tag("runtime", "backend")
        sentry_sdk.set_tag("surface", "fastapi")
        sentry_sdk.capture_message("Sentry smoke test: backend", level="info")

app = create_app()

if __name__ == "__main__":
    import uvicorn

    load_dotenv()
    host = os.getenv("API_HOST", "0.0.0.0")
    port = int(os.getenv("API_PORT", 8000))
    debug = os.getenv("DEBUG", "true").lower() == "true"
    uvicorn.run(app, host=host, port=port, reload=debug)
