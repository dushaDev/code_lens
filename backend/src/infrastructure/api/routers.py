from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
import os

from src.infrastructure.database.session import get_db
from src.infrastructure.database.repositories import ProjectRepository, AuthorRepository, CommitRepository, DatabaseService
from src.infrastructure.services.pydriller_service import PyDrillerService
from src.infrastructure.api.schemas import (
    ProjectCreateRequest, ProjectCreateResponse, ExtractResponse, ErrorResponse,
    CommitResponse, AuthorFullProfileResponse, ProjectResponse, FileChangeResponse, CommitWithProjectAndFilesResponse,
    AuthorResponse, FileChangeProfileResponse, CommitProfileResponse,
    AuthorCommitsResponse, ProjectsListResponse, ProjectAuthorsResponse,
    ProjectAnalyticsResponse, MergeAuthorsRequest, AuthorsListResponse, BranchesListResponse, BranchResponse,
    FileChangeMetricsResponse, FileChangeASTResponse, ASTNodeResponse
)
from src.use_cases.extract_git_history import ExtractGitHistoryUseCase
from src.use_cases.get_author_commits import (
    GetAuthorCommitsUseCase, GetAuthorFullProfileUseCase,
    GetAllProjectsUseCase, GetProjectsByAuthorUseCase, GetProjectAuthorsUseCase,
    ResetDatabaseUseCase, MergeAuthorsUseCase
)
from src.use_cases.get_project_analytics import GetProjectAnalyticsUseCase
from src.use_cases.get_project_details import (
    GetProjectByIdUseCase, GetProjectBranchesUseCase, GetProjectCommitsUseCase
)
from src.use_cases.get_author_details import (
    GetAllAuthorsUseCase, GetAuthorByIdUseCase
)

router = APIRouter(prefix="/api/v1")

@router.post("/projects", response_model=ProjectCreateResponse, status_code=status.HTTP_201_CREATED)
def create_project(request: ProjectCreateRequest, db: Session = Depends(get_db)):
    repo = ProjectRepository(db)
    
    # 1. Create project row to flush / populate project ID
    project = repo.create(
        name=request.name,
        description=request.description,
        git_url=request.git_url
    )
    
    # 2. Update project with unique local path using its ID
    local_path = f"./temp_repos/{project.id}/repo"
    repo.update_local_path(project.id, local_path)
    
    return ProjectCreateResponse(project_id=project.id, name=project.name)

@router.post(
    "/extract/{project_id}", 
    response_model=ExtractResponse, 
    responses={404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}}
)
def extract_git_data(project_id: int, db: Session = Depends(get_db)):
    project_repo = ProjectRepository(db)
    extractor_service = PyDrillerService(db)
    use_case = ExtractGitHistoryUseCase(project_repo, extractor_service)
    
    try:
        result = use_case.execute(project_id)
        return ExtractResponse(**result)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

@router.delete(
    "/projects/{project_id}", 
    status_code=status.HTTP_204_NO_CONTENT,
    responses={404: {"model": ErrorResponse}}
)
def delete_project(project_id: int, db: Session = Depends(get_db)):
    repo = ProjectRepository(db)
    success = repo.delete(project_id)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return None

@router.get(
    "/authors/{author_id}/commits",
    response_model=AuthorCommitsResponse,
    responses={404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}}
)
def get_author_commits(author_id: int, project_id: Optional[int] = None, branch: Optional[str] = None, db: Session = Depends(get_db)):
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
    responses={404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}}
)
def get_author_full_profile(author_id: int, project_id: Optional[int] = None, db: Session = Depends(get_db)):
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
    "/projects",
    response_model=ProjectsListResponse,
    responses={500: {"model": ErrorResponse}}
)
def get_all_projects(db: Session = Depends(get_db)):
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
                created_at=p.created_at
            )
            for p in projects
        ]
        return ProjectsListResponse(total_projects=len(projects_list), projects=projects_list)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

@router.get(
    "/authors/{author_id}/projects",
    response_model=ProjectsListResponse,
    responses={404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}}
)
def get_projects_by_author(author_id: int, db: Session = Depends(get_db)):
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
                created_at=p.created_at
            )
            for p in projects
        ]
        return ProjectsListResponse(total_projects=len(projects_list), projects=projects_list)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

@router.get(
    "/projects/{project_id}/authors",
    response_model=ProjectAuthorsResponse,
    responses={404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}}
)
def get_project_authors(project_id: int, branch: Optional[str] = None, db: Session = Depends(get_db)):
    project_repo = ProjectRepository(db)
    author_repo = AuthorRepository(db)
    use_case = GetProjectAuthorsUseCase(project_repo, author_repo)
    try:
        authors = use_case.execute(project_id, branch=branch)
        authors_list = [
            AuthorResponse(
                id=a.id,
                name=a.name,
                email=a.email
            )
            for a in authors
        ]
        return ProjectAuthorsResponse(total_authors=len(authors_list), authors=authors_list)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

