from abc import ABC, abstractmethod
from typing import Optional
from src.domain.entities import ProjectEntity

class IProjectRepository(ABC):
    @abstractmethod
    def get_by_id(self, project_id: int) -> Optional[ProjectEntity]:
        pass

    @abstractmethod
    def create(self, name: str, description: Optional[str], git_url: str) -> ProjectEntity:
        pass

    @abstractmethod
    def update_local_path(self, project_id: int, local_path: str) -> None:
        pass

    @abstractmethod
    def delete(self, project_id: int) -> bool:
        pass

class IGitExtractorService(ABC):
    @abstractmethod
    def extract_and_save(self, project: ProjectEntity) -> dict:
        pass
