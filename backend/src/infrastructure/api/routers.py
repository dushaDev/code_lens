from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
import os

from src.infrastructure.database.session import get_db
from src.domain.models import Project
from src.infrastructure.api.schemas import ProjectCreateRequest, ProjectCreateResponse, ExtractResponse, ErrorResponse
from src.use_cases.extract_git_history import ExtractGitHistoryUseCase

router = APIRouter(prefix="/api/v1")

@router.post("/projects", response_model=ProjectCreateResponse, status_code=status.HTTP_201_CREATED)
def create_project(request: ProjectCreateRequest, db: Session = Depends(get_db)):
    # Define a local path for temporary clone
    # e.g., ./temp_repos/{project_id}/...
    # We don't have project_id yet, so we will create the project, flush to get ID, then update local_saved_path
    new_project = Project(
        name=request.name,
        description=request.description,
        git_url=request.git_url,
        local_saved_path="" # Will update after getting ID
    )
    db.add(new_project)
    db.flush() # Get the new_project.id
    
    new_project.local_saved_path = f"./temp_repos/{new_project.id}/repo"
    db.commit()
    db.refresh(new_project)
    
    return ProjectCreateResponse(project_id=new_project.id, name=new_project.name)

@router.post(
    "/extract/{project_id}", 
    response_model=ExtractResponse, 
    responses={404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}}
)
def extract_git_data(project_id: int, db: Session = Depends(get_db)):
    use_case = ExtractGitHistoryUseCase(db)
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
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    
    db.delete(project)
    db.commit()
    return None
