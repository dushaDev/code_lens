from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
import os

from src.infrastructure.database.session import get_db
from src.infrastructure.database.repositories import ProjectRepository, AuthorRepository, CommitRepository, DatabaseService, CourseRepository
from src.infrastructure.services.pydriller_service import PyDrillerService
from src.infrastructure.auth.dependencies import get_current_user
from src.infrastructure.auth.user_repository import UserRepository
from src.infrastructure.auth.hashing import verify_password
from src.infrastructure.auth.jwt import create_access_token
from src.infrastructure.database.models import UserModel, CourseModel, ProjectModel, AuthorModel, CommitModel
from src.infrastructure.api.schemas import (
    ProjectCreateRequest, ProjectCreateResponse, ExtractResponse, ErrorResponse,
    CommitResponse, AuthorFullProfileResponse, ProjectResponse, FileChangeResponse, CommitWithProjectAndFilesResponse,
    AuthorResponse, FileChangeProfileResponse, CommitProfileResponse,
    AuthorCommitsResponse, ProjectsListResponse, ProjectAuthorsResponse,
    ProjectAnalyticsResponse, MergeAuthorsRequest, AuthorsListResponse, BranchesListResponse, BranchResponse,
    FileChangeMetricsResponse, FileChangeASTResponse, ASTNodeResponse,
    CourseCreateRequest, CourseResponse, CoursesListResponse,
    UserRegisterRequest, UserResponse, UserUpdateRequest, UsersListResponse, TokenResponse, LoginRequest,
    CourseResetRequest, SystemResetRequest, SearchResultItem, SearchResponse
)
from src.use_cases.extract_git_history import ExtractGitHistoryUseCase
from src.use_cases.get_author_commits import (
    GetAuthorCommitsUseCase, GetAuthorFullProfileUseCase,
    GetAllProjectsUseCase, GetProjectsByAuthorUseCase, GetProjectAuthorsUseCase,
    ResetDatabaseUseCase, ResetCourseUseCase, MergeAuthorsUseCase
)
from src.use_cases.get_project_analytics import GetProjectAnalyticsUseCase
from src.use_cases.get_project_details import (
    GetProjectByIdUseCase, GetProjectBranchesUseCase, GetProjectCommitsUseCase
)
from src.use_cases.get_author_details import (
    GetAllAuthorsUseCase, GetAuthorByIdUseCase
)
from src.use_cases.manage_courses import (
    CreateCourseUseCase, GetAllCoursesUseCase, GetCourseByIdUseCase,
    DeleteCourseUseCase, GetCourseProjectsUseCase
)

router = APIRouter(prefix="/api/v1")

# ---------------------------------------------------------------------------
# Auth endpoints (PUBLIC — no token required)
# ---------------------------------------------------------------------------

@router.post(
    "/auth/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["Auth"]
)
def register(request: UserRegisterRequest, db: Session = Depends(get_db)):
    """Register a new user account."""
    user_repo = UserRepository(db)

    if user_repo.get_by_email(request.email):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists."
        )
    if user_repo.get_by_username(request.username):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this username already exists."
        )

    user = user_repo.create(
        username=request.username,
        email=request.email,
        password=request.password
    )
    return UserResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        is_active=user.is_active,
        created_at=user.created_at
    )


@router.post(
    "/auth/login",
    response_model=TokenResponse,
    tags=["Auth"]
)
def login(request: LoginRequest, db: Session = Depends(get_db)):
    """Login with email and password to receive a JWT access token."""
    user_repo = UserRepository(db)
    user = user_repo.get_by_email(request.email)

    if not user or not verify_password(request.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is deactivated."
        )

    token = create_access_token(data={"sub": str(user.id)})
    return TokenResponse(access_token=token)


# ---------------------------------------------------------------------------
# User management endpoints (PROTECTED)
# ---------------------------------------------------------------------------

