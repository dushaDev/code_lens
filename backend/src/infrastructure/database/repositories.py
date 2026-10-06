import os
import shutil
import json
import logging
from collections import Counter, defaultdict
from datetime import datetime
from typing import List, Optional, Tuple, Set, Any
from sqlalchemy import func, desc
from sqlalchemy.orm import Session, selectinload, joinedload, defer
from src.domain.entities import ProjectEntity, AuthorEntity, CommitEntity, FileChangeEntity, BranchEntity, CourseEntity
from src.use_cases.interfaces import IProjectRepository, IAuthorRepository, ICommitRepository, IDatabaseService, ICourseRepository, ISimilarityRepository
from src.infrastructure.database.models import (
    ProjectModel, AuthorModel, CommitModel, FileChangeModel, BranchModel, CourseModel, Base,
    ProjectFingerprintModel, SimilarityReportModel, ComparisonCoverageModel, commit_branches
)
from src.infrastructure.database.session import engine, SessionLocal
from src.domain.constants import (
    DEFAULT_GROUP, DEFAULT_SAMPLING_MODE, EXTENSION_TO_LANGUAGE,
    SAVED_REPOS_PATH_TEMPLATE, TEMP_REPOS_PATH_TEMPLATE, normalize_git_url
)

logger = logging.getLogger(__name__)

def _resolve_canonical_author(db: Session, author_model: AuthorModel) -> Tuple[AuthorModel, List[int]]:
    """
    [DEAD CODE — RETAINED INTENTIONALLY]

    Resolves an author ORM model to its root canonical parent by walking the
    canonical_author_id chain, and returns both the root AuthorModel and all
    alias IDs (root + every alias linked via the `aliases` relationship).

    WHY THIS IS KEPT:
    - This is the DB-layer (infrastructure) counterpart of `build_canonical_map()`
      in `src/use_cases/author_utils.py`.
    - `build_canonical_map()` works through the IAuthorRepository interface (use-case
      layer) and builds a flat id→root_id dict for a batch of authors.
    - THIS function works directly with SQLAlchemy ORM objects and additionally
      returns the full alias ID list via `root.aliases` — a relationship not
      available through the abstract interface.
    - If future infrastructure-layer code (e.g., a merge validator, a DB migration
      script, or a cascade-cleanup job) needs to walk the canonical chain and also
      resolve the SQLAlchemy `aliases` relationship in one call, use THIS function.
    - For all use-case-level canonical resolution, use `build_canonical_map()` instead
      to preserve the Clean Architecture dependency boundary.

    CALLERS: None currently. If still unused after 2 refactor cycles, delete it.
    """
    root = author_model
    visited = {author_model.id}
    while root.canonical_author_id is not None and root.canonical_author_id not in visited:
        visited.add(root.canonical_author_id)
        parent = db.query(AuthorModel).filter(AuthorModel.id == root.canonical_author_id).first()
        if not parent:
            break
        root = parent

    alias_ids = [alias.id for alias in root.aliases]
    author_ids = [root.id] + alias_ids
    return root, author_ids

