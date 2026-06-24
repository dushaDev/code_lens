from typing import List, Optional
from src.domain.entities import ProjectEntity, CommitEntity, BranchEntity
from src.use_cases.interfaces import IProjectRepository, ICommitRepository

class GetProjectByIdUseCase:
    def __init__(self, project_repo: IProjectRepository):
        self.project_repo = project_repo

    def execute(self, project_id: int) -> ProjectEntity:
        project = self.project_repo.get_by_id(project_id)
        if not project:
            raise ValueError(f"Project with ID {project_id} not found.")
        return project

class GetProjectBranchesUseCase:
    def __init__(self, project_repo: IProjectRepository, commit_repo: ICommitRepository = None):
        self.project_repo = project_repo
        self.commit_repo = commit_repo

    def execute(self, project_id: int) -> List[BranchEntity]:
        project = self.project_repo.get_by_id(project_id)
        if not project:
            raise ValueError(f"Project with ID {project_id} not found.")

        return self.project_repo.get_branches(project_id)

class GetProjectCommitsUseCase:
    def __init__(self, project_repo: IProjectRepository, commit_repo: ICommitRepository):
        self.project_repo = project_repo
        self.commit_repo = commit_repo

    def execute(self, project_id: int, branch: Optional[str] = None, author_id: Optional[int] = None) -> List[CommitEntity]:
        project = self.project_repo.get_by_id(project_id)
        if not project:
            raise ValueError(f"Project with ID {project_id} not found.")
            
        return self.commit_repo.get_project_commits(project_id, branch=branch, author_id=author_id)
