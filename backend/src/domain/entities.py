from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional

@dataclass
class FileChangeEntity:
    filename: str
    status: str
    lines_added: int
    lines_removed: int
    raw_diff: Optional[str] = None
    commit_hash: Optional[str] = None
    id: Optional[int] = None

@dataclass
class CommitEntity:
    hash: str
    project_id: int
    author_id: int
    timestamp: datetime
    message: str
    insertions: int
    deletions: int
    is_squash_suspected: bool = False
    file_changes: List[FileChangeEntity] = field(default_factory=list)

@dataclass
class AuthorEntity:
    name: str
    email: str
    id: Optional[int] = None

@dataclass
class ProjectEntity:
    name: str
    git_url: str
    local_saved_path: str
    description: Optional[str] = None
    created_at: Optional[datetime] = None
    id: Optional[int] = None
    commits: List[CommitEntity] = field(default_factory=list)
