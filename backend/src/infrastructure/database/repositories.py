from typing import Optional
from sqlalchemy.orm import Session
from src.domain.entities import ProjectEntity
from src.use_cases.interfaces import IProjectRepository
from src.infrastructure.database.models import ProjectModel

class ProjectRepository(IProjectRepository):
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, project_id: int) -> Optional[ProjectEntity]:
        project_model = self.db.query(ProjectModel).filter(ProjectModel.id == project_id).first()
        if not project_model:
            return None
        return ProjectEntity(
            id=project_model.id,
            name=project_model.name,
            description=project_model.description,
            git_url=project_model.git_url,
            local_saved_path=project_model.local_saved_path,
            created_at=project_model.created_at
        )

    def create(self, name: str, description: Optional[str], git_url: str) -> ProjectEntity:
        # Initial saved path is empty, updated via update_local_path once ID is flushed/committed
        project_model = ProjectModel(
            name=name,
            description=description,
            git_url=git_url,
            local_saved_path=""
        )
        self.db.add(project_model)
        self.db.flush()  # Populates ID
        
        return ProjectEntity(
            id=project_model.id,
            name=project_model.name,
            description=project_model.description,
            git_url=project_model.git_url,
            local_saved_path=project_model.local_saved_path,
            created_at=project_model.created_at
        )

    def update_local_path(self, project_id: int, local_path: str) -> None:
        project_model = self.db.query(ProjectModel).filter(ProjectModel.id == project_id).first()
        if project_model:
            project_model.local_saved_path = local_path
            self.db.commit()

    def delete(self, project_id: int) -> bool:
        project_model = self.db.query(ProjectModel).filter(ProjectModel.id == project_id).first()
        if not project_model:
            return False
        self.db.delete(project_model)
        self.db.commit()
        return True
