from datetime import datetime
from typing import List, Optional

from sqlalchemy import Integer, String, Text, Boolean, DateTime, ForeignKey, Table, Column, BigInteger, Float
from sqlalchemy.orm import declarative_base, Mapped, mapped_column, relationship

Base = declarative_base()


class UserModel(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    password: Mapped[str] = mapped_column(String, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    github_username: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    is_dark_mode: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    courses: Mapped[List["CourseModel"]] = relationship(
        "CourseModel", back_populates="owner", cascade="all, delete-orphan", passive_deletes=True
    )
    api_keys: Mapped[List["UserApiKeyModel"]] = relationship(
        "UserApiKeyModel", back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )


class UserApiKeyModel(Base):
    __tablename__ = "user_api_keys"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    provider: Mapped[str] = mapped_column(String, nullable=False, default="Gemini")
    encrypted_api_key: Mapped[str] = mapped_column(Text, nullable=False)
    masked_key: Mapped[str] = mapped_column(String, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    user: Mapped["UserModel"] = relationship("UserModel", back_populates="api_keys")


class CourseModel(Base):
    __tablename__ = "courses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    # Optional free-text notes on expected languages / frameworks for this course.
    # Used as context when generating the final report.
    tech_requirements: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Optional submission deadline. Commits with a timestamp after this are
    # considered late and can be highlighted in analytics/diagrams.
    deadline: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    # Optional encrypted Gemini API key for cloud qualitative analysis.
    encrypted_api_key: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
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


class ProjectFingerprintModel(Base):
    __tablename__ = "project_fingerprints"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    hash_value: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    file_path: Mapped[str] = mapped_column(String, nullable=False)
    line_number: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    project: Mapped["ProjectModel"] = relationship("ProjectModel")


class SimilarityReportModel(Base):
    __tablename__ = "similarity_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    course_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    project_a_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    project_b_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    similarity_score: Mapped[float] = mapped_column(Float, nullable=False)
    matched_hashes_count: Mapped[int] = mapped_column(Integer, nullable=False)
    matched_blocks_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String, default="Needs Review", server_default="Needs Review")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    project_a: Mapped["ProjectModel"] = relationship("ProjectModel", foreign_keys=[project_a_id])
    project_b: Mapped["ProjectModel"] = relationship("ProjectModel", foreign_keys=[project_b_id])


class ComparisonCoverageModel(Base):
    __tablename__ = "comparison_coverage"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    course_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    project_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    total_required_comparisons: Mapped[int] = mapped_column(Integer, default=0)
    completed_comparisons: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String, default="completed")
    last_updated: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    project: Mapped["ProjectModel"] = relationship("ProjectModel")

