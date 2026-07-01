from typing import List, Optional
from src.domain.entities import CommitEntity, AuthorEntity, ProjectEntity
from src.use_cases.interfaces import IAuthorRepository, ICommitRepository, IProjectRepository, IDatabaseService

class GetAuthorCommitsUseCase:
    def __init__(self, author_repo: IAuthorRepository, commit_repo: ICommitRepository):
        self.author_repo = author_repo
        self.commit_repo = commit_repo

    def execute(self, author_id: int, project_id: Optional[int] = None, branch: Optional[str] = None) -> List[CommitEntity]:
        author = self.author_repo.get_by_id(author_id)
        if not author:
            raise ValueError(f"Author with ID {author_id} not found.")
        return self.commit_repo.get_by_author_id(author_id, project_id=project_id, branch=branch)

class GetAuthorFullProfileUseCase:
    def __init__(self, author_repo: IAuthorRepository, project_repo: IProjectRepository = None):
        self.author_repo = author_repo
        self.project_repo = project_repo

    def execute(self, author_id: int, project_id: int = None) -> AuthorEntity:
        author = self.author_repo.get_full_profile(author_id, project_id=project_id)
        if not author:
            raise ValueError(f"Author with ID {author_id} not found.")
        return author

class GetAllProjectsUseCase:
    def __init__(self, project_repo: IProjectRepository):
        self.project_repo = project_repo

    def execute(self) -> List[ProjectEntity]:
        return self.project_repo.get_all()

class GetProjectsByAuthorUseCase:
    def __init__(self, author_repo: IAuthorRepository, project_repo: IProjectRepository):
        self.author_repo = author_repo
        self.project_repo = project_repo

    def execute(self, author_id: int) -> List[ProjectEntity]:
        author = self.author_repo.get_by_id(author_id)
        if not author:
            raise ValueError(f"Author with ID {author_id} not found.")
        return self.project_repo.get_by_author_id(author_id)

class GetProjectAuthorsUseCase:
    def __init__(self, project_repo: IProjectRepository, author_repo: IAuthorRepository):
        self.project_repo = project_repo
        self.author_repo = author_repo

    def execute(self, project_id: int, branch: Optional[str] = None) -> List[AuthorEntity]:
        project = self.project_repo.get_by_id(project_id)
        if not project:
            raise ValueError(f"Project with ID {project_id} not found.")
        if branch:
            return self.author_repo.get_by_project_id_and_branch(project_id, branch)
        return self.author_repo.get_by_project_id(project_id)

class ResetDatabaseUseCase:
    def __init__(self, db_service: IDatabaseService):
        self.db_service = db_service

    def execute(self) -> None:
        self.db_service.reset_database()

class ResetCourseUseCase:
    def __init__(self, db_service: IDatabaseService):
        self.db_service = db_service

    def execute(self, course_id: int) -> None:
        self.db_service.reset_course(course_id)

class MergeAuthorsUseCase:
    def __init__(self, author_repo: IAuthorRepository):
        self.author_repo = author_repo

    def execute(self, source_author_id: int, target_author_id: int) -> None:
        if source_author_id == target_author_id:
            raise ValueError("Cannot merge an author into themselves.")

        source_author = self.author_repo.get_by_id(source_author_id)
        target_author = self.author_repo.get_by_id(target_author_id)

        if not source_author:
            raise ValueError(f"Source author with ID {source_author_id} not found.")
        if not target_author:
            raise ValueError(f"Target author with ID {target_author_id} not found.")

        # Resolve the target's root canonical parent to keep relation flat & prevent cycles
        visited = {source_author_id, target_author_id}
        root_id = target_author.canonical_author_id
        root_author = target_author
        
        while root_id is not None:
            if root_id == source_author_id:
                raise ValueError("Merging would create a dependency cycle.")
            if root_id in visited:
                break
            visited.add(root_id)
            parent = self.author_repo.get_by_id(root_id)
            if not parent:
                break
            root_author = parent
            root_id = parent.canonical_author_id

        self.author_repo.update_canonical_author_id(source_author_id, root_author.id)
