from typing import List, Optional
from sqlalchemy.orm import Session, selectinload, joinedload, defer
from src.domain.entities import ProjectEntity, AuthorEntity, CommitEntity, FileChangeEntity, BranchEntity, CourseEntity
from src.use_cases.interfaces import IProjectRepository, IAuthorRepository, ICommitRepository, IDatabaseService, ICourseRepository
from src.infrastructure.database.models import ProjectModel, AuthorModel, CommitModel, FileChangeModel, BranchModel, CourseModel, Base
from src.infrastructure.database.session import engine

class ProjectRepository(IProjectRepository):
    def __init__(self, db: Session):
        self.db = db

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
            created_at=project_model.created_at,
            course_id=project_model.course_id
        )

    def create(self, name: str, description: Optional[str], git_url: str, course_id: int) -> ProjectEntity:
        # Initial saved path is empty, updated via update_local_path once ID is flushed/committed
        project_model = ProjectModel(
            name=name,
            description=description,
            git_url=git_url,
            local_saved_path="",
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
            created_at=project_model.created_at,
            course_id=project_model.course_id
        )

    def update_local_path(self, project_id: int, local_path: str) -> None:
        project_model = self.db.query(ProjectModel).filter(ProjectModel.id == project_id).first()
        if project_model:
            project_model.local_saved_path = local_path
            self.db.commit()

    def delete(self, project_id: int) -> bool:
        project_model = self.db.query(ProjectModel).filter(ProjectModel.id == project_id).first()
        if not project_model:
            return False
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
                description=m.description,
                created_at=m.created_at,
                course_id=m.course_id
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
                description=m.description,
                created_at=m.created_at,
                course_id=m.course_id
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
        if author_model.canonical_author_id is not None:
            root_id = author_model.canonical_author_id
            # Resolve root to prevent infinite loop just in case
            visited = {author_id}
            while root_id is not None and root_id not in visited:
                visited.add(root_id)
                parent = self.db.query(AuthorModel).filter(AuthorModel.id == root_id).first()
                if not parent:
                    break
                if parent.canonical_author_id is None:
                    return self.get_full_profile(parent.id, project_id=project_id)
                root_id = parent.canonical_author_id

        # 3. Retrieve all alias IDs pointing to this canonical author
        alias_ids = [alias.id for alias in author_model.aliases]
        author_ids = [author_id] + alias_ids

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
            root = m
            visited = {m.id}
            while root.canonical_author_id is not None and root.canonical_author_id not in visited:
                visited.add(root.canonical_author_id)
                parent = self.db.query(AuthorModel).filter(AuthorModel.id == root.canonical_author_id).first()
                if not parent:
                    break
                root = parent
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
            root = m
            visited = {m.id}
            while root.canonical_author_id is not None and root.canonical_author_id not in visited:
                visited.add(root.canonical_author_id)
                parent = self.db.query(AuthorModel).filter(AuthorModel.id == root.canonical_author_id).first()
                if not parent:
                    break
                root = parent
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
            root = author
            visited = {author.id}
            while root.canonical_author_id is not None and root.canonical_author_id not in visited:
                visited.add(root.canonical_author_id)
                parent = self.db.query(AuthorModel).filter(AuthorModel.id == root.canonical_author_id).first()
                if not parent:
                    break
                root = parent
            
            alias_ids = [alias.id for alias in root.aliases]
            author_ids = [root.id] + alias_ids
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
            .options(selectinload(CommitModel.branches))
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
                root = author
                visited = {author.id}
                while root.canonical_author_id is not None and root.canonical_author_id not in visited:
                    visited.add(root.canonical_author_id)
                    parent = self.db.query(AuthorModel).filter(AuthorModel.id == root.canonical_author_id).first()
                    if not parent:
                        break
                    root = parent
                
                alias_ids = [alias.id for alias in root.aliases]
                author_ids = [root.id] + alias_ids
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

    def reset_database(self) -> None:
        from sqlalchemy import text
        from src.infrastructure.database.session import SessionLocal

        session = self.db or SessionLocal()
        try:
            # Delete/truncate data one by one in correct dependency order (leaves schema intact, resets PK sequences)
            session.execute(text("TRUNCATE TABLE file_changes RESTART IDENTITY CASCADE;"))
            session.execute(text("TRUNCATE TABLE commit_branches CASCADE;"))
            session.execute(text("TRUNCATE TABLE commits RESTART IDENTITY CASCADE;"))
            session.execute(text("TRUNCATE TABLE branches RESTART IDENTITY CASCADE;"))
            session.execute(text("TRUNCATE TABLE projects RESTART IDENTITY CASCADE;"))
            session.execute(text("TRUNCATE TABLE authors RESTART IDENTITY CASCADE;"))
            session.execute(text("TRUNCATE TABLE courses RESTART IDENTITY CASCADE;"))
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

    def create(self, name: str, description: Optional[str]) -> CourseEntity:
        course_model = CourseModel(name=name, description=description)
        self.db.add(course_model)
        self.db.commit()
        self.db.refresh(course_model)
        return CourseEntity(
            id=course_model.id,
            name=course_model.name,
            description=course_model.description,
            created_at=course_model.created_at
        )

    def get_by_id(self, course_id: int) -> Optional[CourseEntity]:
        course_model = self.db.query(CourseModel).filter(CourseModel.id == course_id).first()
        if not course_model:
            return None
        return CourseEntity(
            id=course_model.id,
            name=course_model.name,
            description=course_model.description,
            created_at=course_model.created_at
        )

    def get_all(self) -> List[CourseEntity]:
        course_models = self.db.query(CourseModel).all()
        return [
            CourseEntity(
                id=m.id,
                name=m.name,
                description=m.description,
                created_at=m.created_at
            )
            for m in course_models
        ]

    def delete(self, course_id: int) -> bool:
        course_model = self.db.query(CourseModel).filter(CourseModel.id == course_id).first()
        if not course_model:
            return False
        self.db.delete(course_model)
        self.db.commit()
        return True

    def get_projects(self, course_id: int) -> List[ProjectEntity]:
        project_models = self.db.query(ProjectModel).filter(ProjectModel.course_id == course_id).all()
        return [
            ProjectEntity(
                id=m.id,
                name=m.name,
                git_url=m.git_url,
                local_saved_path=m.local_saved_path,
                description=m.description,
                created_at=m.created_at,
                course_id=m.course_id
            )
            for m in project_models
        ]