class ProjectRepository(IProjectRepository):
    def __init__(self, db: Session):
        self.db = db

    def _detect_tech_stack(self, project_id: int) -> List[str]:
        results = (
            self.db.query(FileChangeModel.filename)
            .join(CommitModel)
            .filter(CommitModel.project_id == project_id)
            .all()
        )
        counter = Counter()
        for row in results:
            filename = row[0]
            ext = os.path.splitext(filename)[1].lower()
            if ext in EXTENSION_TO_LANGUAGE:
                counter[EXTENSION_TO_LANGUAGE[ext]] += 1
                
        if not counter:
            project = self.db.query(ProjectModel).filter(ProjectModel.id == project_id).first()
            if project:
                name_lower = project.name.lower()
                if any(x in name_lower for x in ['react', 'web', 'node', 'js']):
                    return ['JavaScript']
                if any(x in name_lower for x in ['structure', 'c++', 'cpp', 'tree']):
                    return ['C++']
                if any(x in name_lower for x in ['android', 'kotlin', 'mobile', 'app']):
                    return ['Kotlin']
            return ['Python']
            
        return [tech for tech, count in counter.most_common(4)]

    def get_language_distribution(self, project_id: int) -> dict:
        results = (
            self.db.query(FileChangeModel.filename, FileChangeModel.lines_added)
            .join(CommitModel)
            .filter(CommitModel.project_id == project_id)
            .all()
        )
        counter = Counter()
        for filename, lines_added in results:
            ext = os.path.splitext(filename)[1].lower()
            if ext in EXTENSION_TO_LANGUAGE:
                counter[EXTENSION_TO_LANGUAGE[ext]] += lines_added
                
        if not counter:
            techs = self._detect_tech_stack(project_id)
            if techs:
                return {techs[0]: 100.0}
            return {'Python': 100.0}
            
        total_lines = sum(counter.values())
        if total_lines == 0:
            techs = self._detect_tech_stack(project_id)
            if techs:
                return {techs[0]: 100.0}
            return {'Python': 100.0}
            
        distribution = {}
        for tech, lines in counter.items():
            pct = round((lines / total_lines) * 100, 1)
            if pct > 0:
                distribution[tech] = pct
                
        return dict(sorted(distribution.items(), key=lambda x: x[1], reverse=True))

    def get_by_id(self, project_id: int) -> Optional[ProjectEntity]:
        project_model = self.db.query(ProjectModel).filter(ProjectModel.id == project_id).first()
        if not project_model:
            return None
        return ProjectEntity(
            id=project_model.id,
            name=project_model.name,
            description=project_model.description,
            git_url=project_model.git_url,
            local_saved_path=project_model.local_saved_path,
            group_no=project_model.group_no or DEFAULT_GROUP,
            store_local_copy=project_model.store_local_copy or False,
            is_local_copy_stored=project_model.is_local_copy_stored or False,
            created_at=project_model.created_at,
            course_id=project_model.course_id,
            sampling_mode=project_model.sampling_mode or DEFAULT_SAMPLING_MODE,
            tech_stack=self._detect_tech_stack(project_model.id)
        )

    def create(self, name: str, description: Optional[str], git_url: str, course_id: int, group_no: str, store_local_copy: bool = True) -> ProjectEntity:
        course = self.db.query(CourseModel).filter(CourseModel.id == course_id).first()
        def_mode = course.default_sampling_mode if (course and course.default_sampling_mode) else DEFAULT_SAMPLING_MODE
        # Initial saved path is empty, updated via update_local_path once ID is flushed/committed
        project_model = ProjectModel(
            name=(name or "").replace("\x00", ""),
            description=description.replace("\x00", "") if description else None,
            git_url=(git_url or "").replace("\x00", ""),
            local_saved_path="",
            group_no=(group_no or DEFAULT_GROUP).replace("\x00", ""),
            store_local_copy=True,
            is_local_copy_stored=True,
            sampling_mode=def_mode,
            course_id=course_id
        )
        self.db.add(project_model)
        self.db.flush()  # Populates ID
        
        return ProjectEntity(
            id=project_model.id,
            name=project_model.name,
            description=project_model.description,
            git_url=project_model.git_url,
            local_saved_path=project_model.local_saved_path,
            group_no=project_model.group_no or DEFAULT_GROUP,
            store_local_copy=project_model.store_local_copy,
            is_local_copy_stored=project_model.is_local_copy_stored,
            created_at=project_model.created_at,
            course_id=project_model.course_id,
            sampling_mode=project_model.sampling_mode,
            tech_stack=self._detect_tech_stack(project_model.id)
        )

    def update_local_path(self, project_id: int, local_path: str) -> None:
        project_model = self.db.query(ProjectModel).filter(ProjectModel.id == project_id).first()
        if project_model:
            project_model.local_saved_path = local_path
            self.db.commit()

    def update_is_local_copy_stored(self, project_id: int, is_stored: bool) -> None:
        project_model = self.db.query(ProjectModel).filter(ProjectModel.id == project_id).first()
        if project_model:
            project_model.is_local_copy_stored = is_stored
            self.db.commit()

    def save_qualitative_report(self, project_id: int, report_json: str) -> None:
        project_model = self.db.query(ProjectModel).filter(ProjectModel.id == project_id).first()
        if project_model:
            project_model.qualitative_report = report_json
            self.db.commit()

    def get_qualitative_report(self, project_id: int) -> Optional[str]:
        """Read the cached local-AI qualitative report JSON straight from the DB.

        ProjectEntity intentionally omits this column, so callers holding only
        an entity must go through the repository to reach it.
        """
        project_model = self.db.query(ProjectModel).filter(ProjectModel.id == project_id).first()
        return project_model.qualitative_report if project_model else None

    def clear_cloud_report(self, project_id: int) -> None:
        """Invalidate the cached cloud narrative so the next report generation
        rebuilds from the latest data.

        The cloud_report is synthesized *from* the qualitative_report, so once a
        fresh qualitative pass runs (first-time analyze or Re-analyze) the cached
        cloud narrative is stale and must not be silently reused by the PDF
        endpoint. Only writes when a cached value actually exists, so a
        first-time analyze (cloud_report already NULL) incurs no needless commit.
        """
        project_model = self.db.query(ProjectModel).filter(ProjectModel.id == project_id).first()
        if project_model and project_model.cloud_report is not None:
            project_model.cloud_report = None
            self.db.commit()

    def delete(self, project_id: int) -> bool:
        project_model = self.db.query(ProjectModel).filter(ProjectModel.id == project_id).first()
        if not project_model:
            return False

        # 1. Remove project files from local disk if directory exists
        local_path = project_model.local_saved_path
        if local_path and os.path.exists(local_path):
            try:
                shutil.rmtree(local_path)
            except Exception as e:
                logger.warning(f"Failed to delete local clone directory at '{local_path}': {e}")

        fallback_path = SAVED_REPOS_PATH_TEMPLATE.format(project_id)
        if os.path.exists(fallback_path):
            try:
                shutil.rmtree(fallback_path)
            except Exception as e:
                logger.warning(f"Failed to delete fallback directory at '{fallback_path}': {e}")

        temp_path = TEMP_REPOS_PATH_TEMPLATE.format(project_id)
        if os.path.exists(temp_path):
            try:
                shutil.rmtree(temp_path)
            except Exception as e:
                logger.warning(f"Failed to delete temp directory at '{temp_path}': {e}")

        # Remove any leftover per-project extraction lock files (normally released
        # by the extractor, but may linger after a hard crash).
        for lock_path in (
            SAVED_REPOS_PATH_TEMPLATE.format(project_id) + ".lock",
            TEMP_REPOS_PATH_TEMPLATE.format(project_id) + ".lock",
        ):
            try:
                os.remove(lock_path)
            except FileNotFoundError:
                pass
            except OSError as e:
                logger.warning(f"Failed to delete extraction lock at '{lock_path}': {e}")

        # 2. Delete all related DB records explicitly
        self.db.query(ProjectFingerprintModel).filter(ProjectFingerprintModel.project_id == project_id).delete(synchronize_session=False)
        self.db.query(SimilarityReportModel).filter(
            (SimilarityReportModel.project_a_id == project_id) | (SimilarityReportModel.project_b_id == project_id)
        ).delete(synchronize_session=False)
        self.db.query(ComparisonCoverageModel).filter(ComparisonCoverageModel.project_id == project_id).delete(synchronize_session=False)

        commit_hashes = [c.hash for c in self.db.query(CommitModel.hash).filter(CommitModel.project_id == project_id).all()]
        if commit_hashes:
            self.db.query(FileChangeModel).filter(FileChangeModel.commit_hash.in_(commit_hashes)).delete(synchronize_session=False)
            self.db.query(CommitModel).filter(CommitModel.project_id == project_id).delete(synchronize_session=False)

        self.db.query(BranchModel).filter(BranchModel.project_id == project_id).delete(synchronize_session=False)

        # 3. Delete Project record itself
        self.db.delete(project_model)
        self.db.commit()
        return True

    def get_all(self) -> List[ProjectEntity]:
        project_models = self.db.query(ProjectModel).all()
        return [
            ProjectEntity(
                id=m.id,
                name=m.name,
                git_url=m.git_url,
                local_saved_path=m.local_saved_path,
                group_no=m.group_no or DEFAULT_GROUP,
                store_local_copy=m.store_local_copy or False,
                is_local_copy_stored=m.is_local_copy_stored or False,
                description=m.description,
                created_at=m.created_at,
                course_id=m.course_id,
                tech_stack=self._detect_tech_stack(m.id)
            )
            for m in project_models
        ]

    def get_by_author_id(self, author_id: int) -> List[ProjectEntity]:
        project_models = (
            self.db.query(ProjectModel)
            .join(CommitModel)
            .filter(CommitModel.author_id == author_id)
            .distinct()
            .all()
        )
        return [
            ProjectEntity(
                id=m.id,
                name=m.name,
                git_url=m.git_url,
                local_saved_path=m.local_saved_path,
                group_no=m.group_no or DEFAULT_GROUP,
                store_local_copy=m.store_local_copy or False,
                is_local_copy_stored=m.is_local_copy_stored or False,
                description=m.description,
                created_at=m.created_at,
                course_id=m.course_id,
                tech_stack=self._detect_tech_stack(m.id)
            )
            for m in project_models
        ]

    def get_branches(self, project_id: int) -> List[BranchEntity]:
        branch_models = self.db.query(BranchModel).filter(BranchModel.project_id == project_id).all()
        return [
            BranchEntity(
                id=m.id,
                project_id=m.project_id,
                name=m.name,
                short_name=m.short_name
            )
            for m in branch_models
        ]

    def get_extended_quantitative_metrics(self, project_id: int, commits: Optional[List[Any]] = None) -> dict:
        """Extract extended quantitative metrics: branches, similarity reports, AST complexity, timeline peak."""
        branches_summary = {"total_branches": 0, "top_branches": []}
        try:
            results = self.db.query(
                BranchModel.name,
                func.count(commit_branches.c.commit_hash).label("commit_count")
            ).outerjoin(commit_branches, BranchModel.id == commit_branches.c.branch_id)\
             .filter(BranchModel.project_id == project_id)\
             .group_by(BranchModel.id, BranchModel.name)\
             .order_by(desc("commit_count")).all()

            total_b = len(results)
            top_b = [{"name": r[0], "commits": r[1]} for r in results[:10]]
            branches_summary = {
                "total_branches": total_b,
                "top_branches": top_b
            }
        except Exception as e:
            logger.warning(f"Branch extraction error: {e}")

        plagiarism_summary = {
            "has_scan": False,
            "max_similarity_score": 0.0,
            "matched_project_name": None,
            "status": "No Scan Performed",
            "matched_blocks_count": 0
        }
        try:
            reports = self.db.query(SimilarityReportModel).filter(
                (SimilarityReportModel.project_a_id == project_id) |
                (SimilarityReportModel.project_b_id == project_id)
            ).order_by(desc(SimilarityReportModel.similarity_score)).all()

            if reports:
                top_r = reports[0]
                partner_id = top_r.project_b_id if top_r.project_a_id == project_id else top_r.project_a_id
                partner_proj = self.db.query(ProjectModel).filter(ProjectModel.id == partner_id).first()
                partner_name = partner_proj.name if partner_proj else f"Project #{partner_id}"

                plagiarism_summary = {
                    "has_scan": True,
                    "max_similarity_score": round(top_r.similarity_score * 100.0, 1) if top_r.similarity_score <= 1.0 else round(top_r.similarity_score, 1),
                    "matched_project_name": partner_name,
                    "status": top_r.status or "Needs Review",
                    "matched_blocks_count": top_r.matched_hashes_count or 0
                }
        except Exception as e:
            logger.warning(f"Similarity extraction error: {e}")

        ast_complexity_summary = {
            "avg_complexity_score": 0.0,
            "total_functions": 0,
            "squash_suspected_commits": 0
        }
        try:
            ast_res = self.db.query(
                func.avg(FileChangeModel.complexity_score),
                func.sum(FileChangeModel.function_count)
            ).join(CommitModel, FileChangeModel.commit_hash == CommitModel.hash)\
             .filter(CommitModel.project_id == project_id).first()

            squash_count = self.db.query(func.count(CommitModel.hash)).filter(
                CommitModel.project_id == project_id,
                CommitModel.is_squash_suspected == True
            ).scalar() or 0

            avg_comp = round(float(ast_res[0]), 1) if ast_res and ast_res[0] is not None else 0.0
            tot_func = int(ast_res[1]) if ast_res and ast_res[1] is not None else 0

            ast_complexity_summary = {
                "avg_complexity_score": avg_comp,
                "total_functions": tot_func,
                "squash_suspected_commits": squash_count
            }
        except Exception as e:
            logger.warning(f"AST complexity error: {e}")

        pacing_summary = {
            "peak_commit_date": "N/A",
            "peak_commit_count": 0,
            "avg_commits_per_active_day": 0.0,
            "project_span_days": 0,
            "active_days_count": 0
        }
        try:
            if commits:
                daily_counts = {}
                for c in commits:
                    ts = getattr(c, "timestamp", None)
                    if ts:
                        d_str = ts.strftime("%Y-%m-%d")
                        daily_counts[d_str] = daily_counts.get(d_str, 0) + 1
                if daily_counts:
                    peak_date = max(daily_counts, key=daily_counts.get)
                    peak_val = daily_counts[peak_date]
                    avg_val = round(sum(daily_counts.values()) / len(daily_counts), 1)

                    timestamps = [getattr(c, "timestamp", None) for c in commits if getattr(c, "timestamp", None)]
                    project_span_days = 0
                    if timestamps:
                        start_date = min(timestamps)
                        end_date = max(timestamps)
                        project_span_days = (end_date.date() - start_date.date()).days + 1

                    pacing_summary = {
                        "peak_commit_date": peak_date,
                        "peak_commit_count": peak_val,
                        "avg_commits_per_active_day": avg_val,
                        "project_span_days": project_span_days,
                        "active_days_count": len(daily_counts)
                    }
        except Exception as e:
            logger.exception(f"Pacing summary extraction failed: {e}")

        return {
            "branches_summary": branches_summary,
            "plagiarism_summary": plagiarism_summary,
            "ast_complexity_summary": ast_complexity_summary,
            "pacing_summary": pacing_summary
        }

    def get_course_deadline(self, project_id: int) -> Optional[datetime]:
        project = self.db.query(ProjectModel).filter(ProjectModel.id == project_id).first()
        if project and project.course_id:
            course = self.db.query(CourseModel).filter(CourseModel.id == project.course_id).first()
            if course and course.deadline:
                return course.deadline
        return None

    def validate_new_project(self, course_id: int, name: str, git_url: str, group_no: Optional[str] = None) -> Optional[str]:
        if group_no and group_no.strip():
            existing_group = self.db.query(ProjectModel).filter(
                ProjectModel.course_id == course_id,
                func.lower(ProjectModel.group_no) == group_no.strip().lower()
            ).first()
            if existing_group:
                return f"Group No / Tag '{group_no.strip()}' already exists in this course."

        if git_url and git_url.strip():
            clean_url = normalize_git_url(git_url)
            course_projects = self.db.query(ProjectModel).filter(ProjectModel.course_id == course_id).all()
            for p in course_projects:
                if p.git_url and normalize_git_url(p.git_url) == clean_url:
                    return f"Repository URL '{git_url.strip()}' is already imported in this course."

        if name and name.strip():
            existing_name = self.db.query(ProjectModel).filter(
                ProjectModel.course_id == course_id,
                func.lower(ProjectModel.name) == name.strip().lower()
            ).first()
            if existing_name:
                return f"Project name '{name.strip()}' already exists in this course."
        return None