@router.post("/system/reset", status_code=status.HTTP_200_OK)
def reset_database(db: Session = Depends(get_db)):
    db_service = DatabaseService(db)
    use_case = ResetDatabaseUseCase(db_service)
    try:
        use_case.execute()
        return {"status": "success", "message": "Database has been reset successfully."}
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

@router.get(
    "/projects/{project_id}/analytics",
    response_model=ProjectAnalyticsResponse,
    responses={404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}}
)
def get_project_analytics(project_id: int, db: Session = Depends(get_db)):
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

@router.post(
    "/authors/merge",
    status_code=status.HTTP_200_OK,
    responses={400: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}}
)
def merge_authors(request: MergeAuthorsRequest, db: Session = Depends(get_db)):
    author_repo = AuthorRepository(db)
    use_case = MergeAuthorsUseCase(author_repo)
    try:
        use_case.execute(request.source_author_id, request.target_author_id)
        return {"status": "success", "message": f"Author {request.source_author_id} has been merged into Author {request.target_author_id} successfully."}
    except ValueError as e:
        # Check if it was a cycle validation error or not found error
        detail = str(e)
        if "not found" in detail:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)
        else:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get(
    "/projects/{project_id}",
    response_model=ProjectResponse,
    responses={404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}}
)
def get_project_by_id(project_id: int, db: Session = Depends(get_db)):
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
            created_at=p.created_at
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get(
    "/projects/{project_id}/branches",
    response_model=BranchesListResponse,
    responses={404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}}
)
def get_project_branches(project_id: int, db: Session = Depends(get_db)):
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
    responses={404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}}
)
def get_project_commits(
    project_id: int,
    branch: Optional[str] = None,
    author_id: Optional[int] = None,
    db: Session = Depends(get_db)
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
    "/authors",
    response_model=AuthorsListResponse,
    responses={500: {"model": ErrorResponse}}
)
def get_all_authors(db: Session = Depends(get_db)):
    author_repo = AuthorRepository(db)
    use_case = GetAllAuthorsUseCase(author_repo)
    try:
        authors = use_case.execute()
        authors_list = [
            AuthorResponse(
                id=a.id,
                name=a.name,
                email=a.email
            )
            for a in authors
        ]
        return AuthorsListResponse(total_authors=len(authors_list), authors=authors_list)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get(
    "/authors/{author_id}",
    response_model=AuthorResponse,
    responses={404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}}
)
def get_author_by_id(author_id: int, db: Session = Depends(get_db)):
    author_repo = AuthorRepository(db)
    use_case = GetAuthorByIdUseCase(author_repo)
    try:
        a = use_case.execute(author_id)
        return AuthorResponse(
            id=a.id,
            name=a.name,
            email=a.email
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get(
    "/files/{file_change_id}/metrics",
    response_model=FileChangeMetricsResponse,
    responses={404: {"model": ErrorResponse}},
    summary="Get stored AST metrics for a file change"
)
def get_file_metrics(file_change_id: int, db: Session = Depends(get_db)):
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
    responses={404: {"model": ErrorResponse}, 422: {"model": ErrorResponse}},
    summary="Get real-time AST tree for a file change"
)
def get_file_ast(file_change_id: int, db: Session = Depends(get_db)):
    """Parses the stored source code on-the-fly using tree-sitter and returns
    a simplified, JSON-serialisable AST tree structure. The full AST is never
    persisted — it is generated here and immediately discarded after serialisation."""
    from src.infrastructure.database.models import FileChangeModel
    from src.infrastructure.services.ast_parser import build_ast_tree

    fc = db.query(FileChangeModel).filter(FileChangeModel.id == file_change_id).first()
    if not fc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File change not found")

    language = "unknown"
    source_code: str | None = None

    if fc.filename.endswith(".py"):
        language = "python"
        # Source code is reconstructed from the stored raw_diff if available
        # (PyDriller stores the full post-state source_code inside the diff for new/modified files)
        if fc.raw_diff:
            # Extract only the added lines (+) from the diff to reconstruct source
            lines = []
            for line in fc.raw_diff.splitlines():
                if line.startswith("+") and not line.startswith("+++"):
                    lines.append(line[1:])
            source_code = "\n".join(lines) if lines else None
    else:
        return FileChangeASTResponse(
            file_change_id=file_change_id,
            filename=fc.filename,
            language=language,
            ast=None,
            error=f"AST parsing is not supported for this file type ({fc.filename.rsplit('.', 1)[-1] if '.' in fc.filename else 'unknown'}). Only .py files are currently supported."
        )

    if not source_code:
        return FileChangeASTResponse(
            file_change_id=file_change_id,
            filename=fc.filename,
            language=language,
            ast=None,
            error="No source code available for this file change record."
        )

    tree_dict = build_ast_tree(source_code)
    if tree_dict is None:
        return FileChangeASTResponse(
            file_change_id=file_change_id,
            filename=fc.filename,
            language=language,
            ast=None,
            error="tree-sitter is unavailable or failed to parse the source code."
        )

    return FileChangeASTResponse(
        file_change_id=file_change_id,
        filename=fc.filename,
        language=language,
        ast=ASTNodeResponse(**tree_dict),
    )
