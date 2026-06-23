from sqlalchemy.orm import Session
from src.domain.models import Project
from src.infrastructure.services.pydriller_service import PyDrillerService

class ExtractGitHistoryUseCase:
    def __init__(self, db: Session):
        self.db = db
        self.extractor_service = PyDrillerService(db)

    def execute(self, project_id: int) -> dict:
        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise ValueError(f"Project with ID {project_id} not found.")

        # The service handles clone, extraction, db save, and garbage collection
        result = self.extractor_service.extract_and_save(project)
        
        return result
