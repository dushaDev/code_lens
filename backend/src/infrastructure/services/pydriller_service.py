import os
import shutil
import re
import time
import stat
from datetime import timezone
from sqlalchemy.orm import Session
from pydriller import Repository

from src.domain.entities import ProjectEntity
from src.use_cases.interfaces import IGitExtractorService
from src.infrastructure.database.models import AuthorModel, CommitModel, FileChangeModel, BranchModel
from src.infrastructure.services.ast_parser import parse_source, get_language_for_file


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
                emails = re.findall(r"<([^>]+)>", line)
                if len(emails) >= 2:
                    proper_email = emails[0].strip().lower()
                    commit_email = emails[1].strip().lower()
                    proper_name = None
                    name_match = re.match(r"^([^<]+)", line)
                    if name_match:
                        proper_name = name_match.group(1).strip()
                    mapping[commit_email] = {"email": proper_email, "name": proper_name}
    except Exception as e:
        print(f"[WARN] Error parsing .mailmap: {e}")
    return mapping


def _safe_rmtree(path: str, retries: int = 5, delay: float = 0.5) -> None:
    """
    Windows-safe recursive directory removal.
    Git marks many files read-only; we chmod them before deleting.
    Retries handle the case where antivirus/Windows Explorer holds a handle.
    """
    def _on_error(func, p, excinfo):
        try:
            os.chmod(p, stat.S_IWRITE)
            func(p)
        except Exception:
            pass  # best-effort

    for attempt in range(retries):
        try:
            shutil.rmtree(path, onerror=_on_error)
            return
        except Exception:
            if attempt < retries - 1:
                time.sleep(delay)
    # Final silent attempt
    try:
        shutil.rmtree(path, onerror=_on_error)
    except Exception:
        pass


class PyDrillerService(IGitExtractorService):
    def __init__(self, db: Session):
        self.db = db

    def extract_and_save(self, project: ProjectEntity) -> dict:
        local_path = project.local_saved_path
        temp_dir = os.path.dirname(local_path)  # e.g. temp_repos/2/

        # --- Clean up any stale directory from a previous failed run ---
        if os.path.exists(temp_dir):
            _safe_rmtree(temp_dir)

        os.makedirs(temp_dir, exist_ok=True)

        total_commits = 0
        squash_warnings = 0
        new_authors_count = 0

        try:
            # ----------------------------------------------------------------
            # Step 1: Clone — wrap separately so Git errors are human-readable
            # ----------------------------------------------------------------
            try:
                repo = Repository(
                    project.git_url,
                    clone_repo_to=temp_dir,
                    only_no_merge=True,
                    include_refs=True,
                )
            except Exception as clone_err:
                # GitCommandError.str() is often just a path — unwrap it
                err_str = str(clone_err).strip()
                # Try to get the actual stderr from GitCommandError
                stderr = getattr(clone_err, "stderr", None) or ""
                if stderr:
                    err_str = stderr.strip()
                raise RuntimeError(
                    f"Git clone failed for URL '{project.git_url}'. "
                    f"Possible causes: invalid URL, private repo without credentials, "
                    f"network timeout, or disk permission error. "
                    f"Details: {err_str}"
                ) from clone_err

            # ----------------------------------------------------------------
            # Step 2: Find the actual cloned sub-directory (don't assume name)
            # PyDriller names the clone after the repo basename, which may
            # differ from what we stored in local_saved_path.
            # ----------------------------------------------------------------
            cloned_subdirs = [
                os.path.join(temp_dir, d)
                for d in os.listdir(temp_dir)
                if os.path.isdir(os.path.join(temp_dir, d))
            ]
            if not cloned_subdirs:
                raise RuntimeError(
                    f"Clone succeeded but no directory was created inside '{temp_dir}'. "
                    f"This is unexpected — check disk space and permissions."
                )
            actual_clone_path = cloned_subdirs[0]  # always exactly one clone

            # ----------------------------------------------------------------
            # Step 3: Parse .mailmap from the actual cloned directory
            # ----------------------------------------------------------------
            mailmap_data = {}
            mailmap_file = os.path.join(actual_clone_path, ".mailmap")
            if os.path.isfile(mailmap_file):
                mailmap_data = parse_mailmap(mailmap_file)

            branch_cache = {}  # key: (project_id, branch_name) -> BranchModel

            # ----------------------------------------------------------------
            # Step 4: Traverse commits
            # ----------------------------------------------------------------
            for commit in repo.traverse_commits():
                # 1. Author Resolution
                author_email = commit.author.email
                author_name = commit.author.name

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
                    self.db.flush()
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

                # 3. Filter File Changes
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
                dt = (
                    commit.committer_date.astimezone(timezone.utc).replace(tzinfo=None)
                    if commit.committer_date.tzinfo
                    else commit.committer_date
                )

                db_commit = CommitModel(
                    hash=commit.hash,
                    project_id=project.id,
                    author_id=author.id,
                    timestamp=dt,
                    message=commit.msg,
                    insertions=kept_insertions,
                    deletions=kept_deletions,
                    is_squash_suspected=is_squash,
                )
                self.db.add(db_commit)
                total_commits += 1

                # 4b. Link branches
                if commit.branches:
                    for b_name in commit.branches:
                        cache_key = (project.id, b_name)
                        if cache_key not in branch_cache:
                            branch_model = self.db.query(BranchModel).filter(
                                BranchModel.project_id == project.id,
                                BranchModel.name == b_name
                            ).first()
                            if not branch_model:
                                short = clean_branch_short_name(b_name)
                                branch_model = BranchModel(
                                    project_id=project.id,
                                    name=b_name,
                                    short_name=short,
                                )
                                self.db.add(branch_model)
                                self.db.flush()
                            branch_cache[cache_key] = branch_model

                        db_commit.branches.append(branch_cache[cache_key])

                # 5. Save File Changes with AST metrics
                for mod in kept_files:
                    filename = mod.new_path or mod.old_path or "unknown"

                    complexity_score = None
                    function_count = None
                    ast_fingerprint = None
                    lang = get_language_for_file(filename)
                    if lang and mod.source_code:
                        try:
                            metrics = parse_source(mod.source_code, lang)
                            if metrics:
                                complexity_score = metrics.complexity_score
                                function_count = metrics.function_count
                                ast_fingerprint = metrics.ast_fingerprint
                        except Exception:
                            pass  # AST failure never aborts commit extraction

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
            # Re-raise with the original exception type preserved so callers
            # can distinguish RuntimeError (our messages) from everything else
            raise

        finally:
            # Always delete the cloned repo to keep disk clean
            if os.path.exists(temp_dir):
                _safe_rmtree(temp_dir)

        return {
            "status": "success",
            "total_commits": total_commits,
            "total_authors": new_authors_count,
            "squash_warnings": squash_warnings,
        }

