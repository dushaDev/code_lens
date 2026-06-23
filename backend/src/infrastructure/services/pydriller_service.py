import os
import shutil
import re
from datetime import timezone
from sqlalchemy.orm import Session
from pydriller import Repository

from src.domain.entities import ProjectEntity
from src.use_cases.interfaces import IGitExtractorService
from src.infrastructure.database.models import AuthorModel, CommitModel, FileChangeModel

class PyDrillerService(IGitExtractorService):
    def __init__(self, db: Session):
        self.db = db

    def extract_and_save(self, project: ProjectEntity) -> dict:
        local_path = project.local_saved_path
        
        # Ensure parent directory exists for cloning
        os.makedirs(os.path.dirname(local_path), exist_ok=True)
        
        total_commits = 0
        squash_warnings = 0
        new_authors_count = 0

        try:
            # Traversal uses only_no_merge=True to filter out standard merge commits
            repo = Repository(project.git_url, clone_repo_to=os.path.dirname(local_path), only_no_merge=True)
            
            for commit in repo.traverse_commits():
                # 1. Author Resolution
                author_email = commit.author.email
                author_name = commit.author.name
                
                author = self.db.query(AuthorModel).filter(AuthorModel.email == author_email).first()
                if not author:
                    author = AuthorModel(name=author_name, email=author_email)
                    self.db.add(author)
                    self.db.flush()  # To obtain author.id
                    new_authors_count += 1
                
                # 2. Squash Heuristics
                is_squash = False
                if commit.insertions > 500:
                    is_squash = True
                elif "Co-authored-by:" in commit.msg:
                    is_squash = True
                elif re.search(r'\(#\d+\)$', commit.msg.split('\n')[0].strip()):
                    is_squash = True
                
                if is_squash:
                    squash_warnings += 1

                # 3. Save Commit
                dt = commit.committer_date.astimezone(timezone.utc).replace(tzinfo=None) if commit.committer_date.tzinfo else commit.committer_date

                db_commit = CommitModel(
                    hash=commit.hash,
                    project_id=project.id,
                    author_id=author.id,
                    timestamp=dt,
                    message=commit.msg,
                    insertions=commit.insertions,
                    deletions=commit.deletions,
                    is_squash_suspected=is_squash
                )
                self.db.add(db_commit)
                total_commits += 1

                # 4. Save File Changes
                for mod in commit.modified_files:
                    file_change = FileChangeModel(
                        commit_hash=commit.hash,
                        filename=mod.new_path or mod.old_path or "unknown",
                        status=mod.change_type.name,
                        lines_added=mod.added_lines,
                        lines_removed=mod.deleted_lines,
                        raw_diff=mod.diff
                    )
                    self.db.add(file_change)
                
                self.db.flush()
                
            self.db.commit()

        except Exception as e:
            self.db.rollback()
            raise e
        finally:
            # Garbage collection: delete the cloned repo directory
            if os.path.exists(os.path.dirname(local_path)):
                shutil.rmtree(os.path.dirname(local_path), ignore_errors=True)

        return {
            "status": "success",
            "total_commits": total_commits,
            "total_authors": new_authors_count,
            "squash_warnings": squash_warnings
        }
