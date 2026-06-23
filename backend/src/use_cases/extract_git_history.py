from src.use_cases.interfaces import IProjectRepository, IGitExtractorService

class ExtractGitHistoryUseCase:
    def __init__(self, project_repo: IProjectRepository, extractor_service: IGitExtractorService):
        self.project_repo = project_repo
        self.extractor_service = extractor_service

    def execute(self, project_id: int) -> dict:
        project = self.project_repo.get_by_id(project_id)
        if not project:
            raise ValueError(f"Project with ID {project_id} not found.")

        result = self.extractor_service.extract_and_save(project)
        return result