class AuthorRepository(IAuthorRepository):
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, author_id: int) -> Optional[AuthorEntity]:
        author_model = self.db.query(AuthorModel).filter(AuthorModel.id == author_id).first()
        if not author_model:
            return None
        return AuthorEntity(
            id=author_model.id,
            name=author_model.name,
            email=author_model.email,
            canonical_author_id=author_model.canonical_author_id
        )

    def get_full_profile(self, author_id: int, project_id: Optional[int] = None) -> Optional[AuthorEntity]:
        # 1. Author must exist
        author_model = self.db.query(AuthorModel).filter(AuthorModel.id == author_id).first()
        if not author_model:
            return None

        # 2. If this author is an alias, recursively redirect to their root canonical parent
        root, author_ids = _resolve_canonical_author(self.db, author_model)
        if root.id != author_id:
            return self.get_full_profile(root.id, project_id=project_id)

        # 4. Build the commits query, filtering by project_id and combining all alias commits
        commits_query = (
            self.db.query(CommitModel)
            .filter(CommitModel.author_id.in_(author_ids))
            .options(
                selectinload(CommitModel.file_changes).defer(FileChangeModel.raw_diff),
                selectinload(CommitModel.branches),
                joinedload(CommitModel.project)
            )
        )
        if project_id is not None:
            commits_query = commits_query.filter(CommitModel.project_id == project_id)

        commit_models = commits_query.all()

        commits = []
        for c in commit_models:
            file_changes = [
                FileChangeEntity(
                    id=fc.id,
                    filename=fc.filename,
                    status=fc.status,
                    lines_added=fc.lines_added,
                    lines_removed=fc.lines_removed,
                    raw_diff=None,          # deferred — not needed by this endpoint
                    commit_hash=fc.commit_hash
                )
                for fc in c.file_changes
            ]
            project = None
            if c.project:
                project = ProjectEntity(
                    id=c.project.id,
                    name=c.project.name,
                    git_url=c.project.git_url,
                    local_saved_path=c.project.local_saved_path,
                    group_no=c.project.group_no or DEFAULT_GROUP,
                    description=c.project.description,
                    created_at=c.project.created_at
                )

            commits.append(
                CommitEntity(
                    hash=c.hash,
                    project_id=c.project_id,
                    author_id=c.author_id,
                    timestamp=c.timestamp,
                    message=c.message,
                    insertions=c.insertions,
                    deletions=c.deletions,
                    is_squash_suspected=c.is_squash_suspected,
                    branches=[
                        BranchEntity(id=b.id, project_id=b.project_id, name=b.name, short_name=b.short_name)
                        for b in c.branches
                    ],
                    file_changes=file_changes,
                    project=project
                )
            )

        return AuthorEntity(
            id=author_model.id,
            name=author_model.name,
            email=author_model.email,
            canonical_author_id=author_model.canonical_author_id,
            commits=commits
        )

    def get_by_project_id(self, project_id: int) -> List[AuthorEntity]:
        # Query all authors who have committed to the project
        author_models = (
            self.db.query(AuthorModel)
            .join(CommitModel)
            .filter(CommitModel.project_id == project_id)
            .distinct()
            .all()
        )
        
        # Map aliases to their canonical root authors
        resolved_authors = {}
        for m in author_models:
            root, _ = _resolve_canonical_author(self.db, m)
            resolved_authors[root.id] = root

        return [
            AuthorEntity(
                id=r.id,
                name=r.name,
                email=r.email,
                canonical_author_id=r.canonical_author_id
            )
            for r in resolved_authors.values()
        ]

    def get_project_canonical_map(self, project_id: int) -> dict:
        """Map every raw author id tied to the project (including merged aliases)
        to its canonical root id.

        Merging only sets canonical_author_id; it does not reassign commits or
        regenerate cached reports. Callers use this live map to hide identity
        anomaly / "needs merge" suggestions for accounts an educator has already
        merged."""
        author_models = (
            self.db.query(AuthorModel)
            .join(CommitModel)
            .filter(CommitModel.project_id == project_id)
            .distinct()
            .all()
        )
        mapping = {}
        for m in author_models:
            root, author_ids = _resolve_canonical_author(self.db, m)
            for aid in author_ids:
                mapping[aid] = root.id
            mapping[m.id] = root.id
        return mapping

    def get_by_project_id_and_branch(self, project_id: int, branch: str) -> List[AuthorEntity]:
        # Query all authors who have committed to the project on a specific branch
        author_models = (
            self.db.query(AuthorModel)
            .join(CommitModel)
            .join(CommitModel.branches)
            .filter(
                CommitModel.project_id == project_id,
                (BranchModel.name == branch) | (BranchModel.short_name == branch)
            )
            .distinct()
            .all()
        )

        # Map aliases to their canonical root authors
        resolved_authors = {}
        for m in author_models:
            root, _ = _resolve_canonical_author(self.db, m)
            resolved_authors[root.id] = root

        return [
            AuthorEntity(
                id=r.id,
                name=r.name,
                email=r.email,
                canonical_author_id=r.canonical_author_id
            )
            for r in resolved_authors.values()
        ]

    def get_all(self) -> List[AuthorEntity]:
        # Get only root canonical authors to avoid duplicates in global list
        author_models = self.db.query(AuthorModel).filter(AuthorModel.canonical_author_id.is_(None)).all()
        return [
            AuthorEntity(
                id=m.id,
                name=m.name,
                email=m.email,
                canonical_author_id=m.canonical_author_id
            )
            for m in author_models
        ]

    def update_canonical_author_id(self, author_id: int, canonical_id: Optional[int]) -> None:
        author_model = self.db.query(AuthorModel).filter(AuthorModel.id == author_id).first()
        if author_model:
            author_model.canonical_author_id = canonical_id
            self.db.commit()


