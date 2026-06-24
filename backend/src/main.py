from fastapi import FastAPI
from dotenv import load_dotenv

load_dotenv()

from src.infrastructure.database.session import init_db
from src.infrastructure.api.routers import router

app = FastAPI(
    title="Code Lens API",
    description="Git Data Extraction API for Code Lens",
    version="1.0.0"
)

# Initialize database tables on startup
@app.on_event("startup")
def on_startup():
    init_db()

# Include the API routes
app.include_router(router)

@app.get("/health")
def health_check():
    return {"status": "ok"}
