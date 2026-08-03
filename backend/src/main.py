from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

from src.infrastructure.database.session import init_db
from src.infrastructure.api.routers import router
from src.infrastructure.api.similarity_router import similarity_router

app = FastAPI(
    title="Code Lens API",
    description="Git Data Extraction API for Code Lens",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize database tables on startup
@app.on_event("startup")
def on_startup():
    init_db()

# Include the API routes
app.include_router(router)
app.include_router(similarity_router)

@app.get("/health")
def health_check():
    return {"status": "ok"}
