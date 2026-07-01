from abc import ABC, abstractmethod
from typing import List, Optional
from src.domain.entities import ProjectEntity, AuthorEntity, CommitEntity, BranchEntity, CourseEntity

class IProjectRepository(ABC):
    @abstractmethod
    def get_by_id(self, project_id: int) -> Optional[ProjectEntity]:
        pass

    @abstractmethod
    def create(self, name: str, description: Optional[str], git_url: str, course_id: int) -> ProjectEntity:
        pass

    @abstractmethod
    def update_local_path(self, project_id: int, local_path: str) -> None:
        pass

    @abstractmethod
    def delete(self, project_id: int) -> bool:
        pass

    @abstractmethod
    def get_all(self) -> List[ProjectEntity]:
        pass

    @abstractmethod
    def get_by_author_id(self, author_id: int) -> List[ProjectEntity]:
        pass

    @abstractmethod
    def get_branches(self, project_id: int) -> List[BranchEntity]:
        pass

class IAuthorRepository(ABC):
    @abstractmethod
    def get_by_id(self, author_id: int) -> Optional[AuthorEntity]:
        pass

    @abstractmethod
    def get_full_profile(self, author_id: int, project_id: Optional[int] = None) -> Optional[AuthorEntity]:
        pass

    @abstractmethod
    def get_by_project_id(self, project_id: int) -> List[AuthorEntity]:
        pass

    @abstractmethod
    def get_by_project_id_and_branch(self, project_id: int, branch: str) -> List[AuthorEntity]:
        pass

    @abstractmethod
    def get_all(self) -> List[AuthorEntity]:
        pass

    @abstractmethod
    def update_canonical_author_id(self, author_id: int, canonical_id: Optional[int]) -> None:
        pass

class ICommitRepository(ABC):
    @abstractmethod
    def get_by_author_id(self, author_id: int, project_id: Optional[int] = None, branch: Optional[str] = None) -> List[CommitEntity]:
        pass

    @abstractmethod
    def get_by_project_id(self, project_id: int) -> List[CommitEntity]:
        pass

    @abstractmethod
    def get_project_commits(self, project_id: int, branch: Optional[str] = None, author_id: Optional[int] = None) -> List[CommitEntity]:
        pass

class IGitExtractorService(ABC):
    @abstractmethod
    def extract_and_save(self, project: ProjectEntity) -> dict:
        pass

class IDatabaseService(ABC):
    @abstractmethod
    def reset_database(self) -> None:
        pass

class ICourseRepository(ABC):
    @abstractmethod
    def create(self, name: str, description: Optional[str]) -> CourseEntity:
        pass

    @abstractmethod
    def get_by_id(self, course_id: int) -> Optional[CourseEntity]:
        pass

    @abstractmethod
    def get_all(self) -> List[CourseEntity]:
        pass

    @abstractmethod
    def delete(self, course_id: int) -> bool:
        pass

    @abstractmethod
    def get_projects(self, course_id: int) -> List[ProjectEntity]:
        pass