class CommitRepository(ICommitRepository):
    def __init__(self, db: Session):
        self.db = db

    def get_by_author_id(self, author_id: int, project_id: Optional[int] = None, branch: Optional[str] = None) -> List[CommitEntity]:
        # Find root and all aliases of the author to include their commits
        author = self.db.query(AuthorModel).filter(AuthorModel.id == author_id).first()
        if author:
            root, author_ids = _resolve_canonical_author(self.db, author)
            query = self.db.query(CommitModel).filter(CommitModel.author_id.in_(author_ids))
        else:
            query = self.db.query(CommitModel).filter(CommitModel.author_id == author_id)

        if project_id is not None:
            query = query.filter(CommitModel.project_id == project_id)

        if branch is not None:
            query = query.join(CommitModel.branches).filter(
                (BranchModel.name == branch) | (BranchModel.short_name == branch)
            )

        commit_models = query.options(selectinload(CommitModel.branches)).order_by(CommitModel.timestamp.desc()).all()
        return [
            CommitEntity(
                hash=m.hash,
                project_id=m.project_id,
                author_id=m.author_id,
                timestamp=m.timestamp,
                message=m.message,
                insertions=m.insertions,
                deletions=m.deletions,
                is_squash_suspected=m.is_squash_suspected,
                branches=[
                    BranchEntity(id=b.id, project_id=b.project_id, name=b.name, short_name=b.short_name)
                    for b in m.branches
                ]
            )
            for m in commit_models
        ]

    def get_by_project_id(self, project_id: int) -> List[CommitEntity]:
        commit_models = (
            self.db.query(CommitModel)
            .filter(CommitModel.project_id == project_id)
            .options(selectinload(CommitModel.branches), selectinload(CommitModel.file_changes))
            .all()
        )
        return [
            CommitEntity(
                hash=m.hash,
                project_id=m.project_id,
                author_id=m.author_id,
                timestamp=m.timestamp,
                message=m.message,
                insertions=m.insertions,
                deletions=m.deletions,
                is_squash_suspected=m.is_squash_suspected,
                branches=[
                    BranchEntity(id=b.id, project_id=b.project_id, name=b.name, short_name=b.short_name)
                    for b in m.branches
                ],
                file_changes=[
                    FileChangeEntity(
                        id=fc.id,
                        commit_hash=fc.commit_hash,
                        filename=fc.filename,
                        status=fc.status,
                        lines_added=fc.lines_added,
                        lines_removed=fc.lines_removed,
                        raw_diff=fc.raw_diff
                    )
                    for fc in m.file_changes
                ]
            )
            for m in commit_models
        ]

    def get_project_commits(self, project_id: int, branch: Optional[str] = None, author_id: Optional[int] = None) -> List[CommitEntity]:
        query = self.db.query(CommitModel).filter(CommitModel.project_id == project_id)

        if author_id is not None:
            # Find root and all aliases of the author to include their commits
            author = self.db.query(AuthorModel).filter(AuthorModel.id == author_id).first()
            if author:
                root, author_ids = _resolve_canonical_author(self.db, author)
                query = query.filter(CommitModel.author_id.in_(author_ids))
            else:
                query = query.filter(CommitModel.author_id == author_id)

        if branch is not None:
            query = query.join(CommitModel.branches).filter(
                (BranchModel.name == branch) | (BranchModel.short_name == branch)
            )

        commit_models = query.options(selectinload(CommitModel.branches)).order_by(CommitModel.timestamp.desc()).all()
        return [
            CommitEntity(
                hash=m.hash,
                project_id=m.project_id,
                author_id=m.author_id,
                timestamp=m.timestamp,
                message=m.message,
                insertions=m.insertions,
                deletions=m.deletions,
                is_squash_suspected=m.is_squash_suspected,
                branches=[
                    BranchEntity(id=b.id, project_id=b.project_id, name=b.name, short_name=b.short_name)
                    for b in m.branches
                ]
            )
            for m in commit_models
        ]

    def get_raw_contributor_file_change_stats(self, project_id: int) -> List[tuple]:
        return (
            self.db.query(
                FileChangeModel.filename,
                CommitModel.author_id,
                func.count(FileChangeModel.id),
                func.sum(func.coalesce(FileChangeModel.complexity_score, 0)),
                func.sum(func.coalesce(FileChangeModel.function_count, 0)),
            )
            .join(CommitModel, FileChangeModel.commit_hash == CommitModel.hash)
            .filter(CommitModel.project_id == project_id)
            .group_by(FileChangeModel.filename, CommitModel.author_id)
            .all()
        )

    def get_file_change_author_pairs(self, project_id: int) -> List[tuple]:
        return (
            self.db.query(FileChangeModel.filename, CommitModel.author_id)
            .join(CommitModel)
            .filter(CommitModel.project_id == project_id)
            .all()
        )

