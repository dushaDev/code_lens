from pydantic import BaseModel, ConfigDict
from typing import List, Optional
from datetime import datetime

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

class CommitResponse(BaseModel):
    hash: str
    project_id: int
    author_id: int
    timestamp: datetime
    message: str
    insertions: int
    deletions: int
    is_squash_suspected: bool
    branches: Optional[str] = None

class ProjectResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    git_url: str
    local_saved_path: str
    created_at: datetime

class FileChangeResponse(BaseModel):
    id: int
    filename: str
    status: str
    lines_added: int
    lines_removed: int
    raw_diff: Optional[str] = None

class CommitWithProjectAndFilesResponse(BaseModel):
    hash: str
    project_id: int
    author_id: int
    timestamp: datetime
    message: str
    insertions: int
    deletions: int
    is_squash_suspected: bool
    branches: Optional[str] = None
    project: Optional[ProjectResponse] = None
    file_changes: List[FileChangeResponse] = []

class FileChangeProfileResponse(BaseModel):
    filename: str
    status: str
    lines_added: int
    lines_removed: int

    model_config = ConfigDict(from_attributes=True)

class CommitProfileResponse(BaseModel):
    hash: str
    timestamp: datetime
    message: str
    branches: Optional[str] = None
    insertions: int
    deletions: int
    is_squash_suspected: bool
    total_file_changes: int
    file_changes: List[FileChangeProfileResponse] = []

    model_config = ConfigDict(from_attributes=True)

class AuthorFullProfileResponse(BaseModel):
    id: int
    name: str
    email: str
    total_commits: int
    commits: List[CommitProfileResponse] = []

    model_config = ConfigDict(from_attributes=True)

class AuthorResponse(BaseModel):
    id: int
    name: str
    email: str

class AuthorCommitsResponse(BaseModel):
    total_commits: int
    commits: List[CommitResponse]

class ProjectsListResponse(BaseModel):
    total_projects: int
    projects: List[ProjectResponse]

class ProjectAuthorsResponse(BaseModel):
    total_authors: int
    authors: List[AuthorResponse]

class AuthorContributionResponse(BaseModel):
    author_id: int
    name: str
    email: str
    commit_count: int
    lines_added: int
    contribution_percentage: float

class ProjectAnalyticsResponse(BaseModel):
    project_id: int
    gini_coefficient: float
    total_commits: int
    total_insertions: int
    distribution_status: str
    contributions: List[AuthorContributionResponse]

class MergeAuthorsRequest(BaseModel):
    source_author_id: int
    target_author_id: int


