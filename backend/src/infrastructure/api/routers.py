from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
import logging
import os
import json
import io
import datetime
import re
import traceback
from slowapi import Limiter
from slowapi.util import get_remote_address

# Module logger — all 500-level errors are logged here
logger = logging.getLogger(__name__)

# Rate limiter — wired to app state in main.py
limiter = Limiter(key_func=get_remote_address)


from src.domain.constants import EXTENSION_TO_LANGUAGE
from src.infrastructure.database.session import get_db
from src.infrastructure.database.repositories import ProjectRepository, AuthorRepository, CommitRepository, DatabaseService, CourseRepository
from src.infrastructure.services.pydriller_service import PyDrillerService
from src.infrastructure.services.ast_parser import build_ast_tree, get_language_for_file, supported_languages
from src.infrastructure.auth.dependencies import get_current_user
from src.infrastructure.auth.user_repository import UserRepository
from src.infrastructure.auth.hashing import verify_password
from src.infrastructure.auth.jwt import create_access_token
from src.infrastructure.database.models import UserModel, UserApiKeyModel, CourseModel, ProjectModel, AuthorModel, CommitModel, FileChangeModel
from src.infrastructure.api.schemas import (
    ProjectCreateRequest, ProjectCreateResponse, ExtractResponse, ErrorResponse,
    CommitResponse, AuthorFullProfileResponse, ProjectResponse, FileChangeResponse, CommitWithProjectAndFilesResponse,
    AuthorResponse, FileChangeProfileResponse, CommitProfileResponse,
    AuthorCommitsResponse, ProjectsListResponse, ProjectAuthorsResponse,
    ProjectAnalyticsResponse, MergeAuthorsRequest, AuthorsListResponse, BranchesListResponse, BranchResponse,
    FileChangeMetricsResponse, FileChangeASTResponse, ASTNodeResponse,
    CourseCreateRequest, CourseUpdateRequest, CourseResponse, CoursesListResponse,
    UserRegisterRequest, UserResponse, UserUpdateRequest, UsersListResponse, TokenResponse, LoginRequest,
    UserApiKeyCreateRequest, UserApiKeyResponse,
    CourseResetRequest, SearchResultItem, SearchResponse, QualitativeAnalysisResponse,
    ApiKeySaveRequest, ApiKeyStatusResponse, CloudReportResponse, CloudReportData
)
from src.infrastructure.auth.crypto import encrypt_api_key, decrypt_api_key, mask_api_key
from src.use_cases.get_cloud_report import generate_cloud_report, render_pdf_report
from src.use_cases.extract_git_history import ExtractGitHistoryUseCase
from src.use_cases.get_author_commits import (
    GetAuthorCommitsUseCase, GetAuthorFullProfileUseCase,
    GetAllProjectsUseCase, GetProjectsByAuthorUseCase, GetProjectAuthorsUseCase,
    ResetCourseUseCase, MergeAuthorsUseCase
)
from src.use_cases.get_project_files import (
    GetProjectFileTreeUseCase, GetProjectFileContentUseCase
)
from src.use_cases.get_project_analytics import GetProjectAnalyticsUseCase
from src.use_cases.get_qualitative_analysis import GetQualitativeAnalysisUseCase, cancel_qualitative_analysis, get_project_analysis_status, extract_extended_quantitative_metrics
from src.use_cases.get_project_details import (
    GetProjectByIdUseCase, GetProjectBranchesUseCase, GetProjectCommitsUseCase
)
from src.use_cases.get_author_details import (
    GetAllAuthorsUseCase, GetAuthorByIdUseCase
)
from src.use_cases.manage_courses import (
    CreateCourseUseCase, GetAllCoursesUseCase, GetCourseByIdUseCase,
    DeleteCourseUseCase, GetCourseProjectsUseCase, UpdateCourseUseCase
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
@limiter.limit("3/minute")
def register(request: UserRegisterRequest, req: Request, db: Session = Depends(get_db)):
    """Register a new user account."""
    user_repo = UserRepository(db)

    if user_repo.get_by_email(request.email) or user_repo.get_by_username(request.username):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Registration failed: an account with these details already exists."
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
        github_username=user.github_username,
        is_dark_mode=user.is_dark_mode,
        created_at=user.created_at
    )


