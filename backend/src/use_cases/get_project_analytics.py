import re
from typing import List, Dict, Any, Set
from src.use_cases.interfaces import IProjectRepository, IAuthorRepository, ICommitRepository
from src.use_cases.author_utils import build_canonical_map
from src.domain.identity_signals import is_bot_identity
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
        # Exclude GitHub bot accounts — they are not students and skew Gini/percentages
        authors = [a for a in authors if not is_bot_identity(a.name, a.email)]
        commits = self.commit_repo.get_by_project_id(project_id)

        total_commits = len(commits)
        total_insertions = sum(c.insertions for c in commits)

        # Resolve each author_id to its canonical root id
        canonical_id_map = build_canonical_map(self.author_repo, authors)

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

        direct_commit_emails: Set[str] = set()
        co_author_emails: Set[str] = set()
        
        # Regex to match Co-authored-by: Name <email>
        co_author_pattern = re.compile(r"Co-authored-by:\s*(.*?)\s*<(.*?)>", re.IGNORECASE)

        # 2. Aggregate commits and lines added per author (resolved to canonical)
        for c in commits:
            canonical_author_id = canonical_id_map.get(c.author_id, c.author_id)
            if canonical_author_id in contributions_map:
                contributions_map[canonical_author_id]["commit_count"] += 1
                contributions_map[canonical_author_id]["lines_added"] += c.insertions
                contributions_map[canonical_author_id]["lines_removed"] += c.deletions or 0
                
                # Track direct committers
                direct_commit_emails.add(contributions_map[canonical_author_id]["email"].lower())
            
            # Extract co-authors from commit message
            if c.message:
                matches = co_author_pattern.findall(c.message)
                for name, email in matches:
                    if not is_bot_identity(name, email):
                        co_author_emails.add(email.lower().strip())

        co_authors_only_count = len(co_author_emails - direct_commit_emails)

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

        # 4. Calculate Gini Coefficient using lines added (consistent with qualitative analysis)
        lines_added_list = [contrib["lines_added"] for contrib in contributions_list]
        gini = calculate_gini(lines_added_list)

        # 5. Determine distribution status / risk category
        status = get_gini_status(gini)

        return {
            "project_id": project_id,
            "gini_coefficient": gini,
            "total_commits": total_commits,
            "total_insertions": total_insertions,
            "distribution_status": status,
            "contributions": contributions_list,
            "co_authors_only_count": co_authors_only_count,
            "language_distribution": self.project_repo.get_language_distribution(project_id)
        }
