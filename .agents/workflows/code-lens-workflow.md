---
description: This document outlines the standard operating procedures and execution workflows the Antigravity Agent must follow when implementing or triggering Phase 1 of the Code Lens system.
---

Git Extraction & Squash Heuristics Workflow

When writing the PyDriller extraction service or executing a repository analysis, strictly follow this chronological workflow:

Step 1: Repository Ingestion
Clone the target git_url locally into an isolated, unique temporary directory formatted as: /temp_repos/{project_id}.

Step 2: Commit Traversal
Iterate through all repository commits. You must configure PyDriller with only_no_merge=True to filter out standard merge commits unless the specific use case dictates otherwise.

Step 3: Squash Detection Heuristics (Crucial)
Evaluate every commit against the following conditions. If ANY condition is true, set is_squash_suspected = True:

The commit.insertions exceeds 500 lines.

The commit message body contains the exact string "Co-authored-by:".

The commit message subject header ends with a PR regex pattern: \(#\d+\)$.

Step 4: Data Isolation & Author Mapping
Extract the author's email. Query the authors table. If the email does not exist, insert a new Author record BEFORE inserting the commit. Map the commit to the resolved author_id.

Step 5: Mandatory Garbage Collection
Immediately upon successful extraction and database commit, delete the local cloned repository directory from the host disk. Do not leave orphaned clones.

Development & Testing Workflow

When generating code or tests for this system, the agent must output:

Runnable Scaffolding: A fully configured FastAPI setup (main.py) with complete dependency injection.

Database Initialization: Scripts or lifecycle events that trigger Base.metadata.create_all to spin up tables automatically on launch.

Pydantic Validation: Explicit schemas mapping to the API routes: POST /api/v1/projects, POST /api/v1/extract/{project_id}, and DELETE /api/v1/projects/{project_id}.

Standardized Connections: Default to the synchronous PostgreSQL connection string for testing: postgresql://postgres:admin@localhost:5432/codelens_db.