import re
from pydantic import BaseModel, ConfigDict, EmailStr, field_validator
from typing import List, Optional
from datetime import datetime

GIT_URL_REGEX = re.compile(r'^(https?|git)://[^\s<>"\'{}|\\^`]+$', re.IGNORECASE)

def validate_password_strength_logic(v: str) -> None:
    if not v or len(v) < 8:
        raise ValueError("Password must be at least 8 characters long.")
    if not re.search(r"[A-Za-z]", v) or not re.search(r"[0-9!@#$%^&*()_+\-=\[\]{};':\",./<>?]", v):
        raise ValueError("Password must contain both letters and numbers or special characters.")

# ---------------------------------------------------------------------------
# Auth schemas
# ---------------------------------------------------------------------------

class UserRegisterRequest(BaseModel):
    username: str
    email: EmailStr
    password: str

    @field_validator('password')
    @classmethod
    def validate_password_strength(cls, v: str) -> str:
        validate_password_strength_logic(v)
        return v

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
    is_dark_mode: bool = False
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class UserUpdateRequest(BaseModel):
    username: Optional[str] = None
    email: Optional[EmailStr] = None
    password: Optional[str] = None
    is_active: Optional[bool] = None
    github_username: Optional[str] = None
    is_dark_mode: Optional[bool] = None

    @field_validator('password')
    @classmethod
    def validate_password_strength(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            validate_password_strength_logic(v)
        return v


class UsersListResponse(BaseModel):
    total_users: int
    users: List[UserResponse]

# ---------------------------------------------------------------------------
# API Key schemas
# ---------------------------------------------------------------------------

class UserApiKeyCreateRequest(BaseModel):
    name: str
    provider: Optional[str] = "Gemini"
    api_key: str

class UserApiKeyResponse(BaseModel):
    id: int
    name: str
    provider: str
    masked_key: str
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

# ---------------------------------------------------------------------------
# Course schemas
# ---------------------------------------------------------------------------

class CourseCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None
    tech_requirements: Optional[str] = None
    deadline: Optional[datetime] = None
    default_sampling_mode: Optional[str] = "sample"

class CourseUpdateRequest(BaseModel):
    """Partial update — only the fields actually sent are applied. Sending an
    explicit null clears that field, so a deadline can be removed later."""
    name: Optional[str] = None
    description: Optional[str] = None
    tech_requirements: Optional[str] = None
    deadline: Optional[datetime] = None
    default_sampling_mode: Optional[str] = None

class CourseResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    tech_requirements: Optional[str] = None
    deadline: Optional[datetime] = None
    has_api_key: Optional[bool] = False
    masked_api_key: Optional[str] = None
    default_sampling_mode: Optional[str] = "sample"
    created_at: datetime

class ApiKeySaveRequest(BaseModel):
    api_key: str

class ApiKeyStatusResponse(BaseModel):
    has_api_key: bool
    masked_api_key: Optional[str] = None
    message: Optional[str] = None

class CloudReportResponse(BaseModel):
    report: str
    model: str = "gemini-1.5-flash"
    project_id: int

class CoursesListResponse(BaseModel):
    total_courses: int
    courses: List[CourseResponse]

class ProjectCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None
    git_url: str
    course_id: int
    group_no: str
    store_local_copy: Optional[bool] = True

    @field_validator('git_url')
    @classmethod
    def validate_git_url(cls, v: str) -> str:
        if not v or not isinstance(v, str):
            raise ValueError("git_url must be a non-empty string.")
        v_clean = v.strip()
        if v_clean.startswith("-"):
            raise ValueError("Invalid git_url: URL cannot start with a hyphen.")
        if not GIT_URL_REGEX.match(v_clean):
            raise ValueError("Invalid git_url: Only HTTP(S) and Git protocols (e.g. https://github.com/user/repo.git) are allowed.")
        return v_clean

class ProjectCreateResponse(BaseModel):
    project_id: int
    name: str
    course_id: int
    group_no: Optional[str] = "G-00"
    tech_stack: List[str] = []
    store_local_copy: bool = True
    is_local_copy_stored: bool = True
    sampling_mode: Optional[str] = "sample"

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
    store_local_copy: bool = True
    is_local_copy_stored: bool = True
    tech_stack: List[str] = []
    created_at: datetime
    course_id: Optional[int] = None
    sampling_mode: Optional[str] = "sample"

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

class CommitVerificationResponse(BaseModel):
    hash: str
    author_name: str
    message: str
    match_percentage: int
    reason: str

class AuthorQualitativeProfileResponse(BaseModel):
    author_id: int
    name: str
    email: str
    commit_count: int
    total_insertions: int
    squash_count: int
    risk_flag: str

class ArchitectureAnalysisResponse(BaseModel):
    pattern_name: str
    accuracy_score: int
    assessment: str

class QualitativeAnalysisResponse(BaseModel):
    project_id: int
    overall_truthfulness_score: int
    executive_summary: str
    architecture_analysis: Optional[ArchitectureAnalysisResponse] = None
    commit_verifications: List[CommitVerificationResponse]
    author_profiles: List[AuthorQualitativeProfileResponse]

class StudentReportRow(BaseModel):
    student_name: str = "Unknown Contributor"
    commits_summary: Optional[str] = "N/A"
    substance_breakdown: Optional[str] = "N/A"
    pacing_and_deadlines: Optional[str] = "N/A"
    quality_and_integrity_signals: Optional[str] = "N/A"
    verdict: Optional[str] = "No verdict provided."

class CloudReportData(BaseModel):
    executive_summary: Optional[str] = "Executive summary not provided."
    work_distribution_and_fairness: Optional[str] = "Work distribution details not provided."
    student_evaluations: Optional[List[StudentReportRow]] = []
    academic_integrity_anomalies: Optional[str] = "No anomalies detailed."
    overall_project_risk_score: Optional[str] = "5/10 (Moderate)"
    actionable_recommendations: Optional[List[str]] = []

