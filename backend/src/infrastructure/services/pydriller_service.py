import os
import shutil
import re
from datetime import timezone
from sqlalchemy.orm import Session
from pydriller import Repository

from src.domain.entities import ProjectEntity
from src.use_cases.interfaces import IGitExtractorService
from src.infrastructure.database.models import AuthorModel, CommitModel, FileChangeModel, BranchModel
from src.infrastructure.services.ast_parser import parse_python

def clean_branch_short_name(full_name: str) -> str:
    parts = [p.strip() for p in full_name.split("/") if p.strip()]
    if len(parts) >= 2:
        return "/".join(parts[-2:])
    return "/".join(parts)

# Compiled regex for ignoring build, dependency, and cache directories/files
IGNORE_RE = re.compile(
    r'(?:^|[/\\])('
    r'node_modules|dist|build|\.next|out|coverage|'
    r'__pycache__|venv|\.venv|\.pytest_cache|'
    r'\.gradle|\.cxx|target|'
    r'bin|obj|'
    r'\.idea|\.vscode|logs'
    r')(?:[/\\]|$)|'
    r'\.pyc$|'
    r'(?:^|[/\\])\.DS_Store$'
)

def is_ignored_path(path: str) -> bool:
    if not path:
        return False
    return bool(IGNORE_RE.search(path))

def parse_mailmap(file_path: str) -> dict:
    """
    Parses a git .mailmap file.
    Formats supported:
    Proper Name <proper@email.com> Commit Name <commit@email.com>
    Proper Name <proper@email.com> <commit@email.com>
    <proper@email.com> <commit@email.com>
    """
    mapping = {}
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                # Extract all <email> parts using regex
                emails = re.findall(r"<([^>]+)>", line)
                if len(emails) >= 2:
                    proper_email = emails[0].strip().lower()
                    commit_email = emails[1].strip().lower()
                    
                    # Extract name before the first '<' if present
                    proper_name = None
                    name_match = re.match(r"^([^<]+)", line)
                    if name_match:
                        proper_name = name_match.group(1).strip()
                    
                    mapping[commit_email] = {
                        "email": proper_email,
                        "name": proper_name
                    }
    except Exception as e:
        print(f"Error parsing .mailmap: {e}")
    return mapping

