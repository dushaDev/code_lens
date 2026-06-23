from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
import os

from src.infrastructure.database.session import get_db
from src.infrastructure.database.repositories import ProjectRepository
from src.infrastructure.services.pydriller_service import PyDrillerService
from src.infrastructure.api.schemas import ProjectCreateRequest, ProjectCreateResponse, ExtractResponse, ErrorResponse
from src.use_cases.extract_git_history import ExtractGitHistoryUseCase

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