@router.get(
    "/users",
    response_model=UsersListResponse,
    tags=["Users"],
    responses={401: {"model": ErrorResponse}, 500: {"model": ErrorResponse}}
)
def get_all_users(
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    """List all registered users."""
    user_repo = UserRepository(db)
    users = user_repo.get_all()
    return UsersListResponse(
        total_users=len(users),
        users=[
            UserResponse(id=u.id, username=u.username, email=u.email,
                         is_active=u.is_active, created_at=u.created_at)
            for u in users
        ]
    )


@router.get(
    "/users/me",
    response_model=UserResponse,
    tags=["Users"],
    responses={401: {"model": ErrorResponse}}
)
def get_me(current_user: UserModel = Depends(get_current_user)):
    """Get the currently authenticated user's profile."""
    return UserResponse(
        id=current_user.id,
        username=current_user.username,
        email=current_user.email,
        is_active=current_user.is_active,
        created_at=current_user.created_at
    )


@router.get(
    "/users/{user_id}",
    response_model=UserResponse,
    tags=["Users"],
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}}
)
def get_user_by_id(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    """Get a user by their ID."""
    user_repo = UserRepository(db)
    user = user_repo.get_by_id(user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    return UserResponse(
        id=user.id, username=user.username, email=user.email,
        is_active=user.is_active, created_at=user.created_at
    )


@router.put(
    "/users/{user_id}",
    response_model=UserResponse,
    tags=["Users"],
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}}
)
def update_user(
    user_id: int,
    request: UserUpdateRequest,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    """Update a user's username, email, password, or active status."""
    user_repo = UserRepository(db)

    # Uniqueness checks for changed fields
    if request.email:
        existing = user_repo.get_by_email(request.email)
        if existing and existing.id != user_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Email is already taken by another user."
            )
    if request.username:
        existing = user_repo.get_by_username(request.username)
        if existing and existing.id != user_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Username is already taken by another user."
            )

    user = user_repo.update(
        user_id=user_id,
        username=request.username,
        email=request.email,
        password=request.password,
        is_active=request.is_active
    )
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    return UserResponse(
        id=user.id, username=user.username, email=user.email,
        is_active=user.is_active, created_at=user.created_at
    )


@router.delete(
    "/users/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["Users"],
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}}
)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    """Delete a user account."""
    user_repo = UserRepository(db)
    success = user_repo.delete(user_id)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    return None


# ---------------------------------------------------------------------------
# Course endpoints (PROTECTED)
# ---------------------------------------------------------------------------