class PyDrillerService(IGitExtractorService):
    def __init__(self, db: Session):
        self.db = db

    def extract_and_save(self, project: ProjectEntity) -> dict:
        local_path = project.local_saved_path
        
        # Clean up any stale/incomplete repository clone directory from previous runs
        temp_dir = os.path.dirname(local_path)
        if os.path.exists(temp_dir):
            import stat
            def remove_readonly(func, path, excinfo):
                try:
                    os.chmod(path, stat.S_IWRITE)
                    func(path)
                except Exception:
                    pass
            shutil.rmtree(temp_dir, onerror=remove_readonly)

        # Ensure parent directory exists for cloning
        os.makedirs(temp_dir, exist_ok=True)
        
        total_commits = 0
        squash_warnings = 0
        new_authors_count = 0

        try:
            # Traversal uses only_no_merge=True to filter out standard merge commits
            repo = Repository(project.git_url, clone_repo_to=os.path.dirname(local_path), only_no_merge=True, include_refs=True)
            
            # Find and parse .mailmap if present in the cloned repository
            mailmap_data = {}
            branch_cache = {}  # key: (project_id, branch_name) -> BranchModel
            if os.path.exists(temp_dir):
                for item in os.listdir(temp_dir):
                    item_path = os.path.join(temp_dir, item)
                    if os.path.isdir(item_path):
                        mailmap_file = os.path.join(item_path, ".mailmap")
                        if os.path.isfile(mailmap_file):
                            mailmap_data = parse_mailmap(mailmap_file)
                            break

            for commit in repo.traverse_commits():
                # 1. Author Resolution
                author_email = commit.author.email
                author_name = commit.author.name
                
                # Apply .mailmap mapping
                email_lower = author_email.lower()
                if email_lower in mailmap_data:
                    mapped = mailmap_data[email_lower]
                    author_email = mapped["email"]
                    if mapped["name"]:
                        author_name = mapped["name"]

                author = self.db.query(AuthorModel).filter(AuthorModel.email == author_email).first()
                if not author:
                    author = AuthorModel(name=author_name, email=author_email)
                    self.db.add(author)
                    self.db.flush()  # To obtain author.id
                    new_authors_count += 1
                
                # 2. Squash Heuristics
                is_squash = False
                if commit.insertions > 1000:
                    is_squash = True
                elif "Co-authored-by:" in commit.msg:
                    is_squash = True
                elif re.search(r'\(#\d+\)$', commit.msg.split('\n')[0].strip()):
                    is_squash = True
                
                if is_squash:
                    squash_warnings += 1

                # 3. Filter File Changes and calculate kept additions/deletions
                kept_files = []
                kept_insertions = 0
                kept_deletions = 0
                
                for mod in commit.modified_files:
                    path = mod.new_path or mod.old_path or "unknown"
                    if is_ignored_path(path):
                        continue
                    kept_files.append(mod)
                    kept_insertions += mod.added_lines or 0
                    kept_deletions += mod.deleted_lines or 0

                # 4. Save Commit
                dt = commit.committer_date.astimezone(timezone.utc).replace(tzinfo=None) if commit.committer_date.tzinfo else commit.committer_date

                db_commit = CommitModel(
                    hash=commit.hash,
                    project_id=project.id,
                    author_id=author.id,
                    timestamp=dt,
                    message=commit.msg,
                    insertions=kept_insertions,
                    deletions=kept_deletions,
                    is_squash_suspected=is_squash
                )
                self.db.add(db_commit)
                total_commits += 1

                # Link branches
                if commit.branches:
                    for b_name in commit.branches:
                        cache_key = (project.id, b_name)
                        if cache_key not in branch_cache:
                            # Check database to see if branch exists
                            branch_model = self.db.query(BranchModel).filter(
                                BranchModel.project_id == project.id,
                                BranchModel.name == b_name
                            ).first()
                            if not branch_model:
                                short = clean_branch_short_name(b_name)
                                branch_model = BranchModel(
                                    project_id=project.id,
                                    name=b_name,
                                    short_name=short
                                )
                                self.db.add(branch_model)
                                self.db.flush()
                            branch_cache[cache_key] = branch_model
                        
                        db_commit.branches.append(branch_cache[cache_key])

                # 5. Save File Changes
                for mod in kept_files:
                    filename = mod.new_path or mod.old_path or "unknown"

                    # --- AST Analysis (Python files only) ---
                    complexity_score = None
                    function_count = None
                    ast_fingerprint = None
                    if filename.endswith(".py") and mod.source_code:
                        metrics = parse_python(mod.source_code)
                        if metrics:
                            complexity_score = metrics.complexity_score
                            function_count = metrics.function_count
                            ast_fingerprint = metrics.ast_fingerprint

                    file_change = FileChangeModel(
                        commit_hash=commit.hash,
                        filename=filename,
                        status=mod.change_type.name,
                        lines_added=mod.added_lines or 0,
                        lines_removed=mod.deleted_lines or 0,
                        raw_diff=mod.diff,
                        complexity_score=complexity_score,
                        function_count=function_count,
                        ast_fingerprint=ast_fingerprint,
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
                import stat
                def remove_readonly(func, path, excinfo):
                    try:
                        os.chmod(path, stat.S_IWRITE)
                        func(path)
                    except Exception:
                        pass
                shutil.rmtree(os.path.dirname(local_path), onerror=remove_readonly)

        return {
            "status": "success",
            "total_commits": total_commits,
            "total_authors": new_authors_count,
            "squash_warnings": squash_warnings
        }
