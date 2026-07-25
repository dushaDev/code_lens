import os
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

from src.infrastructure.database.models import Base

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:admin@localhost:5432/codelens_db")

engine = create_engine(DATABASE_URL, echo=False)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def init_db():
    Base.metadata.create_all(bind=engine)
    # Proactively inspect and run schema migration to add group_no if missing
    try:
        inspector = inspect(engine)
        columns = [col['name'] for col in inspector.get_columns('projects')]
        if 'group_no' not in columns:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE projects ADD COLUMN group_no VARCHAR NOT NULL DEFAULT 'G-00';"))
    except Exception as e:
        print(f"Database migration check failed/skipped: {e}")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
