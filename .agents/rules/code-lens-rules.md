---
trigger: always_on
---

You must strictly enforce the following rules regarding directory structure, architectural boundaries, and database schemas.

Directory & Monorepo Structure Rule
The workspace must be maintained as a Monorepo. Keep backend and frontend concerns strictly isolated.

code_lens_project/
├── frontend/                 # (React/Vite Frontend - placeholder)
└── backend/
├── .env                  # DB Credentials and environment configurations
├── requirements.txt      # Python dependencies
└── src/
├── domain/           # Enterprise Business Rules (Entities, Models)
├── use_cases/        # Application Business Rules (Workflows)
├── infrastructure/   # Frameworks, Drivers, Adapters (Web, DB, External APIs)
│   ├── api/          # FastAPI routers, Pydantic schemas
│   ├── database/     # SQLAlchemy engine, ORM models, Repositories
│   └── services/     # External integrations (PyDriller extractor)
└── main.py           # Application Entry Point

Strict Clean Architecture Boundaries

The Dependency Rule: Source code dependencies MUST only point inwards. Inner layers (Domain, Use Cases) cannot import anything from outer layers (Infrastructure, API).

Framework Isolation: Absolutely no FastAPI or SQLAlchemy imports inside the domain/ or use_cases/ directories.

Dependency Inversion: Define abstract base classes (interfaces) in the inner layers and implement them in the infrastructure/ layer.

Database Schema & Relational Integrity Rules
All database models must be implemented using SQLAlchemy 2.0 with the following strict specifications:

A. Projects (projects)

Columns: id (PK), name (String, Non-Null), description (Text), git_url (String, Non-Null), local_saved_path (String, Non-Null), created_at (DateTime).

Relations: One-to-Many with commits (cascade="all, delete-orphan", ondelete="CASCADE").

B. Authors (authors) - Global Scope

Columns: id (PK), name (String, Non-Null), email (String, Unique, Non-Null).

Rule: Deleting a project MUST NOT cascade to delete global authors.

C. Commits (commits)

Columns: hash (PK), project_id (FK projects.id, ondelete="CASCADE"), author_id (FK authors.id), timestamp (DateTime), message (Text), insertions (Int), deletions (Int), is_squash_suspected (Boolean, default=False).

Relations: Many-to-One with projects & authors. One-to-Many with file_changes (cascade="all, delete-orphan", ondelete="CASCADE").

D. File Changes (file_changes)

Columns: id (PK), commit_hash (FK commits.hash, ondelete="CASCADE"), filename (String), status (String), lines_added (Int), lines_removed (Int), raw_diff (Text).

Relations: Many-to-One with commits.