@router.post(
    "/auth/login",
    response_model=TokenResponse,
    tags=["Auth"]
)
@limiter.limit("5/minute")
def login(request: LoginRequest, req: Request, db: Session = Depends(get_db)):
    """Login with email and password to receive a JWT access token."""
    user_repo = UserRepository(db)
    user = user_repo.get_by_email(request.email)

    if not user or not verify_password(request.password, user.password):
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
    """Return only the currently authenticated user's own record.
    Full user-directory listing is intentionally removed to prevent email harvesting."""
    return UsersListResponse(
        total_users=1,
        users=[
            UserResponse(
                id=current_user.id,
                username=current_user.username,
                email=current_user.email,
                is_active=current_user.is_active,
                github_username=current_user.github_username,
                is_dark_mode=current_user.is_dark_mode,
                created_at=current_user.created_at
            )
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
        github_username=current_user.github_username,
        is_dark_mode=current_user.is_dark_mode,
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
        is_active=user.is_active, github_username=user.github_username,
        is_dark_mode=user.is_dark_mode, created_at=user.created_at
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
        is_active=request.is_active,
        github_username=request.github_username,
        is_dark_mode=request.is_dark_mode
    )
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    return UserResponse(
        id=user.id, username=user.username, email=user.email,
        is_active=user.is_active, github_username=user.github_username,
        is_dark_mode=user.is_dark_mode, created_at=user.created_at
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
# User API Key Management endpoints
# ---------------------------------------------------------------------------

@router.get(
    "/user/api-keys",
    response_model=List[UserApiKeyResponse],
    tags=["User API Keys"]
)
def list_user_api_keys(
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    """List all API keys stored by the current user."""
    keys = db.query(UserApiKeyModel).filter(UserApiKeyModel.user_id == current_user.id).order_by(UserApiKeyModel.created_at.desc()).all()
    if not keys:
        # Check if user's courses have any encrypted_api_key stored
        courses = db.query(CourseModel).filter(CourseModel.user_id == current_user.id).all()
        for course in courses:
            if course.encrypted_api_key:
                plain = decrypt_api_key(course.encrypted_api_key)
                if plain:
                    migrated = UserApiKeyModel(
                        user_id=current_user.id,
                        name=f"Migrated Key ({course.name})",
                        provider="AgentRouter" if plain.startswith("sk-") else "Gemini",
                        encrypted_api_key=course.encrypted_api_key,
                        masked_key=mask_api_key(plain),
                        is_active=True
                    )
                    db.add(migrated)
                    db.commit()
                    break
        keys = db.query(UserApiKeyModel).filter(UserApiKeyModel.user_id == current_user.id).order_by(UserApiKeyModel.created_at.desc()).all()
    return keys


@router.post(
    "/user/api-keys",
    response_model=UserApiKeyResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["User API Keys"]
)
def create_user_api_key(
    request: UserApiKeyCreateRequest,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    """Create and encrypt a new API key for the current user."""
    plain_key = request.api_key.strip()
    if not plain_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="API key cannot be empty.")

    # Check existing keys. If this is the user's first key, mark it active automatically.
    existing_count = db.query(UserApiKeyModel).filter(UserApiKeyModel.user_id == current_user.id).count()
    should_be_active = (existing_count == 0)

    encrypted = encrypt_api_key(plain_key)
    masked = mask_api_key(plain_key)

    new_key = UserApiKeyModel(
        user_id=current_user.id,
        name=request.name.strip(),
        provider=request.provider.strip() if request.provider else "Gemini",
        encrypted_api_key=encrypted,
        masked_key=masked,
        is_active=should_be_active
    )
    db.add(new_key)
    db.commit()
    db.refresh(new_key)
    return new_key


@router.put(
    "/user/api-keys/{key_id}/activate",
    response_model=UserApiKeyResponse,
    tags=["User API Keys"]
)
def activate_user_api_key(
    key_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    """Set the specified API key as active, deactivating all other keys for the user."""
    key = db.query(UserApiKeyModel).filter(
        UserApiKeyModel.id == key_id,
        UserApiKeyModel.user_id == current_user.id
    ).first()
    if not key:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="API Key not found.")

    # Deactivate all other keys for this user
    db.query(UserApiKeyModel).filter(UserApiKeyModel.user_id == current_user.id).update({"is_active": False})
    key.is_active = True
    db.commit()
    db.refresh(key)
    return key


@router.delete(
    "/user/api-keys/{key_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["User API Keys"]
)
def delete_user_api_key(
    key_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    """Delete an API key for the current user. If active key is deleted, activates the most recent remaining key."""
    key = db.query(UserApiKeyModel).filter(
        UserApiKeyModel.id == key_id,
        UserApiKeyModel.user_id == current_user.id
    ).first()
    if not key:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="API Key not found.")

    was_active = key.is_active
    db.delete(key)
    db.commit()

    # If deleted key was active, activate the latest remaining key
    if was_active:
        latest = db.query(UserApiKeyModel).filter(
            UserApiKeyModel.user_id == current_user.id
        ).order_by(UserApiKeyModel.created_at.desc()).first()
        if latest:
            latest.is_active = True
            db.commit()

    return None
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
        course = use_case.execute(
            name=request.name,
            description=request.description,
            user_id=current_user.id,
            tech_requirements=request.tech_requirements,
            deadline=request.deadline,
        )
        return CourseResponse(
            id=course.id,
            name=course.name,
            description=course.description,
            tech_requirements=course.tech_requirements,
            deadline=course.deadline,
            created_at=course.created_at
        )
    except Exception as e:
        logger.error(e, exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


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
        courses = use_case.execute(user_id=current_user.id)
        courses_list = [
            CourseResponse(
                id=c.id, name=c.name, description=c.description,
                tech_requirements=c.tech_requirements, deadline=c.deadline,
                created_at=c.created_at
            )
            for c in courses
        ]
        return CoursesListResponse(total_courses=len(courses_list), courses=courses_list)
    except Exception as e:
        logger.error(e, exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


def _make_course_response(course) -> CourseResponse:
    plain_key = decrypt_api_key(getattr(course, 'encrypted_api_key', None)) if getattr(course, 'encrypted_api_key', None) else ""
    return CourseResponse(
        id=course.id,
        name=course.name,
        description=course.description,
        tech_requirements=course.tech_requirements,
        deadline=course.deadline,
        has_api_key=bool(plain_key),
        masked_api_key=mask_api_key(plain_key) if plain_key else None,
        default_sampling_mode=getattr(course, 'default_sampling_mode', 'sample') or 'sample',
        created_at=course.created_at
    )


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
        course = use_case.execute(course_id, user_id=current_user.id)
        return _make_course_response(course)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        logger.error(e, exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


@router.put(
    "/courses/{course_id}",
    response_model=CourseResponse,
    tags=["Courses"],
    responses={400: {"model": ErrorResponse}, 401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}}
)
def update_course(
    course_id: int,
    request: CourseUpdateRequest,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    """Update course metadata (name, description, tech requirements, deadline).
    Only the fields present in the request body are changed."""
    course_repo = CourseRepository(db)
    use_case = UpdateCourseUseCase(course_repo)
    try:
        course = use_case.execute(
            course_id,
            user_id=current_user.id,
            fields=request.model_dump(exclude_unset=True)
        )
        return _make_course_response(course)
    except ValueError as e:
        detail = str(e)
        if "not found" in detail:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)
    except Exception as e:
        logger.error(e, exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


@router.post(
    "/courses/{course_id}/api-key",
    response_model=ApiKeyStatusResponse,
    tags=["Courses"]
)
def save_course_api_key(
    course_id: int,
    request: ApiKeySaveRequest,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    """Encrypt and store user's Gemini / Cloud AI API key in DB. The key is encrypted via Fernet AES-128 and cannot be viewed in plain-text again."""
    course = db.query(CourseModel).filter(CourseModel.id == course_id, CourseModel.user_id == current_user.id).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Course with ID {course_id} not found.")

    plain_key = request.api_key.strip()
    if not plain_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="API key cannot be empty.")

    encrypted = encrypt_api_key(plain_key)
    course.encrypted_api_key = encrypted
    db.commit()
    db.refresh(course)

    return ApiKeyStatusResponse(
        has_api_key=True,
        masked_api_key=mask_api_key(plain_key),
        message="API Key encrypted and saved successfully."
    )


@router.get(
    "/courses/{course_id}/api-key",
    response_model=ApiKeyStatusResponse,
    tags=["Courses"]
)
def get_course_api_key_status(
    course_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    """Get masked API key status. Plain-text key is NEVER returned."""
    course = db.query(CourseModel).filter(CourseModel.id == course_id, CourseModel.user_id == current_user.id).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Course with ID {course_id} not found.")

    encrypted = getattr(course, 'encrypted_api_key', None)
    if not encrypted:
        return ApiKeyStatusResponse(has_api_key=False, masked_api_key=None)

    plain = decrypt_api_key(encrypted)
    if not plain:
        return ApiKeyStatusResponse(has_api_key=False, masked_api_key=None)

    return ApiKeyStatusResponse(has_api_key=True, masked_api_key=mask_api_key(plain))


@router.delete(
    "/courses/{course_id}/api-key",
    response_model=ApiKeyStatusResponse,
    tags=["Courses"]
)
def delete_course_api_key(
    course_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    """Remove stored API key for this course."""
    course = db.query(CourseModel).filter(CourseModel.id == course_id, CourseModel.user_id == current_user.id).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Course with ID {course_id} not found.")

    course.encrypted_api_key = None
    db.commit()

    return ApiKeyStatusResponse(has_api_key=False, masked_api_key=None, message="API Key removed successfully.")


@router.delete(
    "/courses/{course_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["Courses"],
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}}
)
def delete_course(
    course_id: int,
    request: CourseResetRequest,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    course_repo = CourseRepository(db)
    
    # 1. Verify ownership
    if not course_repo.get_by_id(course_id, user_id=current_user.id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Course with ID {course_id} not found."
        )

    # 2. Verify password
    if not verify_password(request.password, current_user.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect password verification."
        )

    use_case = DeleteCourseUseCase(course_repo)
    try:
        use_case.execute(course_id, user_id=current_user.id)
        return None
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        logger.error(e, exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

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
        projects = use_case.execute(course_id, user_id=current_user.id)
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
                course_id=p.course_id,
                sampling_mode=getattr(p, 'sampling_mode', 'sample') or 'sample'
            )
            for p in projects
        ]
        return ProjectsListResponse(total_projects=len(projects_list), projects=projects_list)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        logger.error(e, exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


# ---------------------------------------------------------------------------
# Project endpoints (PROTECTED)
# ---------------------------------------------------------------------------

def _get_project_for_user(project_id: int, user_id: int, db: Session) -> ProjectModel:
    """Returns the project if it exists and belongs to the current user's course.
    Raises HTTP 404 if not found or not owned."""
    project = (
        db.query(ProjectModel)
        .join(CourseModel)
        .filter(ProjectModel.id == project_id, CourseModel.user_id == user_id)
        .first()
    )
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")
    return project


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

    # Validate course exists AND belongs to the current user
    course = course_repo.get_by_id(request.course_id, user_id=current_user.id)
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Course with ID {request.course_id} not found."
        )

    # 0. Check duplicate Group No / Tag in the same course
    if request.group_no and request.group_no.strip():
        existing_group = repo.db.query(ProjectModel).filter(
            ProjectModel.course_id == request.course_id,
            func.lower(ProjectModel.group_no) == request.group_no.strip().lower()
        ).first()
        if existing_group:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Group No / Tag '{request.group_no.strip()}' already exists in this course."
            )

    # Check duplicate Git URL in the same course
    if request.git_url and request.git_url.strip():
        clean_url = request.git_url.strip().rstrip("/").removesuffix(".git").lower()
        course_projects = repo.db.query(ProjectModel).filter(ProjectModel.course_id == request.course_id).all()
        for p in course_projects:
            if p.git_url and p.git_url.strip().rstrip("/").removesuffix(".git").lower() == clean_url:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Repository URL '{request.git_url.strip()}' is already imported in this course."
                )

    # Check duplicate Project Name in the same course
    if request.name and request.name.strip():
        existing_name = repo.db.query(ProjectModel).filter(
            ProjectModel.course_id == request.course_id,
            func.lower(ProjectModel.name) == request.name.strip().lower()
        ).first()
        if existing_name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Project name '{request.name.strip()}' already exists in this course."
            )

    # 1. Create project row to flush / populate project ID
    project = repo.create(
        name=request.name,
        description=request.description,
        git_url=request.git_url,
        course_id=request.course_id,
        group_no=request.group_no,
        store_local_copy=request.store_local_copy or False
    )

    # 2. Update project with unique local path using its ID
    local_path = f"./saved_repos/project_{project.id}" if project.store_local_copy else f"./temp_repos/project_{project.id}"
    repo.update_local_path(project.id, local_path)

    return ProjectCreateResponse(
        project_id=project.id, 
        name=project.name, 
        course_id=project.course_id,
        group_no=project.group_no,
        tech_stack=project.tech_stack,
        store_local_copy=project.store_local_copy,
        is_local_copy_stored=project.is_local_copy_stored,
        sampling_mode=getattr(project, 'sampling_mode', 'sample') or 'sample'
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
    _get_project_for_user(project_id, current_user.id, db)

    project_repo = ProjectRepository(db)
    extractor_service = PyDrillerService(db)
    use_case = ExtractGitHistoryUseCase(project_repo, extractor_service)

    try:
        result = use_case.execute(project_id)
        return ExtractResponse(**result)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))
    except Exception as e:
        logger.error(e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )


@router.post(
    "/projects/{project_id}/sync",
    response_model=ExtractResponse,
    tags=["Projects"],
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}}
)
def sync_project_updates(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    """
    Pulls latest git commits from remote git_url, updating project files, commits, and analytics.
    """
    _get_project_for_user(project_id, current_user.id, db)

    project_repo = ProjectRepository(db)
    extractor_service = PyDrillerService(db)
    use_case = ExtractGitHistoryUseCase(project_repo, extractor_service)

    try:
        result = use_case.execute(project_id)
        return ExtractResponse(**result)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))
    except Exception as e:
        logger.error(e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
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
    _get_project_for_user(project_id, current_user.id, db)
    repo = ProjectRepository(db)
    success = repo.delete(project_id)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return None


from pydantic import BaseModel

class ProjectSamplingModeUpdateRequest(BaseModel):
    sampling_mode: str


@router.put(
    "/projects/{project_id}/sampling-mode",
    tags=["Projects"],
    responses={400: {"model": ErrorResponse}, 401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}}
)
def update_project_sampling_mode(
    project_id: int,
    request: ProjectSamplingModeUpdateRequest,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    project = _get_project_for_user(project_id, current_user.id, db)
    mode = request.sampling_mode.strip().lower()
    if mode not in ("sample", "full", "random"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid sampling mode. Must be one of: sample, full, random")
    
    project.sampling_mode = mode
    db.commit()
    return {"status": "success", "sampling_mode": project.sampling_mode}


@router.get(
    "/projects/{project_id}/files/tree",
    tags=["Projects"],
    responses={400: {"model": ErrorResponse}, 401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}}
)
def get_project_file_tree(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    _get_project_for_user(project_id, current_user.id, db)
    project_repo = ProjectRepository(db)
    use_case = GetProjectFileTreeUseCase(project_repo)
    try:
        return use_case.execute(project_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(e, exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


@router.get(
    "/projects/{project_id}/files/content",
    tags=["Projects"],
    responses={400: {"model": ErrorResponse}, 401: {"model": ErrorResponse}, 403: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}}
)
def get_project_file_content(
    project_id: int,
    file_path: str,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    _get_project_for_user(project_id, current_user.id, db)
    project_repo = ProjectRepository(db)
    use_case = GetProjectFileContentUseCase(project_repo)
    try:
        return use_case.execute(project_id, file_path)
    except FileNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(e, exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


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
    try:
        # Only return projects belonging to this user's courses
        projects = (
            db.query(ProjectModel)
            .join(CourseModel)
            .filter(CourseModel.user_id == current_user.id)
            .all()
        )
        project_repo = ProjectRepository(db)
        projects_list = [
            ProjectResponse(
                id=p.id,
                name=p.name,
                description=p.description,
                git_url=p.git_url,
                local_saved_path=p.local_saved_path,
                group_no=p.group_no,
                tech_stack=project_repo._detect_tech_stack(p.id),
                created_at=p.created_at,
                course_id=p.course_id,
                sampling_mode=getattr(p, 'sampling_mode', 'sample') or 'sample'
            )
            for p in projects
        ]
        return ProjectsListResponse(total_projects=len(projects_list), projects=projects_list)
    except Exception as e:
        logger.error(e, exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


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
    proj = _get_project_for_user(project_id, current_user.id, db)
    project_repo = ProjectRepository(db)
    return ProjectResponse(
        id=proj.id,
        name=proj.name,
        description=proj.description,
        git_url=proj.git_url,
        local_saved_path=proj.local_saved_path,
        group_no=proj.group_no,
        tech_stack=project_repo._detect_tech_stack(proj.id),
        created_at=proj.created_at,
        course_id=proj.course_id,
        sampling_mode=getattr(proj, 'sampling_mode', 'sample') or 'sample'
    )


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
    _get_project_for_user(project_id, current_user.id, db)
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
        logger.error(e, exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


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
    _get_project_for_user(project_id, current_user.id, db)
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
        logger.error(e, exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


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
    _get_project_for_user(project_id, current_user.id, db)
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
        logger.error(e, exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


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
    _get_project_for_user(project_id, current_user.id, db)
    project_repo = ProjectRepository(db)
    author_repo = AuthorRepository(db)
    commit_repo = CommitRepository(db)
    use_case = GetProjectAnalyticsUseCase(project_repo, author_repo, commit_repo)
    try:
        return use_case.execute(project_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        logger.error(e, exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


@router.post(
    "/projects/{project_id}/qualitative-analysis",
    tags=["Projects"],
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}}
)
def get_qualitative_analysis(
    project_id: int,
    force_refresh: bool = False,
    mode: str = "sample",
    sample_pct: float = 0.20,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    """
    Run qualitative analysis on a project's commits.
    
    - **mode**: `sample` (smart stratified, default), `full` (all commits), `random` (pure random %)
    - **sample_pct**: Fraction of each contributor's remaining commits to include in sample/random modes (default 0.20 = 20%)
    - **force_refresh**: Bypass DB cache and re-run analysis
    """
    if mode not in ("full", "sample", "random"):
        mode = "sample"
    sample_pct = max(0.05, min(1.0, sample_pct))
    
    _get_project_for_user(project_id, current_user.id, db)
    project_repo = ProjectRepository(db)
    author_repo = AuthorRepository(db)
    commit_repo = CommitRepository(db)
    use_case = GetQualitativeAnalysisUseCase(project_repo, author_repo, commit_repo)

    def generate_events():
        try:
            for chunk in use_case.execute_stream(
                project_id,
                mode=mode,
                sample_pct=sample_pct,
                force_refresh=force_refresh,
            ):
                yield json.dumps(chunk) + "\n"
        except Exception as e:
            yield json.dumps({"type": "error", "message": str(e)}) + "\n"

    return StreamingResponse(generate_events(), media_type="application/x-ndjson")


@router.post(
    "/projects/{project_id}/qualitative-analysis/cancel",
    tags=["Projects"]
)
def cancel_qualitative_analysis_route(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    _get_project_for_user(project_id, current_user.id, db)
    cancel_qualitative_analysis(project_id)
    return {"message": f"Qualitative analysis for project {project_id} marked for cancellation."}


@router.get(
    "/projects/{project_id}/qualitative-analysis/status",
    tags=["Projects"]
)
def get_qualitative_analysis_status_route(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    """Get the current status of an in-progress or completed qualitative analysis job."""
    _get_project_for_user(project_id, current_user.id, db)
    status_data = get_project_analysis_status(project_id)
    # If idle in memory, also check DB for cached report
    if status_data["status"] == "idle":
        project_repo = ProjectRepository(db)
        project = project_repo.get_by_id(project_id)
        if project and getattr(project, 'qualitative_report', None):
            return {"status": "complete", "progress": 100, "message": "Loaded from database cache.", "has_db_cache": True}
        return {"status": "idle", "progress": 0, "message": "", "has_db_cache": False}
    return status_data
@router.get(
    "/projects/{project_id}/cloud-report",
    tags=["Projects"]
)
def get_cached_cloud_report(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    """Retrieve the cached Cloud AI report for a project if it has already been generated."""
    project = _get_project_for_user(project_id, current_user.id, db)
    report_json = getattr(project, 'cloud_report', None)
    if not report_json:
        return {"cloud_report": None}
    try:
        report_data = json.loads(report_json)
        return {"cloud_report": report_data}
    except Exception as e:
        logger.error(e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )


def _get_and_enrich_qualitative_data(project: ProjectModel, db: Session) -> dict:
    qual_report_json = getattr(project, 'qualitative_report', None)
    if not qual_report_json:
        logger.error(f"Project {project.id} has no qualitative_report stored in DB.")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No local AI analysis found. Run Local AI Analysis first."
        )

    try:
        qual_data = json.loads(qual_report_json)
        
        # Dynamic on-the-fly enrichment for legacy DB caches
        ps = qual_data.get("project_summary", {})
        project_repo = ProjectRepository(db)
        commit_repo = CommitRepository(db)
        if not ps.get("folder_structure") or not ps.get("readme_quality") or not ps.get("language_distribution"):
            try:
                if not ps.get("language_distribution") and hasattr(project_repo, 'get_language_distribution'):
                    ps["language_distribution"] = project_repo.get_language_distribution(project.id) or {}
                
                repo_path = getattr(project, 'local_saved_path', None)
                if repo_path and os.path.exists(repo_path) and os.path.isdir(repo_path):
                    if not ps.get("folder_structure"):
                        top_dirs = []
                        tot_files = 0
                        tot_dirs = 0
                        has_tests = False
                        for root, dirs, files in os.walk(repo_path):
                            dirs[:] = [d for d in dirs if not d.startswith('.') and d not in ('node_modules', '__pycache__', 'venv', 'env', 'build', 'dist')]
                            tot_dirs += len(dirs)
                            tot_files += len(files)
                            if root == repo_path:
                                top_dirs = list(dirs)
                            for d in dirs:
                                if d.lower() in ('test', 'tests', '__tests__', 'spec', 'specs'):
                                    has_tests = True

                        modularity = "Monolithic (Flat)"
                        if len(top_dirs) >= 3 or has_tests:
                            modularity = "High Modularity (Structured Directories)"
                        elif len(top_dirs) >= 1:
                            modularity = "Moderate Modularity"

                        ps["folder_structure"] = {
                            "top_level_directories": top_dirs[:8],
                            "total_directories": tot_dirs,
                            "total_files": tot_files,
                            "has_tests_dir": has_tests,
                            "modularity_score": modularity
                        }

                    if not ps.get("readme_quality"):
                        readme_file = None
                        for fname in os.listdir(repo_path):
                            if fname.lower().startswith('readme'):
                                readme_file = os.path.join(repo_path, fname)
                                break
                        if readme_file and os.path.isfile(readme_file):
                            size_kb = round(os.path.getsize(readme_file) / 1024.0, 2)
                            has_setup = False
                            has_arch = False
                            try:
                                with open(readme_file, 'r', encoding='utf-8', errors='ignore') as f:
                                    content = f.read().lower()
                                    if any(k in content for k in ['install', 'setup', 'run', 'build', 'usage', 'getting started']):
                                        has_setup = True
                                    if any(k in content for k in ['architecture', 'design', 'structure', 'api', 'component', 'overview']):
                                        has_arch = True
                            except Exception as e:
                                logger.warning(f"Error reading README file: {e}")

                            if size_kb > 2.0 and has_setup and has_arch:
                                doc_score = "Comprehensive (9/10)"
                            elif size_kb > 0.5 or has_setup:
                                doc_score = "Basic (5/10)"
                            else:
                                doc_score = "Minimal (3/10)"

                            ps["readme_quality"] = {
                                "has_readme": True,
                                "readme_size_kb": size_kb,
                                "has_setup_guide": has_setup,
                                "has_architecture_doc": has_arch,
                                "documentation_score": doc_score
                            }
                        else:
                            ps["readme_quality"] = {"documentation_score": "Missing (0/10)"}
                qual_data["project_summary"] = ps
            except Exception as enrich_err:
                logger.warning(f"On-the-fly cache enrichment warning: {enrich_err}")

        # Always ensure branches_summary, plagiarism_summary, ast_complexity_summary exist
        if not ps.get("branches_summary") or not ps.get("plagiarism_summary") or not ps.get("ast_complexity_summary"):
            try:
                db_session = getattr(project_repo, 'db', db)
                commits_list = commit_repo.get_by_project_id(project.id) if hasattr(commit_repo, 'get_by_project_id') else None
                ext = extract_extended_quantitative_metrics(
                    db=db_session,
                    project_id=project.id,
                    project=project,
                    commits=commits_list
                )
                ps.update(ext)
                qual_data["project_summary"] = ps
            except Exception as ext_err:
                logger.warning(f"On-the-fly extended metrics warning: {ext_err}")
        return qual_data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to parse qualitative_report JSON: {e}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Malformed qualitative report cache.")@router.post(
    "/projects/{project_id}/cloud-report/generate",
    response_model=CloudReportData,
    tags=["Projects"]
)
def generate_and_cache_cloud_report(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    """Generate a final narrative report using Cloud AI based on the stored qualitative analysis data, cache and return it as JSON."""
    logger.info(f"HTTP POST /projects/{project_id}/cloud-report/generate received.")

    project = _get_project_for_user(project_id, current_user.id, db)
    logger.info(f"Found Project ID: {project.id}")

    # Fetch active API key for current user (or auto-migrate legacy course key)
    active_key_record = db.query(UserApiKeyModel).filter(
        UserApiKeyModel.user_id == current_user.id,
        UserApiKeyModel.is_active == True
    ).first()

    if active_key_record:
        logger.info(f"Found active API key record for project ID {project.id}.")
    else:
        logger.info("No active user API key record found. Checking legacy course key...")
        # Check if course has a legacy encrypted key to auto-migrate
        course = getattr(project, 'course', None)
        legacy_key = getattr(course, 'encrypted_api_key', None) if course else None
        if legacy_key:
            plain = decrypt_api_key(legacy_key)
            if plain:
                logger.info("Found legacy course API key. Auto-migrating to user_api_keys table...")
                active_key_record = UserApiKeyModel(
                    user_id=current_user.id,
                    name=f"Migrated Key ({course.name or 'Course'})",
                    provider="AgentRouter" if plain.startswith("sk-") else "Gemini",
                    encrypted_api_key=legacy_key,
                    masked_key=mask_api_key(plain),
                    is_active=True
                )
                db.add(active_key_record)
                db.commit()
                db.refresh(active_key_record)
                logger.info(f"Auto-migration successful. Created Key ID {active_key_record.id}")

    encrypted_key = active_key_record.encrypted_api_key if active_key_record else None

    if not encrypted_key:
        logger.error("No active API key found. Returning HTTP 402 PAYMENT_REQUIRED.")
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="NO_API_KEY"
        )

    plain_key = decrypt_api_key(encrypted_key)
    if not plain_key:
        logger.error("Failed to decrypt active API key.")
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="NO_API_KEY"
        )

    # Load local AI qualitative report and enrich it
    qual_data = _get_and_enrich_qualitative_data(project, db)

    course = getattr(project, 'course', None)
    course_name = getattr(course, 'name', 'Unknown Course') if course else 'Unknown Course'
    tech_req = getattr(course, 'tech_requirements', None) if course else None
    deadline_val = getattr(course, 'deadline', None) if course else None
    deadline_str = deadline_val.strftime("%Y-%m-%d %H:%M UTC") if deadline_val else None

    try:
        logger.info("Calling generate_cloud_report use-case function...")
        report_data = generate_cloud_report(
            qual_data=qual_data,
            api_key=plain_key,
            course_name=course_name,
            tech_requirements=tech_req,
            deadline=deadline_str
        )
        logger.info("generate_cloud_report returned valid CloudReportData object!")
        
        # Save cache in DB
        project.cloud_report = report_data.model_dump_json()
        db.commit()
        logger.info(f"Saved generated report JSON to project {project_id} cloud_report column.")
        
        return report_data
    except HTTPException:
        raise
    except ValueError as ve:
        logger.warning(f"Caught ValueError: {ve}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except RuntimeError as re:
        logger.warning(f"Caught RuntimeError: {re}")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(re))
    except Exception as ex:
        logger.exception(f"Caught unexpected Exception: {ex}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


@router.post(
    "/projects/{project_id}/cloud-report",
    tags=["Projects"]
)
def generate_cloud_ai_report(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user)
):
    """Generate a final narrative report using Cloud AI based on the stored qualitative analysis data, returning a PDF (uses cache if available)."""
    logger.info(f"HTTP POST /projects/{project_id}/cloud-report received (PDF download request).")

    project = _get_project_for_user(project_id, current_user.id, db)
    logger.info(f"Found Project ID: {project.id}")

    course = getattr(project, 'course', None)
    course_name = getattr(course, 'name', 'Unknown Course') if course else 'Unknown Course'
    tech_req = getattr(course, 'tech_requirements', None) if course else None
    deadline_val = getattr(course, 'deadline', None) if course else None
    deadline_str = deadline_val.strftime("%Y-%m-%d %H:%M UTC") if deadline_val else None

    # Load local AI qualitative report from DB cache and enrich it
    qual_data = _get_and_enrich_qualitative_data(project, db)

    # 1. Check if cached report is available
    report_data = None
    cached_report_json = getattr(project, 'cloud_report', None)
    if cached_report_json:
        try:
            report_data = CloudReportData.model_validate_json(cached_report_json)
            logger.info("Using cached cloud report JSON from DB.")
        except Exception as parse_err:
            logger.warning(f"Cached report parse error: {parse_err}. Regenerating...")

    # 2. If not cached, call generate_cloud_report (which calls LLM and caches result)
    if not report_data:
        # Fetch active API key
        active_key_record = db.query(UserApiKeyModel).filter(
            UserApiKeyModel.user_id == current_user.id,
            UserApiKeyModel.is_active == True
        ).first()

        if not active_key_record:
            course_obj = getattr(project, 'course', None)
            legacy_key = getattr(course_obj, 'encrypted_api_key', None) if course_obj else None
            if legacy_key:
                plain = decrypt_api_key(legacy_key)
                if plain:
                    logger.info("Auto-migrating legacy course key to user_api_keys table...")
                    active_key_record = UserApiKeyModel(
                        user_id=current_user.id,
                        name=f"Migrated Key ({course_name or 'Course'})",
                        provider="AgentRouter" if plain.startswith("sk-") else "Gemini",
                        encrypted_api_key=legacy_key,
                        masked_key=mask_api_key(plain),
                        is_active=True
                    )
                    db.add(active_key_record)
                    db.commit()
                    db.refresh(active_key_record)

        encrypted_key = active_key_record.encrypted_api_key if active_key_record else None
        if not encrypted_key:
            logger.error("No active API key found. Returning HTTP 402 PAYMENT_REQUIRED.")
            raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail="NO_API_KEY")

        plain_key = decrypt_api_key(encrypted_key)
        if not plain_key:
            logger.error("Failed to decrypt active API key.")
            raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail="NO_API_KEY")

        try:
            logger.info("Calling generate_cloud_report use-case function...")
            report_data = generate_cloud_report(
                qual_data=qual_data,
                api_key=plain_key,
                course_name=course_name,
                tech_requirements=tech_req,
                deadline=deadline_str
            )
            # Save cache in DB
            project.cloud_report = report_data.model_dump_json()
            db.commit()
            logger.info("Saved generated report JSON to DB cache.")
        except HTTPException:
            raise
        except ValueError as ve:
            logger.warning(f"Caught ValueError: {ve}")
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
        except RuntimeError as re:
            logger.warning(f"Caught RuntimeError: {re}")
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(re))
        except Exception as ex:
            logger.exception(f"Caught unexpected Exception: {ex}")
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

    # 3. Render PDF
    try:
        date_str = datetime.datetime.utcnow().strftime("%Y-%m-%d")
        lecturer = getattr(current_user, 'username', None) or getattr(current_user, 'email', None) or 'Course Lecturer'
        course_obj = getattr(project, 'course', None)
        course_dl = getattr(course_obj, 'deadline', None) if course_obj else getattr(project, 'deadline', None)

        pdf_bytes = render_pdf_report(
            report_data=report_data, 
            course_name=course_name, 
            project_name=project.name, 
            date=date_str,
            qual_data=qual_data,
            group_no=getattr(project, 'group_no', None),
            lecturer_name=lecturer,
            git_url=getattr(project, 'git_url', None),
            deadline=course_dl
        )
        logger.info(f"PDF rendered successfully ({len(pdf_bytes)} bytes).")
        
        safe_course = re.sub(r'[^\w\-_]', '_', course_name or "Course").strip('_')
        safe_project = re.sub(r'[^\w\-_]', '_', project.name or "Project").strip('_')
        download_filename = f"Project Report_{safe_course}_{safe_project}_{project_id}.pdf"
        
        return StreamingResponse(
            io.BytesIO(pdf_bytes), 
            media_type="application/pdf", 
            headers={"Content-Disposition": f'attachment; filename="{download_filename}"'}
        )
    except Exception as ex:
        logger.exception(f"Unexpected exception during PDF rendering/streaming: {ex}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


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
        tech_stack=[],
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

def _check_author_belongs_to_user(db: Session, author_id: int, user_id: int) -> bool:
    user_author_exists = db.query(CommitModel.author_id)\
        .join(ProjectModel, CommitModel.project_id == ProjectModel.id)\
        .join(CourseModel, ProjectModel.course_id == CourseModel.id)\
        .filter(CourseModel.user_id == user_id, CommitModel.author_id == author_id)\
        .first()
    return user_author_exists is not None


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
    try:
        user_author_rows = db.query(CommitModel.author_id)\
            .join(ProjectModel, CommitModel.project_id == ProjectModel.id)\
            .join(CourseModel, ProjectModel.course_id == CourseModel.id)\
            .filter(CourseModel.user_id == current_user.id)\
            .distinct().all()
        user_author_ids = [r[0] for r in user_author_rows if r[0] is not None]

        authors = db.query(AuthorModel).filter(AuthorModel.id.in_(user_author_ids)).all() if user_author_ids else []
        authors_list = [
            AuthorResponse(id=a.id, name=a.name, email=a.email)
            for a in authors
        ]
        return AuthorsListResponse(total_authors=len(authors_list), authors=authors_list)
    except Exception as e:
        logger.error(f"Error fetching authors: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


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
    if not _check_author_belongs_to_user(db, author_id, current_user.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Author with id {author_id} not found.")

    author_repo = AuthorRepository(db)
    use_case = GetAuthorByIdUseCase(author_repo)
    try:
        a = use_case.execute(author_id)
        return AuthorResponse(id=a.id, name=a.name, email=a.email)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Author not found.")
    except Exception as e:
        logger.error(f"Error fetching author {author_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


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
    if not _check_author_belongs_to_user(db, author_id, current_user.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Author with id {author_id} not found.")

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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Author not found.")
    except Exception as e:
        logger.error(f"Error fetching commits for author {author_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


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
    if not _check_author_belongs_to_user(db, author_id, current_user.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Author with id {author_id} not found.")

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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Author not found.")
    except Exception as e:
        logger.error(f"Error fetching full profile for author {author_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


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
    if not _check_author_belongs_to_user(db, author_id, current_user.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Author with id {author_id} not found.")

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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Author not found.")
    except Exception as e:
        logger.error(f"Error fetching projects for author {author_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


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
    for aid in [request.source_author_id, request.target_author_id]:
        if not _check_author_belongs_to_user(db, aid, current_user.id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Author with id {aid} not found.")

    author_repo = AuthorRepository(db)
    use_case = MergeAuthorsUseCase(author_repo)
    try:
        use_case.execute(request.source_author_id, request.target_author_id)
        return {"status": "success", "message": f"Author {request.source_author_id} has been merged into Author {request.target_author_id} successfully."}
    except ValueError as e:
        detail = str(e)
        if "not found" in detail:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Author not found.")
        else:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)
    except Exception as e:
        logger.error(f"Error merging authors: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


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
    return {
        "supported_languages": supported_languages(),
        "file_extensions": EXTENSION_TO_LANGUAGE,
    }


# ---------------------------------------------------------------------------
# Course and Project operations (PROTECTED)
# ---------------------------------------------------------------------------

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
    """Clear all projects and related data for a specific course owned by the current user.
    Verifies user password."""
    # Verify course exists AND belongs to current user
    course_repo = CourseRepository(db)
    if not course_repo.get_by_id(course_id, user_id=current_user.id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Course with ID {course_id} not found."
        )

    if not verify_password(request.password, current_user.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect password verification."
        )

    db_service = DatabaseService(db)
    use_case = ResetCourseUseCase(db_service)
    try:
        use_case.execute(course_id, user_id=current_user.id)
        return {"status": "success", "message": f"Course projects and data cleared successfully."}
    except Exception as e:
        logger.error(e, exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

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
    """Global search projects, students (authors), commits, and courses — scoped to current user's data."""
    if not q or len(q.strip()) < 2:
        return SearchResponse(results=[])

    query_str = f"%{q.strip()}%"
    results = []

    # 1. Search projects (only within current user's courses)
    proj_query = (
        db.query(ProjectModel)
        .join(CourseModel)
        .filter(CourseModel.user_id == current_user.id)
    )
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

    # 2. Search students (authors) within current user's projects
    author_query = (
        db.query(AuthorModel)
        .join(CommitModel)
        .join(ProjectModel)
        .join(CourseModel)
        .filter(CourseModel.user_id == current_user.id)
    )
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

    # 3. Search commits within current user's projects
    commit_query = (
        db.query(CommitModel)
        .join(ProjectModel)
        .join(CourseModel)
        .filter(CourseModel.user_id == current_user.id)
    )
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

    # 4. Search courses (only current user's courses)
    courses = db.query(CourseModel).filter(
        CourseModel.user_id == current_user.id,
        CourseModel.name.ilike(query_str)
    ).limit(3).all()
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
