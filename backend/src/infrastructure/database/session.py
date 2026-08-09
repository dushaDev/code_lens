import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

from src.infrastructure.database.models import Base

load_dotenv()

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
        if 'qualitative_report' not in columns:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE projects ADD COLUMN qualitative_report TEXT NULL;"))

        # Proactively inspect and run schema migration for optional course metadata
        if inspector.has_table('courses'):
            course_columns = [col['name'] for col in inspector.get_columns('courses')]
            if 'tech_requirements' not in course_columns:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE courses ADD COLUMN tech_requirements TEXT NULL;"))
            if 'deadline' not in course_columns:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE courses ADD COLUMN deadline TIMESTAMP NULL;"))
            if 'encrypted_api_key' not in course_columns:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE courses ADD COLUMN encrypted_api_key TEXT NULL;"))

        # Proactively inspect and run schema migration for similarity_reports.status if missing
        if inspector.has_table('similarity_reports'):
            sim_columns = [col['name'] for col in inspector.get_columns('similarity_reports')]
            if 'status' not in sim_columns:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE similarity_reports ADD COLUMN status VARCHAR DEFAULT 'Needs Review';"))
    except Exception as e:
        print(f"Database migration check failed/skipped: {e}")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