@router.post(
    "/courses",
    response_model=CourseResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["Courses"]
)
def create_course(
    request: CourseCreateRequest,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    course_repo = CourseRepository(db)
    use_case = CreateCourseUseCase(course_repo)
    try:
        course = use_case.execute(name=request.name, description=request.description)
        return CourseResponse(
            id=course.id,
            name=course.name,
            description=course.description,
            created_at=course.created_at
        )
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get(
    "/courses",
    response_model=CoursesListResponse,
    tags=["Courses"],
    responses={401: {"model": ErrorResponse}, 500: {"model": ErrorResponse}}
)
def get_all_courses(
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    course_repo = CourseRepository(db)
    use_case = GetAllCoursesUseCase(course_repo)
    try:
        courses = use_case.execute()
        courses_list = [
            CourseResponse(id=c.id, name=c.name, description=c.description, created_at=c.created_at)
            for c in courses
        ]
        return CoursesListResponse(total_courses=len(courses_list), courses=courses_list)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get(
    "/courses/{course_id}",
    response_model=CourseResponse,
    tags=["Courses"],
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}}
)
def get_course_by_id(
    course_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    course_repo = CourseRepository(db)
    use_case = GetCourseByIdUseCase(course_repo)
    try:
        course = use_case.execute(course_id)
        return CourseResponse(
            id=course.id,
            name=course.name,
            description=course.description,
            created_at=course.created_at
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.delete(
    "/courses/{course_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["Courses"],
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}}
)
def delete_course(
    course_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    course_repo = CourseRepository(db)
    use_case = DeleteCourseUseCase(course_repo)
    try:
        use_case.execute(course_id)
        return None
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get(
    "/courses/{course_id}/projects",
    response_model=ProjectsListResponse,
    tags=["Courses"],
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}}
)
def get_course_projects(
    course_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    course_repo = CourseRepository(db)
    use_case = GetCourseProjectsUseCase(course_repo)
    try:
        projects = use_case.execute(course_id)
        projects_list = [
            ProjectResponse(
                id=p.id,
                name=p.name,
                description=p.description,
                git_url=p.git_url,
                local_saved_path=p.local_saved_path,
                group_no=p.group_no,
                tech_stack=p.tech_stack,
                created_at=p.created_at,
                course_id=p.course_id
            )
            for p in projects
        ]
        return ProjectsListResponse(total_projects=len(projects_list), projects=projects_list)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


# ---------------------------------------------------------------------------
# Project endpoints (PROTECTED)
# ---------------------------------------------------------------------------

@router.post(
    "/projects",
    response_model=ProjectCreateResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["Projects"]
)
def create_project(
    request: ProjectCreateRequest,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    course_repo = CourseRepository(db)
    repo = ProjectRepository(db)

    # Validate course exists before creating project
    course = course_repo.get_by_id(request.course_id)
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Course with ID {request.course_id} not found."
        )

    # 1. Create project row to flush / populate project ID
    project = repo.create(
        name=request.name,
        description=request.description,
        git_url=request.git_url,
        course_id=request.course_id,
        group_no=request.group_no
    )

    # 2. Update project with unique local path using its ID
    local_path = f"./temp_repos/{project.id}/repo"
    repo.update_local_path(project.id, local_path)

    return ProjectCreateResponse(
        project_id=project.id, 
        name=project.name, 
        course_id=project.course_id,
        group_no=project.group_no,
        tech_stack=project.tech_stack
    )


@router.post(
    "/extract/{project_id}",
    response_model=ExtractResponse,
    tags=["Projects"],
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}}
)
def extract_git_data(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    project_repo = ProjectRepository(db)
    extractor_service = PyDrillerService(db)
    use_case = ExtractGitHistoryUseCase(project_repo, extractor_service)

    try:
        result = use_case.execute(project_id)
        return ExtractResponse(**result)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except RuntimeError as e:
        # Human-readable errors raised by PyDrillerService (clone failure, etc.)
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"{type(e).__name__}: {str(e)}"
        )


