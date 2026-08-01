from datetime import datetime
from typing import List, Optional

from sqlalchemy import Integer, String, Text, Boolean, DateTime, ForeignKey, Table, Column
from sqlalchemy.orm import declarative_base, Mapped, mapped_column, relationship

Base = declarative_base()


class UserModel(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    github_username: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    is_dark_mode: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    courses: Mapped[List["CourseModel"]] = relationship(
        "CourseModel", back_populates="owner", cascade="all, delete-orphan", passive_deletes=True
    )


class CourseModel(Base):
    __tablename__ = "courses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    owner: Mapped["UserModel"] = relationship("UserModel", back_populates="courses")
    projects: Mapped[List["ProjectModel"]] = relationship(
        "ProjectModel", back_populates="course",
        cascade="all, delete-orphan", passive_deletes=True
    )


class ProjectModel(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    git_url: Mapped[str] = mapped_column(String, nullable=False)
    local_saved_path: Mapped[str] = mapped_column(String, nullable=False)
    group_no: Mapped[str] = mapped_column(String, nullable=False, server_default="G-00")
    store_local_copy: Mapped[bool] = mapped_column(Boolean, default=False)
    is_local_copy_stored: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    qualitative_report: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    course_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("courses.id", ondelete="CASCADE"), nullable=False
    )

    course: Mapped["CourseModel"] = relationship("CourseModel", back_populates="projects")
    commits: Mapped[List["CommitModel"]] = relationship(
        "CommitModel", back_populates="project", cascade="all, delete-orphan", passive_deletes=True
    )
    branches: Mapped[List["BranchModel"]] = relationship(
        "BranchModel", back_populates="project", cascade="all, delete-orphan", passive_deletes=True
    )


commit_branches = Table(
    "commit_branches",
    Base.metadata,
    Column("commit_hash", String, ForeignKey("commits.hash", ondelete="CASCADE"), primary_key=True),
    Column("branch_id", Integer, ForeignKey("branches.id", ondelete="CASCADE"), primary_key=True)
)


class BranchModel(Base):
    __tablename__ = "branches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    short_name: Mapped[str] = mapped_column(String, nullable=False)

    project: Mapped["ProjectModel"] = relationship("ProjectModel", back_populates="branches")
    commits: Mapped[List["CommitModel"]] = relationship(
        "CommitModel", secondary=commit_branches, back_populates="branches"
    )


class AuthorModel(Base):
    __tablename__ = "authors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False)

    commits: Mapped[List["CommitModel"]] = relationship("CommitModel", back_populates="author")

    canonical_author_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("authors.id", ondelete="SET NULL"), nullable=True
    )
    aliases: Mapped[List["AuthorModel"]] = relationship(
        "AuthorModel",
        back_populates="canonical_author"
    )
    canonical_author: Mapped[Optional["AuthorModel"]] = relationship(
        "AuthorModel",
        back_populates="aliases",
        remote_side="AuthorModel.id"
    )


class CommitModel(Base):
    __tablename__ = "commits"

    hash: Mapped[str] = mapped_column(String, primary_key=True)
    project_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    author_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("authors.id"), nullable=False
    )
    timestamp: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    insertions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    deletions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_squash_suspected: Mapped[bool] = mapped_column(Boolean, default=False)
    branches: Mapped[List["BranchModel"]] = relationship(
        "BranchModel", secondary=commit_branches, back_populates="commits"
    )

    project: Mapped["ProjectModel"] = relationship("ProjectModel", back_populates="commits")
    author: Mapped["AuthorModel"] = relationship("AuthorModel", back_populates="commits")
    
    file_changes: Mapped[List["FileChangeModel"]] = relationship(
        "FileChangeModel", back_populates="commit", cascade="all, delete-orphan", passive_deletes=True
    )


class FileChangeModel(Base):
    __tablename__ = "file_changes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    commit_hash: Mapped[str] = mapped_column(
        String, ForeignKey("commits.hash", ondelete="CASCADE"), nullable=False
    )
    filename: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
    lines_added: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    lines_removed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    raw_diff: Mapped[Optional[str]] = mapped_column(Text)
    blame_snapshot: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # AST Qualitative Metrics (Phase 3)
    complexity_score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    function_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    ast_fingerprint: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    commit: Mapped["CommitModel"] = relationship("CommitModel", back_populates="file_changes")
