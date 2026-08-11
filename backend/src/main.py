import logging
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)
from dotenv import load_dotenv
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

load_dotenv()

from src.infrastructure.database.session import init_db
from src.infrastructure.api.routers import router, limiter
from src.infrastructure.api.similarity_router import similarity_router

app = FastAPI(
    title="Code Lens API",
    description="Git Data Extraction API for Code Lens",
    version="1.0.0"
)

# Attach limiter to app state so @limiter.limit decorators can find it
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore
app.add_middleware(SlowAPIMiddleware)

import os

origins_raw = os.getenv("CORS_ORIGINS", "http://localhost:3000")
origins = [o.strip() for o in origins_raw.split(",") if o.strip()]

# Credentials are only allowed alongside explicit origins, not wildcard "*"
allow_credentials = True
if "*" in origins:
    allow_credentials = False

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global exception handler — ensures all unhandled 500s return JSON, not plain text
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled server error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error. Please try again later."},
    )

# Initialize database tables on startup
@app.on_event("startup")
def on_startup():
    try:
        init_db()
        logger.info("Database initialized successfully.")
    except Exception as e:
        logger.exception("CRITICAL: Database initialization failed on startup: %s", e)

# Include the API routes
app.include_router(router)
app.include_router(similarity_router)

@app.get("/health")
def health_check():
    return {"status": "ok"}
