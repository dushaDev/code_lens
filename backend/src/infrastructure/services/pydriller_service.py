import os
import shutil
import re
import time
import stat
import subprocess
import json
import logging
from datetime import timezone
from sqlalchemy.orm import Session
from pydriller import Repository

from src.domain.entities import ProjectEntity
from src.use_cases.interfaces import IGitExtractorService
from src.infrastructure.database.models import ProjectModel, AuthorModel, CommitModel, FileChangeModel, BranchModel
from src.infrastructure.services.ast_parser import parse_source, get_language_for_file

logger = logging.getLogger(__name__)


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
    except OSError as e:
        logger.warning(f"Error parsing .mailmap: {e}", exc_info=e)
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
        should_store_local = getattr(project, "store_local_copy", False)
        if should_store_local:
            target_dir = os.path.join("saved_repos", f"project_{project.id}")
        else:
            target_dir = os.path.join("temp_repos", f"project_{project.id}")

        # --- Clean up any stale directory from a previous failed run ---
        if os.path.exists(target_dir):
            _safe_rmtree(target_dir)

        os.makedirs(target_dir, exist_ok=True)

        total_commits = 0
        squash_warnings = 0
        new_authors_count = 0

        try:
            # ----------------------------------------------------------------
            # Step 1: Clone — wrap separately so Git errors are human-readable
            # ----------------------------------------------------------------
            try:
                # Constrain git transport protocols to prevent SSRF and local file access
                os.environ["GIT_ALLOW_PROTOCOL"] = "https:git"
                repo = Repository(
                    project.git_url,
                    clone_repo_to=target_dir,
                    only_no_merge=True,
                    include_refs=True,
                )
            except Exception as clone_err:
                err_str = str(clone_err).strip()
                stderr = getattr(clone_err, "stderr", None) or ""
                if stderr:
                    err_str = stderr.strip()
                raise RuntimeError(
                    f"Git clone failed for URL '{project.git_url}'. "
                    f"Possible causes: invalid URL, private repo without credentials, "
                    f"network timeout, or disk permission error. "
                    f"Details: {err_str}"
                ) from clone_err

            mailmap_data = {}
            branch_cache = {}  # key: (project_id, branch_name) -> BranchModel
            mailmap_loaded = False
            cloned_subfolder = None

            existing_commit_hashes = set(
                h[0] for h in self.db.query(CommitModel.hash).filter(CommitModel.project_id == project.id).all()
            )

            for commit in repo.traverse_commits():
                if not mailmap_loaded:
                    mailmap_loaded = True
                    for entry in os.listdir(target_dir):
                        candidate = os.path.join(target_dir, entry)
                        if os.path.isdir(candidate):
                            cloned_subfolder = candidate
                            mf = os.path.join(candidate, ".mailmap")
                            if os.path.isfile(mf):
                                mailmap_data = parse_mailmap(mf)
                            break

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

                # Check if commit already exists in DB to prevent UniqueViolation on commits_pkey during sync
                if commit.hash in existing_commit_hashes:
                    existing_commit = self.db.query(CommitModel).filter(CommitModel.hash == commit.hash).first()
                    if existing_commit and commit.branches:
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

                            if branch_cache[cache_key] not in existing_commit.branches:
                                existing_commit.branches.append(branch_cache[cache_key])
                    continue

                existing_commit_hashes.add(commit.hash)

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
                    
                    # 6. Extract Git Blame (if file exists and is not deleted)
                    if mod.change_type.name != "DELETE" and mod.new_path:
                        try:
                            blame_res = subprocess.run(
                                ['git', '-C', target_dir, 'blame', '-e', commit.hash, '--', mod.new_path],
                                stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE,
                                text=True,
                                check=True
                            )
                            blame_counts = {}
                            for line in blame_res.stdout.split('\n'):
                                if not line:
                                    continue
                                match = re.search(r'<([^>]+)>', line)
                                if match:
                                    email = match.group(1).lower().strip()
                                    if email in mailmap_data:
                                        email = mailmap_data[email]["email"]
                                    blame_counts[email] = blame_counts.get(email, 0) + 1
                                    
                            if blame_counts:
                                file_change.blame_snapshot = json.dumps(blame_counts)
                        except Exception:
                            pass

                    self.db.add(file_change)

                self.db.flush()

            # Update project local_saved_path & is_local_copy_stored if enabled
            if should_store_local:
                actual_path = cloned_subfolder or target_dir
                proj_model = self.db.query(ProjectModel).filter(ProjectModel.id == project.id).first()
                if proj_model:
                    proj_model.local_saved_path = os.path.abspath(actual_path)
                    proj_model.is_local_copy_stored = True

            self.db.commit()

        except Exception as e:
            logger.exception("Error during project extraction, rolling back transaction")
            self.db.rollback()
            raise



        finally:
            # Delete directory ONLY if store_local_copy is False
            if not should_store_local:
                if os.path.exists(target_dir):
                    _safe_rmtree(target_dir)

        return {
            "status": "success",
            "total_commits": total_commits,
            "total_authors": new_authors_count,
            "squash_warnings": squash_warnings,
        }

