from typing import List, Dict, Any
from src.use_cases.interfaces import IProjectRepository, IAuthorRepository, ICommitRepository
from src.domain.metrics import calculate_gini, get_gini_status

class GetProjectAnalyticsUseCase:
    def __init__(
        self,
        project_repo: IProjectRepository,
        author_repo: IAuthorRepository,
        commit_repo: ICommitRepository
    ):
        self.project_repo = project_repo
        self.author_repo = author_repo
        self.commit_repo = commit_repo

    def execute(self, project_id: int) -> Dict[str, Any]:
        project = self.project_repo.get_by_id(project_id)
        if not project:
            raise ValueError(f"Project with ID {project_id} not found.")

        # 1. Fetch all authors and commits for the project
        authors = self.author_repo.get_by_project_id(project_id)
        commits = self.commit_repo.get_by_project_id(project_id)

        total_commits = len(commits)
        total_insertions = sum(c.insertions for c in commits)

        # Resolve each commit's author_id to its canonical root id (caching results)
        canonical_id_map = {}
        for c in commits:
            author_id = c.author_id
            if author_id not in canonical_id_map:
                curr_id = author_id
                visited = set()
                while curr_id is not None and curr_id not in visited:
                    visited.add(curr_id)
                    author = self.author_repo.get_by_id(curr_id)
                    if not author or author.canonical_author_id is None:
                        break
                    curr_id = author.canonical_author_id
                canonical_id_map[author_id] = curr_id or author_id

        # Initialize tracking maps for authors
        contributions_map = {
            a.id: {
                "author_id": a.id,
                "name": a.name,
                "email": a.email,
                "commit_count": 0,
                "lines_added": 0,
                "lines_removed": 0,
                "contribution_percentage": 0.0
            }
            for a in authors
        }

        # 2. Aggregate commits and lines added per author (resolved to canonical)
        for c in commits:
            canonical_author_id = canonical_id_map.get(c.author_id, c.author_id)
            if canonical_author_id in contributions_map:
                contributions_map[canonical_author_id]["commit_count"] += 1
                contributions_map[canonical_author_id]["lines_added"] += c.insertions
                contributions_map[canonical_author_id]["lines_removed"] += c.deletions or 0

        # 3. Calculate percentages
        contributions_list = list(contributions_map.values())
        for contrib in contributions_list:
            if total_insertions > 0:
                contrib["contribution_percentage"] = round(
                    (contrib["lines_added"] / total_insertions) * 100, 2
                )
            else:
                contrib["contribution_percentage"] = 0.0

        # Sort contributions descending by lines added
        contributions_list.sort(key=lambda x: x["lines_added"], reverse=True)

        # 4. Calculate Gini Coefficient using central domain metric
        lines_list = [contrib["lines_added"] for contrib in contributions_list]
        gini = calculate_gini(lines_list)

        # 5. Determine distribution status / risk category
        status = get_gini_status(gini)

        return {
            "project_id": project_id,
            "gini_coefficient": gini,
            "total_commits": total_commits,
            "total_insertions": total_insertions,
            "distribution_status": status,
            "contributions": contributions_list,
            "language_distribution": self.project_repo.get_language_distribution(project_id)
        }