@router.delete(
    "/projects/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["Projects"],
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}}
)
def delete_project(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    repo = ProjectRepository(db)
    success = repo.delete(project_id)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return None


@router.get(
    "/projects",
    response_model=ProjectsListResponse,
    tags=["Projects"],
    responses={401: {"model": ErrorResponse}, 500: {"model": ErrorResponse}}
)
def get_all_projects(
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    project_repo = ProjectRepository(db)
    use_case = GetAllProjectsUseCase(project_repo)
    try:
        projects = use_case.execute()
        projects_list = [
            ProjectResponse(
                id=p.id,
                name=p.name,
                description=p.description,
                git_url=p.git_url,
                local_saved_path=p.local_saved_path,
                created_at=p.created_at,
                course_id=p.course_id
            )
            for p in projects
        ]
        return ProjectsListResponse(total_projects=len(projects_list), projects=projects_list)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get(
    "/projects/{project_id}",
    response_model=ProjectResponse,
    tags=["Projects"],
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}}
)
def get_project_by_id(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    project_repo = ProjectRepository(db)
    use_case = GetProjectByIdUseCase(project_repo)
    try:
        p = use_case.execute(project_id)
        return ProjectResponse(
            id=p.id,
            name=p.name,
            description=p.description,
            git_url=p.git_url,
            local_saved_path=p.local_saved_path,
            created_at=p.created_at,
            course_id=p.course_id
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get(
    "/projects/{project_id}/branches",
    response_model=BranchesListResponse,
    tags=["Projects"],
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}}
)
def get_project_branches(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    project_repo = ProjectRepository(db)
    commit_repo = CommitRepository(db)
    use_case = GetProjectBranchesUseCase(project_repo, commit_repo)
    try:
        branches = use_case.execute(project_id)
        branches_list = [
            BranchResponse(
                id=b.id,
                project_id=b.project_id,
                name=b.name,
                short_name=b.short_name
            )
            for b in branches
        ]
        return BranchesListResponse(total_branches=len(branches_list), branches=branches_list)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get(
    "/projects/{project_id}/commits",
    response_model=AuthorCommitsResponse,
    tags=["Projects"],
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}}
)
def get_project_commits(
    project_id: int,
    branch: Optional[str] = None,
    author_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    project_repo = ProjectRepository(db)
    commit_repo = CommitRepository(db)
    use_case = GetProjectCommitsUseCase(project_repo, commit_repo)
    try:
        commits = use_case.execute(project_id, branch=branch, author_id=author_id)
        commits_list = [
            CommitResponse(
                hash=c.hash,
                project_id=c.project_id,
                author_id=c.author_id,
                timestamp=c.timestamp,
                message=c.message,
                insertions=c.insertions,
                deletions=c.deletions,
                is_squash_suspected=c.is_squash_suspected,
                branches=",".join([b.short_name for b in c.branches]) if c.branches else None
            )
            for c in commits
        ]
        return AuthorCommitsResponse(total_commits=len(commits_list), commits=commits_list)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get(
    "/projects/{project_id}/authors",
    response_model=ProjectAuthorsResponse,
    tags=["Projects"],
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}}
)
def get_project_authors(
    project_id: int,
    branch: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    project_repo = ProjectRepository(db)
    author_repo = AuthorRepository(db)
    use_case = GetProjectAuthorsUseCase(project_repo, author_repo)
    try:
        authors = use_case.execute(project_id, branch=branch)
        authors_list = [
            AuthorResponse(id=a.id, name=a.name, email=a.email)
            for a in authors
        ]
        return ProjectAuthorsResponse(total_authors=len(authors_list), authors=authors_list)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get(
    "/projects/{project_id}/analytics",
    response_model=ProjectAnalyticsResponse,
    tags=["Projects"],
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}}
)
def get_project_analytics(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    project_repo = ProjectRepository(db)
    author_repo = AuthorRepository(db)
    commit_repo = CommitRepository(db)
    use_case = GetProjectAnalyticsUseCase(project_repo, author_repo, commit_repo)
    try:
        return use_case.execute(project_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get(
    "/commits/{commit_hash}",
    response_model=CommitWithProjectAndFilesResponse,
    tags=["Commits"],
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}}
)
def get_commit_by_hash(
    commit_hash: str,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    """Retrieve detailed commit information, including the project and the list of file changes."""
    from src.infrastructure.database.models import CommitModel
    commit = db.query(CommitModel).filter(CommitModel.hash == commit_hash).first()
    if not commit:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Commit with hash {commit_hash} not found."
        )
    
    proj = commit.project
    project_resp = ProjectResponse(
        id=proj.id,
        name=proj.name,
        description=proj.description,
        git_url=proj.git_url,
        local_saved_path=proj.local_saved_path,
        group_no=proj.group_no,
        tech_stack=proj.tech_stack or [],
        created_at=proj.created_at,
        course_id=proj.course_id
    ) if proj else None

    file_changes_resp = [
        FileChangeResponse(
            id=fc.id,
            filename=fc.filename,
            status=fc.status,
            lines_added=fc.lines_added,
            lines_removed=fc.lines_removed,
            raw_diff=fc.raw_diff
        )
        for fc in commit.file_changes
    ]

    return CommitWithProjectAndFilesResponse(
        hash=commit.hash,
        project_id=commit.project_id,
        author_id=commit.author_id,
        timestamp=commit.timestamp,
        message=commit.message,
        insertions=commit.insertions,
        deletions=commit.deletions,
        is_squash_suspected=commit.is_squash_suspected,
        branches=",".join([b.short_name for b in commit.branches]) if commit.branches else None,
        project=project_resp,
        file_changes=file_changes_resp
    )


# ---------------------------------------------------------------------------
# Author endpoints (PROTECTED)
# ---------------------------------------------------------------------------