class DatabaseService(IDatabaseService):
    def __init__(self, db: Optional[Session] = None):
        self.db = db

    def reset_course(self, course_id: int, user_id: int) -> None:


        session = self.db or SessionLocal()
        try:
            # Verify ownership before resetting
            projects = (
                session.query(ProjectModel)
                .join(CourseModel)
                .filter(ProjectModel.course_id == course_id, CourseModel.user_id == user_id)
                .all()
            )
            for project in projects:
                # Delete local clone repository directory from disk
                if project.local_saved_path and os.path.exists(project.local_saved_path):
                    shutil.rmtree(project.local_saved_path, ignore_errors=True)

                fallback_path = SAVED_REPOS_PATH_TEMPLATE.format(project.id)
                if os.path.exists(fallback_path):
                    shutil.rmtree(fallback_path, ignore_errors=True)
                temp_path = TEMP_REPOS_PATH_TEMPLATE.format(project.id)
                if os.path.exists(temp_path):
                    shutil.rmtree(temp_path, ignore_errors=True)

                # Remove any leftover per-project extraction lock files
                for lock_path in (fallback_path + ".lock", temp_path + ".lock"):
                    try:
                        os.remove(lock_path)
                    except OSError:
                        pass

                session.delete(project)
            session.commit()
        except Exception as e:
            session.rollback()
            raise e
        finally:
            if not self.db:
                session.close()


