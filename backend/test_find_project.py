from src.infrastructure.database.database import SessionLocal
from src.infrastructure.database.models import ProjectModel

db = SessionLocal()
projects = db.query(ProjectModel).all()
for p in projects:
    print(f"ID: {p.id}, Name: {p.name}, Git URL: {p.git_url}")
