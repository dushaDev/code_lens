import os
import shutil
import logging
from collections import Counter
from datetime import datetime
from typing import List, Optional, Tuple, Set
from sqlalchemy.orm import Session, selectinload, joinedload, defer
from src.domain.entities import ProjectEntity, AuthorEntity, CommitEntity, FileChangeEntity, BranchEntity, CourseEntity
from src.use_cases.interfaces import IProjectRepository, IAuthorRepository, ICommitRepository, IDatabaseService, ICourseRepository
from src.infrastructure.database.models import (
    ProjectModel, AuthorModel, CommitModel, FileChangeModel, BranchModel, CourseModel, Base,
    ProjectFingerprintModel, SimilarityReportModel, ComparisonCoverageModel
)
from src.infrastructure.database.session import engine, SessionLocal
from src.domain.constants import (
    DEFAULT_GROUP, DEFAULT_SAMPLING_MODE, EXTENSION_TO_LANGUAGE,
    SAVED_REPOS_PATH_TEMPLATE, TEMP_REPOS_PATH_TEMPLATE
)

logger = logging.getLogger(__name__)

def _resolve_canonical_author(db: Session, author_model: AuthorModel) -> Tuple[AuthorModel, List[int]]:
    """
    Resolves an author to their root canonical parent, returning the root parent
    and a list of all IDs including the root and all its aliases.
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
            if ext in extension_map:
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
            name=name,
            description=description,
            git_url=git_url,
            local_saved_path="",
            group_no=group_no,
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