class CourseRepository(ICourseRepository):
    def __init__(self, db: Session):
        self.db = db

    def _to_entity(self, m: CourseModel) -> CourseEntity:
        return CourseEntity(
            id=m.id,
            name=m.name,
            description=m.description,
            tech_requirements=m.tech_requirements,
            deadline=m.deadline,
            default_sampling_mode=m.default_sampling_mode or DEFAULT_SAMPLING_MODE,
            created_at=m.created_at,
            user_id=m.user_id
        )

    def create(
        self,
        name: str,
        description: Optional[str],
        user_id: int,
        tech_requirements: Optional[str] = None,
        deadline: Optional[datetime] = None,
        default_sampling_mode: Optional[str] = DEFAULT_SAMPLING_MODE,
    ) -> CourseEntity:
        course_model = CourseModel(
            name=name,
            description=description,
            user_id=user_id,
            tech_requirements=tech_requirements,
            deadline=deadline,
            default_sampling_mode=default_sampling_mode or DEFAULT_SAMPLING_MODE,
        )
        self.db.add(course_model)
        self.db.commit()
        self.db.refresh(course_model)
        return self._to_entity(course_model)

    def update(self, course_id: int, user_id: int, fields: dict) -> Optional[CourseEntity]:
        course_model = self.db.query(CourseModel).filter(
            CourseModel.id == course_id,
            CourseModel.user_id == user_id
        ).first()
        if not course_model:
            return None

        for key, value in fields.items():
            setattr(course_model, key, value)

        self.db.commit()
        self.db.refresh(course_model)
        return self._to_entity(course_model)

    def get_by_id(self, course_id: int, user_id: int) -> Optional[CourseEntity]:
        course_model = self.db.query(CourseModel).filter(
            CourseModel.id == course_id,
            CourseModel.user_id == user_id
        ).first()
        return self._to_entity(course_model) if course_model else None

    def get_all(self, user_id: int) -> List[CourseEntity]:
        course_models = self.db.query(CourseModel).filter(CourseModel.user_id == user_id).all()
        return [self._to_entity(m) for m in course_models]

    def delete(self, course_id: int, user_id: int) -> bool:
        course_model = self.db.query(CourseModel).filter(
            CourseModel.id == course_id,
            CourseModel.user_id == user_id
        ).first()
        if not course_model:
            return False
        self.db.delete(course_model)
        self.db.commit()
        return True

    def get_projects(self, course_id: int, user_id: int) -> List[ProjectEntity]:
        # Strictly verify course ownership first
        course = self.db.query(CourseModel).filter(
            CourseModel.id == course_id,
            CourseModel.user_id == user_id
        ).first()
        if not course:
            return []
        project_models = self.db.query(ProjectModel).filter(ProjectModel.course_id == course_id).all()
        project_repo = ProjectRepository(self.db)
        return [
            ProjectEntity(
                id=m.id,
                name=m.name,
                git_url=m.git_url,
                local_saved_path=m.local_saved_path,
                group_no=m.group_no or DEFAULT_GROUP,
                description=m.description,
                created_at=m.created_at,
                course_id=m.course_id,
                sampling_mode=m.sampling_mode or DEFAULT_SAMPLING_MODE,
                tech_stack=project_repo._detect_tech_stack(m.id)
            )
            for m in project_models
        ]


