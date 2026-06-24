from datetime import datetime
from typing import List, Optional

from sqlalchemy import Integer, String, Text, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import declarative_base, Mapped, mapped_column, relationship

Base = declarative_base()

class ProjectModel(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    git_url: Mapped[str] = mapped_column(String, nullable=False)
    local_saved_path: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    commits: Mapped[List["CommitModel"]] = relationship(
        "CommitModel", back_populates="project", cascade="all, delete-orphan", passive_deletes=True
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
    branches: Mapped[Optional[str]] = mapped_column(String, nullable=True)

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

    commit: Mapped["CommitModel"] = relationship("CommitModel", back_populates="file_changes")
