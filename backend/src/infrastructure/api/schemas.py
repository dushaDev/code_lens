from pydantic import BaseModel
from typing import Optional

class ProjectCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None
    git_url: str

class ProjectCreateResponse(BaseModel):
    project_id: int
    name: str

class ExtractResponse(BaseModel):
    status: str
    total_commits: int
    total_authors: int
    squash_warnings: int

class ErrorResponse(BaseModel):
    detail: str