class SimilarityRepository(ISimilarityRepository):
    def __init__(self, db: Session):
        self.db = db

    def get_course(self, course_id: int) -> Optional[CourseEntity]:
        m = self.db.query(CourseModel).filter(CourseModel.id == course_id).first()
        if not m:
            return None
        return CourseEntity(id=m.id, name=m.name, user_id=m.user_id)

    def get_course_projects(self, course_id: int) -> List[ProjectEntity]:
        project_models = self.db.query(ProjectModel).filter(ProjectModel.course_id == course_id).all()
        return [
            ProjectEntity(
                id=m.id,
                name=m.name,
                git_url=m.git_url,
                local_saved_path=m.local_saved_path,
                group_no=m.group_no or DEFAULT_GROUP,
                course_id=m.course_id
            )
            for m in project_models
        ]

    def save_project_fingerprints(self, project_id: int, fingerprints: List[Any]) -> None:
        self.db.query(ProjectFingerprintModel).filter(
            ProjectFingerprintModel.project_id == project_id
        ).delete(synchronize_session=False)
        if fingerprints:
            db_fps = []
            for fp in fingerprints:
                db_fps.append(ProjectFingerprintModel(
                    project_id=project_id,
                    file_path=(fp.file_path or "").replace("\x00", ""),
                    hash_value=getattr(fp, 'hash_value', getattr(fp, 'hash_val', 0)),
                    line_number=getattr(fp, 'line_number', getattr(fp, 'line_no', 0)),
                ))
            self.db.bulk_save_objects(db_fps)
        self.db.commit()

    def get_existing_reports(self, course_id: int) -> List[Any]:
        return self.db.query(SimilarityReportModel).filter(SimilarityReportModel.course_id == course_id).all()

    def clear_course_reports(self, course_id: int) -> None:
        self.db.query(SimilarityReportModel).filter(SimilarityReportModel.course_id == course_id).delete(synchronize_session=False)
        self.db.commit()

    def save_similarity_reports(self, course_id: int, reports: List[dict]) -> List[Any]:
        existing_reports = self.db.query(SimilarityReportModel).filter(
            SimilarityReportModel.course_id == course_id
        ).all()
        status_map = {
            (r.project_a_id, r.project_b_id): getattr(r, "status", "Needs Review")
            for r in existing_reports
            if getattr(r, "status", None)
        }
        self.db.query(SimilarityReportModel).filter(
            SimilarityReportModel.course_id == course_id
        ).delete(synchronize_session=False)

        created_reports = []
        for rep in reports:
            pair_key = (rep["project_a_id"], rep["project_b_id"])
            rev_pair_key = (rep["project_b_id"], rep["project_a_id"])
            saved_status = status_map.get(pair_key, status_map.get(rev_pair_key))
            status = saved_status or rep.get("status", "Needs Review")
            matched_blocks_json = json.dumps(rep.get("matched_blocks", [])).replace("\x00", "")

            obj = SimilarityReportModel(
                course_id=course_id,
                project_a_id=rep["project_a_id"],
                project_b_id=rep["project_b_id"],
                similarity_score=rep.get("similarity_score", 0.0),
                matched_hashes_count=rep.get("matched_hashes_count", 0),
                matched_blocks_json=matched_blocks_json,
                status=status,
            )
            self.db.add(obj)
            self.db.flush()
            rep["id"] = obj.id
            rep["status"] = status
            created_reports.append(obj)
        self.db.commit()
        return created_reports

    def get_course_reports(self, course_id: int, min_similarity: Optional[float] = None) -> List[Any]:
        q = self.db.query(SimilarityReportModel).filter(SimilarityReportModel.course_id == course_id)
        if min_similarity is not None:
            q = q.filter(SimilarityReportModel.similarity_score >= min_similarity)
        return q.order_by(SimilarityReportModel.similarity_score.desc()).all()

    def update_comparison_coverage(self, course_id: int, projects: List[Any], reports: List[Any]) -> None:
        total_projects = len(projects)
        required_per_proj = max(0, total_projects - 1)
        completed_pairs = set()
        for r in reports:
            p_a = getattr(r, "project_a_id", None)
            p_b = getattr(r, "project_b_id", None)
            if p_a is not None and p_b is not None:
                completed_pairs.add((min(p_a, p_b), max(p_a, p_b)))

        for p in projects:
            comp_count = sum(
                1 for other in projects
                if other.id != p.id and (min(p.id, other.id), max(p.id, other.id)) in completed_pairs
            )
            status_str = "completed" if comp_count >= required_per_proj else ("in_progress" if comp_count > 0 else "pending")
            cov = self.db.query(ComparisonCoverageModel).filter(ComparisonCoverageModel.project_id == p.id).first()
            if not cov:
                cov = ComparisonCoverageModel(
                    course_id=course_id,
                    project_id=p.id,
                    total_required_comparisons=required_per_proj,
                    completed_comparisons=comp_count,
                    status=status_str,
                )
                self.db.add(cov)
            else:
                cov.total_required_comparisons = required_per_proj
                cov.completed_comparisons = comp_count
                cov.status = status_str
        self.db.commit()

    def get_comparison_coverage(self, course_id: int) -> List[dict]:
        projects = self.get_course_projects(course_id)
        proj_map = {p.id: p.name for p in projects}
        coverage_rows = self.db.query(ComparisonCoverageModel).filter(ComparisonCoverageModel.course_id == course_id).all()
        output_rows = []
        for r in coverage_rows:
            output_rows.append({
                "project_id": r.project_id,
                "project_name": proj_map.get(r.project_id, f"Project #{r.project_id}"),
                "total_required": r.total_required_comparisons,
                "completed": r.completed_comparisons,
                "status": r.status,
                "last_updated": r.last_updated.isoformat() if r.last_updated else None,
            })
        return output_rows

    def get_project_plagiarism_detail(self, project_id: int) -> dict:
        project = self.db.query(ProjectModel).filter(ProjectModel.id == project_id).first()
        if not project or not project.course_id:
            return {
                "scanned": False,
                "has_findings": False,
                "max_similarity_score": 0.0,
                "total_matches": 0,
                "matches": [],
                "cluster": None,
            }
        from src.use_cases.detect_similarity import get_course_similarity_reports
        from src.domain.constants import RESOLVED_PLAGIARISM_STATUSES
        course_data = get_course_similarity_reports(self, project.course_id)
        all_reports = course_data.get("reports", [])
        clusters = course_data.get("clusters", [])

        project_reports = [
            r for r in all_reports
            if r.get("project_a_id") == project_id or r.get("project_b_id") == project_id
        ]
        scanned = len(project_reports) > 0
        matches = []
        for r in project_reports:
            status = (r.get("status") or "").strip()
            if status.lower() in RESOLVED_PLAGIARISM_STATUSES:
                continue

            is_a = (r.get("project_a_id") == project_id)
            partner_name = r.get("project_b_name") if is_a else r.get("project_a_name")
            top_files = []
            for b in (r.get("matched_blocks") or [])[:5]:
                this_file = b.get("file_a") if is_a else b.get("file_b")
                partner_file = b.get("file_b") if is_a else b.get("file_a")
                this_start = b.get("line_a") if is_a else b.get("line_b")
                this_end = b.get("end_line_a") if is_a else b.get("end_line_b")
                partner_start = b.get("line_b") if is_a else b.get("line_a")
                partner_end = b.get("end_line_b") if is_a else b.get("end_line_a")
                top_files.append({
                    "this_file": this_file or "?",
                    "this_lines": f"{this_start}-{this_end}" if this_start is not None else "",
                    "partner_file": partner_file or "?",
                    "partner_lines": f"{partner_start}-{partner_end}" if partner_start is not None else "",
                    "token_span": b.get("token_span", 0),
                    "ident_overlap": b.get("ident_overlap", 100.0),
                })

            matches.append({
                "partner_project_name": partner_name or "Unknown Project",
                "similarity_score": r.get("file_match_percentage", r.get("similarity_score", 0)),
                "identifier_overlap_percentage": r.get("identifier_overlap_percentage", 100.0),
                "confidence_level": r.get("confidence_level", "MEDIUM"),
                "status": status or "Needs Review",
                "matched_blocks_count": r.get("matched_hashes_count", 0),
                "total_match_runs": r.get("total_match_runs", len(r.get("matched_blocks", []))),
                "max_contiguous_run_tokens": r.get("max_contiguous_run_tokens", 0),
                "top_files": top_files,
            })

        matches.sort(key=lambda m: m["similarity_score"], reverse=True)
        has_findings = len(matches) > 0
        max_score = round(max((m["similarity_score"] for m in matches), default=0.0), 1)

        cluster_info = None
        if has_findings:
            for c in clusters:
                if project_id in (c.get("project_ids") or []):
                    members = c.get("projects", [])
                    is_origin = any(m.get("id") == project_id and m.get("is_probable_origin") for m in members)
                    cluster_info = {
                        "member_count": c.get("member_count", len(members)),
                        "avg_similarity_score": c.get("avg_similarity_score", 0.0),
                        "is_probable_origin": is_origin,
                    }
                    break

        return {
            "scanned": scanned,
            "has_findings": has_findings,
            "max_similarity_score": max_score,
            "total_matches": len(matches),
            "matches": matches,
            "cluster": cluster_info,
        }

