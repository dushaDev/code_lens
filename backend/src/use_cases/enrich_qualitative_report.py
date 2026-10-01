"""
Enrich Qualitative Report Use Case
===================================
Enriches cached or fresh qualitative analysis report data with
repository folder structure, README quality, extended quantitative metrics,
and per-contributor file-change evidence.
"""
import logging
from typing import Optional, Dict, Any

from src.use_cases.interfaces import (
    IProjectRepository,
    ICommitRepository,
    IAuthorRepository,
    IRepoInspector,
)
from src.use_cases.contributor_evidence import enrich_contributors_with_file_evidence

logger = logging.getLogger(__name__)


class EnrichQualitativeReportUseCase:
    """
    Application use case for enriching qualitative analysis payloads.
    Decoupled from database frameworks, web frameworks, and file I/O specifics.
    """
    def __init__(
        self,
        project_repo: IProjectRepository,
        commit_repo: ICommitRepository,
        author_repo: IAuthorRepository,
        repo_inspector: IRepoInspector,
    ):
        self.project_repo = project_repo
        self.commit_repo = commit_repo
        self.author_repo = author_repo
        self.repo_inspector = repo_inspector

    def execute(
        self,
        project_id: int,
        qual_data: Dict[str, Any],
        canonical_map: Optional[Dict[int, int]] = None,
    ) -> Dict[str, Any]:
        """
        Enriches the qualitative data dictionary with:
        1. Language distribution
        2. Folder structure and README documentation quality
        3. Extended quantitative metrics (branches, plagiarism, AST complexity, pacing)
        4. Per-contributor file evidence (real modified filenames & edit intensity)
        """
        if not qual_data or not isinstance(qual_data, dict):
            return qual_data

        project = self.project_repo.get_by_id(project_id)
        if not project:
            return qual_data

        ps = qual_data.get("project_summary")
        if not isinstance(ps, dict):
            ps = {}
            qual_data["project_summary"] = ps

        # 1. Language distribution
        if not ps.get("language_distribution"):
            try:
                ps["language_distribution"] = self.project_repo.get_language_distribution(project_id) or {}
            except Exception as e:
                logger.warning(f"Failed to fetch language distribution for project {project_id}: {e}")

        # 2. Folder structure and README documentation quality
        repo_path = getattr(project, "local_saved_path", None)
        if repo_path and (not ps.get("folder_structure") or not ps.get("readme_quality")):
            try:
                inspection = self.repo_inspector.inspect_repository(repo_path)
                if not ps.get("folder_structure") and inspection.get("folder_structure"):
                    ps["folder_structure"] = inspection["folder_structure"]
                if not ps.get("readme_quality") and inspection.get("readme_quality"):
                    ps["readme_quality"] = inspection["readme_quality"]
            except Exception as e:
                logger.warning(f"Failed to inspect repository at {repo_path}: {e}")

        # 3. Extended quantitative metrics (branches, plagiarism, AST complexity, pacing)
        if not ps.get("branches_summary") or not ps.get("plagiarism_summary") or not ps.get("ast_complexity_summary"):
            try:
                commits_list = self.commit_repo.get_by_project_id(project_id)
                ext = self.project_repo.get_extended_quantitative_metrics(project_id, commits_list)
                if ext:
                    ps.update(ext)
            except Exception as e:
                logger.warning(f"Failed to extract extended metrics for project {project_id}: {e}")

        qual_data["project_summary"] = ps

        # 4. Per-contributor file change evidence
        try:
            if canonical_map is None:
                canonical_map = self.author_repo.get_project_canonical_map(project_id)
            enrich_contributors_with_file_evidence(
                self.commit_repo,
                project,
                qual_data,
                canonical_map,
            )
        except Exception as e:
            logger.warning(f"Failed to enrich contributor file evidence for project {project_id}: {e}")

        return qual_data
