from abc import ABC, abstractmethod
from datetime import datetime
from typing import List, Optional, Any, Dict, Tuple
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

    @abstractmethod
    def get_extended_quantitative_metrics(self, project_id: int, commits: Optional[List[Any]] = None) -> dict:
        pass

    @abstractmethod
    def get_course_deadline(self, project_id: int) -> Optional[datetime]:
        pass

    @abstractmethod
    def validate_new_project(self, course_id: int, name: str, git_url: str, group_no: Optional[str] = None) -> Optional[str]:
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

    @abstractmethod
    def get_raw_contributor_file_change_stats(self, project_id: int) -> List[tuple]:
        pass

    @abstractmethod
    def get_file_change_author_pairs(self, project_id: int) -> List[tuple]:
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

class ISimilarityRepository(ABC):
    @abstractmethod
    def get_course(self, course_id: int) -> Optional[Any]:
        pass

    @abstractmethod
    def get_course_projects(self, course_id: int) -> List[Any]:
        pass

    @abstractmethod
    def save_project_fingerprints(self, project_id: int, fingerprints: List[Any]) -> None:
        pass

    @abstractmethod
    def get_existing_reports(self, course_id: int) -> List[Any]:
        pass

    @abstractmethod
    def clear_course_reports(self, course_id: int) -> None:
        pass

    @abstractmethod
    def save_similarity_reports(self, course_id: int, reports: List[dict]) -> List[Any]:
        pass

    @abstractmethod
    def get_course_reports(self, course_id: int, min_similarity: Optional[float] = None) -> List[Any]:
        pass

    @abstractmethod
    def update_comparison_coverage(self, course_id: int, projects: List[Any], reports: List[Any]) -> None:
        pass

    @abstractmethod
    def get_comparison_coverage(self, course_id: int) -> List[dict]:
        pass

    @abstractmethod
    def get_project_plagiarism_detail(self, project_id: int) -> dict:
        pass

class ILocalAIService(ABC):
    @abstractmethod
    def filter_important_folders(self, raw_folder_list: list) -> list:
        pass

    @abstractmethod
    def verify_commit_message(self, commit_message: str, code_diff: str) -> dict:
        pass

    @abstractmethod
    def compare_snippets(self, snippet_a: str, snippet_b: str) -> dict:
        pass

    @abstractmethod
    def evaluate_review_comment(self, comment_text: str) -> dict:
        pass

    @abstractmethod
    def classify_commit(
        self,
        commit_message: str,
        code_diff: str,
        lines_added: int = 0,
        lines_removed: int = 0,
        timing_flag: str = "normal",
        hours_before_deadline: Optional[float] = None,
    ) -> dict:
        pass

class IRepoInspector(ABC):
    @abstractmethod
    def inspect_folder_structure(self, repo_path: Optional[str], ai_service: Optional[Any] = None) -> dict:
        pass

    @abstractmethod
    def inspect_readme_quality(self, repo_path: Optional[str]) -> dict:
        pass

    @abstractmethod
    def inspect_repository(self, repo_path: Optional[str], ai_service: Optional[Any] = None) -> dict:
        pass


class ISimilarityEngine(ABC):
    @abstractmethod
    def extract_project_fingerprints(
        self,
        project_dir: str,
        k: int = 5,
        w: int = 4,
        allowed_extensions: Optional[List[str]] = None,
    ) -> List[Any]:
        pass

    @abstractmethod
    def compute_pairwise_similarity(
        self,
        project_fingerprints_map: dict,
        similarity_threshold: float = 40.0,
        k: int = 5,
    ) -> List[dict]:
        pass

    @abstractmethod
    def reanalyze_cluster_pairs(
        self,
        cluster_pids: List[int],
        project_fingerprints: dict,
        existing_pairs: set,
    ) -> List[dict]:
        pass

