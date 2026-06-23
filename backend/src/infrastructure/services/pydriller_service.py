import os
import shutil
import re
from datetime import timezone

from sqlalchemy.orm import Session
from pydriller import Repository, Commit as PyDrillerCommit
from src.domain.models import Project, Author, Commit, FileChange

class PyDrillerService:
    def __init__(self, db: Session):
        self.db = db

    def extract_and_save(self, project: Project) -> dict:
        local_path = project.local_saved_path
        
        # We will use pydriller to clone by providing the git_url and setting the clone_repo_to path
        # But wait, pydriller.Repository(url) clones to a temp dir internally if it's a remote URL.
        # However, to control the exact temp path as requested (e.g. ./temp_repos/{project_id}):
        os.makedirs(os.path.dirname(local_path), exist_ok=True)
        
        total_commits = 0
        squash_warnings = 0
        new_authors_count = 0

        try:
            # only_no_merge=True as per workflow rules
            repo = Repository(project.git_url, clone_repo_to=os.path.dirname(local_path), only_no_merge=True)
            
            for commit in repo.traverse_commits():
                # 1. Author Resolution
                author_email = commit.author.email
                author_name = commit.author.name
                
                author = self.db.query(Author).filter(Author.email == author_email).first()
                if not author:
                    author = Author(name=author_name, email=author_email)
                    self.db.add(author)
                    self.db.flush() # To get author.id
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
                # PyDriller timestamps might be timezone aware, we convert to naive UTC or keep as is.
                # SQLAlchemy DateTime expects naive if timezone=False, but it's better to ensure it's UTC
                dt = commit.committer_date.astimezone(timezone.utc).replace(tzinfo=None) if commit.committer_date.tzinfo else commit.committer_date

                db_commit = Commit(
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
                    file_change = FileChange(
                        commit_hash=commit.hash,
                        filename=mod.new_path or mod.old_path or "unknown",
                        status=mod.change_type.name,
                        lines_added=mod.added_lines,
                        lines_removed=mod.deleted_lines,
                        raw_diff=mod.diff
                    )
                    self.db.add(file_change)
                
                # Commit every X commits to avoid memory issues, or at the end. We'll do it at the end for this project scope
                # but flushing helps keep things in order.
                self.db.flush()
                
            self.db.commit()

        except Exception as e:
            self.db.rollback()
            raise e
        finally:
            # Garbage collection: delete the cloned repo
            # PyDriller might name the folder as the repo name. We need to find and delete it.
            # PyDriller docs: when clone_repo_to is provided, it clones inside that folder.
            # E.g. clone_repo_to='./temp_repos/1', it will clone into './temp_repos/1/repo_name'
            # We just delete the whole './temp_repos/1' folder.
            if os.path.exists(os.path.dirname(local_path)):
                shutil.rmtree(os.path.dirname(local_path), ignore_errors=True)

        return {
            "status": "success",
            "total_commits": total_commits,
            "total_authors": new_authors_count, # we can return new authors or count all distinct authors in this run
            "squash_warnings": squash_warnings
        }
