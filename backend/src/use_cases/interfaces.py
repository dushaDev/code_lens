from abc import ABC, abstractmethod
from datetime import datetime
from typing import List, Optional
from src.domain.entities import ProjectEntity, AuthorEntity, CommitEntity, BranchEntity, CourseEntity

class IProjectRepository(ABC):
    @abstractmethod
    def get_by_id(self, project_id: int) -> Optional[ProjectEntity]:
        pass

    @abstractmethod
    def create(self, name: str, description: Optional[str], git_url: str, course_id: int, group_no: str, store_local_copy: bool = False) -> ProjectEntity:
        pass

    @abstractmethod
    def update_local_path(self, project_id: int, local_path: str) -> None:
        pass

    @abstractmethod
    def update_is_local_copy_stored(self, project_id: int, is_stored: bool) -> None:
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

    @abstractmethod
    def get_language_distribution(self, project_id: int) -> dict:
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
    def reset_course(self, course_id: int, user_id: int) -> None:
        pass

class ICourseRepository(ABC):
    @abstractmethod
    def create(
        self,
        name: str,
        description: Optional[str],
        user_id: int,
        tech_requirements: Optional[str] = None,
        deadline: Optional[datetime] = None,
    ) -> CourseEntity:
        pass

    @abstractmethod
    def update(self, course_id: int, user_id: int, fields: dict) -> Optional[CourseEntity]:
        """Apply a partial update. Only keys present in `fields` are written, so a
        key mapped to None explicitly clears that column."""
        pass

    @abstractmethod
    def get_by_id(self, course_id: int, user_id: int) -> Optional[CourseEntity]:
        pass

    @abstractmethod
    def get_all(self, user_id: int) -> List[CourseEntity]:
        pass

    @abstractmethod
    def delete(self, course_id: int, user_id: int) -> bool:
        pass

    @abstractmethod
    def get_projects(self, course_id: int, user_id: int) -> List[ProjectEntity]:
        pass
