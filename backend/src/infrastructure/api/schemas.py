from pydantic import BaseModel, ConfigDict, EmailStr
from typing import List, Optional
from datetime import datetime

# ---------------------------------------------------------------------------
# Auth schemas
# ---------------------------------------------------------------------------

class UserRegisterRequest(BaseModel):
    username: str
    email: EmailStr
    password: str

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class CourseResetRequest(BaseModel):
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"

# ---------------------------------------------------------------------------
# User CRUD schemas
# ---------------------------------------------------------------------------

class UserResponse(BaseModel):
    id: int
    username: str
    email: str
    is_active: bool
    github_username: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class UserUpdateRequest(BaseModel):
    username: Optional[str] = None
    email: Optional[EmailStr] = None
    password: Optional[str] = None
    is_active: Optional[bool] = None
    github_username: Optional[str] = None

class UsersListResponse(BaseModel):
    total_users: int
    users: List[UserResponse]

# ---------------------------------------------------------------------------
# Course schemas
# ---------------------------------------------------------------------------

class CourseCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None

class CourseResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    created_at: datetime

class CoursesListResponse(BaseModel):
    total_courses: int
    courses: List[CourseResponse]

class ProjectCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None
    git_url: str
    course_id: int
    group_no: str

class ProjectCreateResponse(BaseModel):
    project_id: int
    name: str
    course_id: int
    group_no: Optional[str] = "G-00"
    tech_stack: List[str] = []

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
    group_no: Optional[str] = "G-00"
    tech_stack: List[str] = []
    created_at: datetime
    course_id: Optional[int] = None

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
    lines_removed: int = 0
    contribution_percentage: float

class ProjectAnalyticsResponse(BaseModel):
    project_id: int
    gini_coefficient: float
    total_commits: int
    total_insertions: int
    distribution_status: str
    contributions: List[AuthorContributionResponse]
    language_distribution: dict

class MergeAuthorsRequest(BaseModel):
    source_author_id: int
    target_author_id: int


class AuthorsListResponse(BaseModel):
    total_authors: int
    authors: List[AuthorResponse]


class BranchResponse(BaseModel):
    id: int
    project_id: int
    name: str
    short_name: str


class BranchesListResponse(BaseModel):
    total_branches: int
    branches: List[BranchResponse]


class FileChangeMetricsResponse(BaseModel):
    """Stored AST metrics for a file change record."""
    id: int
    filename: str
    complexity_score: Optional[int] = None
    function_count: Optional[int] = None
    ast_fingerprint: Optional[str] = None


class ASTNodeResponse(BaseModel):
    """A single node in the simplified real-time AST tree."""
    type: str
    start: tuple
    end: tuple
    is_error: bool = False
    text: Optional[str] = None
    children: Optional[List["ASTNodeResponse"]] = None


ASTNodeResponse.model_rebuild()  # Required for self-referential models


class FileChangeASTResponse(BaseModel):
    """Real-time on-demand AST tree for a specific file change."""
    file_change_id: int
    filename: str
    language: str
    ast: Optional[ASTNodeResponse] = None

class SearchResultItem(BaseModel):
    id: str
    type: str  # "project", "student", "commit", "course"
    title: str
    subtitle: str
    project_id: Optional[int] = None

class SearchResponse(BaseModel):
    results: List[SearchResultItem]
    error: Optional[str] = None