@router.get(
    "/authors",
    response_model=AuthorsListResponse,
    tags=["Authors"],
    responses={401: {"model": ErrorResponse}, 500: {"model": ErrorResponse}}
)
def get_all_authors(
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    author_repo = AuthorRepository(db)
    use_case = GetAllAuthorsUseCase(author_repo)
    try:
        authors = use_case.execute()
        authors_list = [
            AuthorResponse(id=a.id, name=a.name, email=a.email)
            for a in authors
        ]
        return AuthorsListResponse(total_authors=len(authors_list), authors=authors_list)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get(
    "/authors/{author_id}",
    response_model=AuthorResponse,
    tags=["Authors"],
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}}
)
def get_author_by_id(
    author_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    author_repo = AuthorRepository(db)
    use_case = GetAuthorByIdUseCase(author_repo)
    try:
        a = use_case.execute(author_id)
        return AuthorResponse(id=a.id, name=a.name, email=a.email)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get(
    "/authors/{author_id}/commits",
    response_model=AuthorCommitsResponse,
    tags=["Authors"],
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}}
)
def get_author_commits(
    author_id: int,
    project_id: Optional[int] = None,
    branch: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    author_repo = AuthorRepository(db)
    commit_repo = CommitRepository(db)
    use_case = GetAuthorCommitsUseCase(author_repo, commit_repo)
    try:
        commits = use_case.execute(author_id, project_id=project_id, branch=branch)
        commits_list = [
            CommitResponse(
                hash=c.hash,
                project_id=c.project_id,
                author_id=c.author_id,
                timestamp=c.timestamp,
                message=c.message,
                insertions=c.insertions,
                deletions=c.deletions,
                is_squash_suspected=c.is_squash_suspected,
                branches=",".join([b.short_name for b in c.branches]) if c.branches else None
            )
            for c in commits
        ]
        return AuthorCommitsResponse(total_commits=len(commits_list), commits=commits_list)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get(
    "/authors/{author_id}/full-profile",
    response_model=AuthorFullProfileResponse,
    tags=["Authors"],
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}}
)
def get_author_full_profile(
    author_id: int,
    project_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    author_repo = AuthorRepository(db)
    project_repo = ProjectRepository(db)
    use_case = GetAuthorFullProfileUseCase(author_repo, project_repo)
    try:
        author = use_case.execute(author_id, project_id=project_id)

        commits_resp = []
        for c in author.commits:
            file_changes_resp = [
                FileChangeProfileResponse(
                    filename=fc.filename,
                    status=fc.status,
                    lines_added=fc.lines_added,
                    lines_removed=fc.lines_removed
                )
                for fc in c.file_changes
            ]

            commits_resp.append(
                CommitProfileResponse(
                    hash=c.hash,
                    timestamp=c.timestamp,
                    message=c.message,
                    branches=",".join([b.short_name for b in c.branches]) if c.branches else None,
                    insertions=c.insertions,
                    deletions=c.deletions,
                    is_squash_suspected=c.is_squash_suspected,
                    total_file_changes=len(file_changes_resp),
                    file_changes=file_changes_resp
                )
            )

        return AuthorFullProfileResponse(
            id=author.id,
            name=author.name,
            email=author.email,
            total_commits=len(commits_resp),
            commits=commits_resp
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get(
    "/authors/{author_id}/projects",
    response_model=ProjectsListResponse,
    tags=["Authors"],
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}}
)
def get_projects_by_author(
    author_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    author_repo = AuthorRepository(db)
    project_repo = ProjectRepository(db)
    use_case = GetProjectsByAuthorUseCase(author_repo, project_repo)
    try:
        projects = use_case.execute(author_id)
        projects_list = [
            ProjectResponse(
                id=p.id,
                name=p.name,
                description=p.description,
                git_url=p.git_url,
                local_saved_path=p.local_saved_path,
                created_at=p.created_at,
                course_id=p.course_id
            )
            for p in projects
        ]
        return ProjectsListResponse(total_projects=len(projects_list), projects=projects_list)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.post(
    "/authors/merge",
    status_code=status.HTTP_200_OK,
    tags=["Authors"],
    responses={400: {"model": ErrorResponse}, 401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}}
)
def merge_authors(
    request: MergeAuthorsRequest,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    author_repo = AuthorRepository(db)
    use_case = MergeAuthorsUseCase(author_repo)
    try:
        use_case.execute(request.source_author_id, request.target_author_id)
        return {"status": "success", "message": f"Author {request.source_author_id} has been merged into Author {request.target_author_id} successfully."}
    except ValueError as e:
        detail = str(e)
        if "not found" in detail:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)
        else:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


# ---------------------------------------------------------------------------
# File / AST endpoints (PROTECTED)
# ---------------------------------------------------------------------------

@router.get(
    "/files/{file_change_id}/metrics",
    response_model=FileChangeMetricsResponse,
    tags=["Files"],
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
    summary="Get stored AST metrics for a file change"
)
def get_file_metrics(
    file_change_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    """Returns the pre-computed AST metrics (complexity, function count, fingerprint)
    that were stored during extraction. Fast — no live parsing."""
    from src.infrastructure.database.models import FileChangeModel
    fc = db.query(FileChangeModel).filter(FileChangeModel.id == file_change_id).first()
    if not fc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File change not found")
    return FileChangeMetricsResponse(
        id=fc.id,
        filename=fc.filename,
        complexity_score=fc.complexity_score,
        function_count=fc.function_count,
        ast_fingerprint=fc.ast_fingerprint,
    )


@router.get(
    "/files/{file_change_id}/ast",
    response_model=FileChangeASTResponse,
    tags=["Files"],
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 422: {"model": ErrorResponse}},
    summary="Get real-time AST tree for a file change"
)
def get_file_ast(
    file_change_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    """Parses the stored source code on-the-fly using tree-sitter and returns
    a simplified, JSON-serialisable AST tree structure.

    Supported languages: Python, JavaScript, TypeScript, Java, Kotlin, Dart, C, C++, Go.
    The full AST is never persisted — it is generated here and discarded after serialisation."""
    from src.infrastructure.database.models import FileChangeModel
    from src.infrastructure.services.ast_parser import build_ast_tree, get_language_for_file, supported_languages

    fc = db.query(FileChangeModel).filter(FileChangeModel.id == file_change_id).first()
    if not fc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File change not found")

    # Detect language from file extension
    language = get_language_for_file(fc.filename)
    if language is None:
        ext = "." + fc.filename.rsplit(".", 1)[-1].lower() if "." in fc.filename else "(none)"
        return FileChangeASTResponse(
            file_change_id=file_change_id,
            filename=fc.filename,
            language="unsupported",
            ast=None,
            error=(
                f"File extension '{ext}' is not supported for AST analysis. "
                f"Supported languages: {', '.join(supported_languages())}."
            )
        )

    # Reconstruct source from diff (added lines only)
    source_code: str | None = None
    if fc.raw_diff:
        lines = [
            line[1:]
            for line in fc.raw_diff.splitlines()
            if line.startswith("+") and not line.startswith("+++")
        ]
        source_code = "\n".join(lines) if lines else None

    if not source_code:
        return FileChangeASTResponse(
            file_change_id=file_change_id,
            filename=fc.filename,
            language=language,
            ast=None,
            error="No source code available for this file change record."
        )

    tree_dict = build_ast_tree(source_code, language)
    if tree_dict is None:
        return FileChangeASTResponse(
            file_change_id=file_change_id,
            filename=fc.filename,
            language=language,
            ast=None,
            error="tree-sitter failed to parse the source code."
        )

    return FileChangeASTResponse(
        file_change_id=file_change_id,
        filename=fc.filename,
        language=language,
        ast=ASTNodeResponse(**tree_dict),
    )


@router.get(
    "/ast/supported-languages",
    tags=["Files"],
    summary="List languages supported for AST analysis"
)
def get_supported_languages(
    current_user: UserModel = Depends(get_current_user)
):
    """Returns the list of programming languages currently supported for AST parsing."""
    from src.infrastructure.services.ast_parser import supported_languages, EXTENSION_TO_LANGUAGE
    return {
        "supported_languages": supported_languages(),
        "file_extensions": EXTENSION_TO_LANGUAGE,
    }


# ---------------------------------------------------------------------------
# System endpoints (PROTECTED)
# ---------------------------------------------------------------------------

@router.post(
    "/system/reset",
    status_code=status.HTTP_200_OK,
    tags=["System"],
    responses={401: {"model": ErrorResponse}, 500: {"model": ErrorResponse}}
)
def reset_database(
    request: SystemResetRequest,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    """Full database wipe (deletes all courses, projects, authors, commits, file changes).
    Verifies user password. Does NOT delete users table."""
    if not verify_password(request.password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect password verification."
        )

    db_service = DatabaseService(db)
    use_case = ResetDatabaseUseCase(db_service)
    try:
        use_case.execute()
        return {"status": "success", "message": "Full database has been reset successfully."}
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.post(
    "/courses/{course_id}/reset",
    status_code=status.HTTP_200_OK,
    tags=["Courses"],
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}}
)
def reset_course(
    course_id: int,
    request: CourseResetRequest,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    """Clear all projects and related commits, branches, file changes for a specific course.
    Verifies user password."""
    # Verify course exists
    course_repo = CourseRepository(db)
    if not course_repo.get_by_id(course_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Course with ID {course_id} not found."
        )

    if not verify_password(request.password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect password verification."
        )

    db_service = DatabaseService(db)
    use_case = ResetCourseUseCase(db_service)
    try:
        use_case.execute(course_id)
        return {"status": "success", "message": f"Course projects and data cleared successfully."}
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

@router.get(
    "/search",
    response_model=SearchResponse,
    tags=["Search"]
)
def global_search(
    q: str,
    course_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    """Global search projects, students (authors), commits, and courses by query string."""
    if not q or len(q.strip()) < 2:
        return SearchResponse(results=[])

    query_str = f"%{q.strip()}%"
    results = []

    # 1. Search projects
    proj_query = db.query(ProjectModel)
    if course_id:
        proj_query = proj_query.filter(ProjectModel.course_id == course_id)
    projects = proj_query.filter(ProjectModel.name.ilike(query_str)).limit(5).all()
    for p in projects:
        results.append(
            SearchResultItem(
                id=f"project-{p.id}",
                type="project",
                title=p.name,
                subtitle=f"Git URL: {p.git_url}",
                project_id=p.id
            )
        )

    # 2. Search students (authors)
    author_query = db.query(AuthorModel).join(CommitModel).join(ProjectModel)
    if course_id:
        author_query = author_query.filter(ProjectModel.course_id == course_id)
    authors = author_query.filter(
        (AuthorModel.name.ilike(query_str)) | (AuthorModel.email.ilike(query_str))
    ).distinct().limit(5).all()
    for a in authors:
        results.append(
            SearchResultItem(
                id=f"student-{a.id}",
                type="student",
                title=a.name,
                subtitle=a.email
            )
        )

    # 3. Search commits
    commit_query = db.query(CommitModel).join(ProjectModel)
    if course_id:
        commit_query = commit_query.filter(ProjectModel.course_id == course_id)
    commits = commit_query.filter(
        (CommitModel.message.ilike(query_str)) | (CommitModel.hash.ilike(query_str))
    ).limit(5).all()
    for c in commits:
        results.append(
            SearchResultItem(
                id=f"commit-{c.hash}",
                type="commit",
                title=c.message,
                subtitle=f"Commit: {c.hash[:8]} in project {c.project.name}",
                project_id=c.project_id
            )
        )

    # 4. Search courses (global context)
    courses = db.query(CourseModel).filter(CourseModel.name.ilike(query_str)).limit(3).all()
    for co in courses:
        results.append(
            SearchResultItem(
                id=f"course-{co.id}",
                type="course",
                title=co.name,
                subtitle=co.description or "No description"
            )
        )

    return SearchResponse(results=results)
