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
from src.domain.constants import (
    CLONE_TIMEOUT_SECONDS,
    MAX_REPO_SIZE_BYTES,
    GIT_ALLOWED_PROTOCOLS,
)
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
        logger.warning(f"Error parsing .mailmap: {e}", exc_info=True)
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
        except OSError:
            logger.debug("chmod/retry failed for %s during rmtree", p, exc_info=True)

    for attempt in range(retries):
        try:
            shutil.rmtree(path, onerror=_on_error)
            return
        except OSError:
            if attempt < retries - 1:
                time.sleep(delay)
    # Final attempt — log if it still fails so a leaked directory is observable
    try:
        shutil.rmtree(path, onerror=_on_error)
    except OSError:
        logger.warning(
            "Failed to remove directory %s after %d attempts; it may be leaked on disk",
            path, retries + 1, exc_info=True,
        )


def _dir_size(path: str) -> int:
    """Total size in bytes of all files under `path`. Missing files are skipped."""
    total = 0
    for root, _dirs, files in os.walk(path):
        for name in files:
            fp = os.path.join(root, name)
            try:
                total += os.path.getsize(fp)
            except OSError:
                # File may vanish mid-clone; ignore and keep tallying
                continue
    return total


def _summarize_git_error(stderr: str) -> str:
    """Return a compact, human-readable summary of git stderr, capped at 300 chars."""
    if not stderr:
        return "unknown git error"
    noise = (
        "updating files", "receiving objects", "resolving deltas",
        "counting objects", "compressing objects", "remote: counting",
        "remote: compressing", "remote: total", "remote: enumerating",
    )
    lines = []
    for raw in stderr.replace("\r", "\n").splitlines():
        line = raw.strip()
        if not line or any(line.lower().startswith(n) for n in noise):
            continue
        lines.append(line)
    msg = " ".join(lines[-3:]) if lines else "unknown git error"
    return msg[:300]


def _summarize_git_error(stderr: str) -> str:
    """Condense git's stderr into a short, user-safe message.

    Keeps the meaningful lines (e.g. 'error: unable to write file ...',
    'checkout failed') and drops the noisy 'Updating files: NN%' / 'Receiving
    objects' progress spam, capped at 300 chars so a multi-line clone dump can
    never flood the UI.
    """
    if not stderr:
        return "unknown git error"
    noise = (
        "updating files", "receiving objects", "resolving deltas",
        "counting objects", "compressing objects", "remote: counting",
        "remote: compressing", "remote: total", "remote: enumerating",
    )
    lines = []
    for raw in stderr.replace("\r", "\n").splitlines():
        line = raw.strip()
        if not line or any(line.lower().startswith(n) for n in noise):
            continue
        lines.append(line)
    msg = " ".join(lines[-3:]) if lines else "unknown git error"
    return msg[:300]


def _terminate_process(proc: "subprocess.Popen") -> None:
    """Best-effort kill of a still-running subprocess and reap it."""
    try:
        proc.kill()
        proc.communicate(timeout=10)
    except (OSError, subprocess.SubprocessError):
        logger.debug("Failed to terminate git clone subprocess", exc_info=True)


def _run_git_clone_bounded(
    git_url: str,
    dest: str,
    timeout: int,
    max_bytes: int,
    env: dict,
) -> None:
    """
    Clone `git_url` into `dest` with a hard wall-clock timeout and a maximum
    on-disk size. The process is killed the moment either limit is crossed, so a
    huge or hanging repository cannot exhaust the worker or the disk.

    Raises RuntimeError (mapped to HTTP 422 by the router) on any clone failure,
    timeout, or size-cap breach — the message is safe to surface to the user.
    """
    cmd = ["git", "clone", "-c", "core.longpaths=true", "--", git_url, dest]
    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=env,
        )
    except OSError as e:
        raise RuntimeError(f"Failed to start git clone for '{git_url}': {e}") from e

    limit_mb = max_bytes // (1024 * 1024)
    start = time.time()
    try:
        while True:
            retcode = proc.poll()
            if retcode is not None:
                break
            if time.time() - start > timeout:
                _terminate_process(proc)
                raise RuntimeError(
                    f"Git clone timed out after {timeout}s for '{git_url}'. "
                    f"The repository may be too large or the remote unresponsive."
                )
            if _dir_size(os.path.join(dest, ".git")) > max_bytes:
                _terminate_process(proc)
                raise RuntimeError(
                    f"Repository '{git_url}' exceeds the {limit_mb} MB download limit; clone aborted."
                )
            time.sleep(1.0)

        # Process finished on its own — drain remaining output and check status
        _stdout, stderr = proc.communicate()
        git_dir = os.path.join(dest, ".git")

        # "Clone succeeded, but checkout failed": all objects are in .git; only the
        # working-tree write failed (a locked file — antivirus, etc.). Retry checkout
        # a few times now that the clone process has exited and our poller has stopped.
        checkout_failed = (
            retcode != 0
            and os.path.isdir(git_dir)
            and "checkout failed" in (stderr or "").lower()
        )
        if checkout_failed:
            logger.warning(
                "git clone for '%s' downloaded all objects but checkout failed "
                "(likely a locked file / antivirus on Windows). Retrying checkout; "
                "history extraction proceeds regardless. Detail: %s",
                git_url, _summarize_git_error(stderr),
            )
            recovered = False
            for attempt in range(3):
                try:
                    r = subprocess.run(
                        ["git", "-C", dest, "-c", "core.longpaths=true",
                         "checkout", "-f", "HEAD"],
                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                        timeout=timeout, env=env, check=False,
                    )
                    if r.returncode == 0:
                        recovered = True
                        break
                except (subprocess.SubprocessError, OSError):
                    logger.debug("checkout retry %d failed for %s", attempt, git_url,
                                 exc_info=True)
                time.sleep(1.0)  # let a transient AV lock clear
            if not recovered:
                logger.warning(
                    "Working-tree checkout for '%s' still incomplete after retries; "
                    "history extraction will proceed from .git anyway.", git_url,
                )
            # Do NOT raise — .git is complete, extraction can continue.
        elif retcode != 0:
            raise RuntimeError(
                f"Git clone failed for '{git_url}'. "
                f"Possible causes: invalid URL, private repo without credentials, "
                f"or a network error. Details: {_summarize_git_error(stderr)}"
            )
        # A clone that completed between polls could still be over the cap
        if _dir_size(git_dir) > max_bytes:
            raise RuntimeError(
                f"Repository '{git_url}' exceeds the {limit_mb} MB download limit."
            )
    finally:
        if proc.poll() is None:
            _terminate_process(proc)


def _acquire_project_lock(lock_path: str, stale_after: int) -> None:
    """
    Take an exclusive per-project extraction lock via an atomic O_EXCL create.
    Prevents two concurrent extract/sync calls for the same project from
    clobbering each other's working tree and DB rows.

    A lock older than `stale_after` seconds is treated as orphaned (crashed run)
    and reclaimed. Raises RuntimeError if a live extraction holds the lock.
    """
    def _create() -> int:
        return os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)

    try:
        fd = _create()
    except FileExistsError:
        try:
            age = time.time() - os.path.getmtime(lock_path)
        except OSError:
            age = None
        if age is None or age <= stale_after:
            raise RuntimeError("Extraction is already in progress for this project.")
        logger.warning("Reclaiming stale extraction lock %s (age %.0fs)", lock_path, age)
        try:
            os.remove(lock_path)
            fd = _create()
        except OSError as e:
            raise RuntimeError("Extraction is already in progress for this project.") from e
    except OSError as e:
        raise RuntimeError(f"Could not acquire extraction lock: {e}") from e

    try:
        os.write(fd, str(os.getpid()).encode())
    except OSError:
        logger.debug("Failed to write pid into lock %s", lock_path, exc_info=True)
    finally:
        os.close(fd)


def _release_project_lock(lock_path: str) -> None:
    """Release the per-project extraction lock. Never raises."""
    try:
        os.remove(lock_path)
    except FileNotFoundError:
        pass
    except OSError:
        logger.debug("Failed to remove extraction lock %s", lock_path, exc_info=True)


class PyDrillerService(IGitExtractorService):
    def __init__(self, db: Session):
        self.db = db

    def extract_and_save(self, project: ProjectEntity) -> dict:
        should_store_local = getattr(project, "store_local_copy", False)
        base_dir = "saved_repos" if should_store_local else "temp_repos"
        os.makedirs(base_dir, exist_ok=True)

        # target_dir is the per-project container; the repo is cloned into a
        # deterministic "repo" subfolder so its root is always known (no guessing).
        target_dir = os.path.join(base_dir, f"project_{project.id}")
        repo_path = os.path.join(target_dir, "repo")
        lock_path = target_dir + ".lock"

        # Serialize extractions per project: a second concurrent extract/sync for
        # the same project would otherwise delete this run's tree mid-clone.
        _acquire_project_lock(lock_path, CLONE_TIMEOUT_SECONDS)

        total_commits = 0
        squash_warnings = 0
        new_authors_count = 0
        succeeded = False

        try:
            # --- Remove any stale directory from a previous failed run, and
            #     refuse to proceed if it cannot be fully cleared ---
            if os.path.exists(target_dir):
                _safe_rmtree(target_dir)
                if os.path.exists(target_dir):
                    raise RuntimeError(
                        f"Could not remove stale directory '{target_dir}'; "
                        f"refusing to clone into a dirty path."
                    )
            os.makedirs(target_dir, exist_ok=True)

            # ----------------------------------------------------------------
            # Step 1: Clone with a hard timeout + size cap. Doing the clone here
            # (rather than lazily inside PyDriller's traverse_commits) means real
            # clone failures raise a human-readable RuntimeError -> HTTP 422, and
            # the protocol allowlist is scoped to this subprocess only.
            # ----------------------------------------------------------------
            git_env = {**os.environ, "GIT_ALLOW_PROTOCOL": GIT_ALLOWED_PROTOCOLS}
            _run_git_clone_bounded(
                project.git_url,
                repo_path,
                CLONE_TIMEOUT_SECONDS,
                MAX_REPO_SIZE_BYTES,
                git_env,
            )

            # PyDriller now reads the already-cloned local repo (no re-clone).
            try:
                repo = Repository(
                    repo_path,
                    only_no_merge=True,
                    include_refs=True,
                )
            except Exception as repo_err:
                raise RuntimeError(
                    f"Failed to open the cloned repository for '{project.git_url}': {repo_err}"
                ) from repo_err

            # Load .mailmap once from the known repo root
            mailmap_data = {}
            mailmap_file = os.path.join(repo_path, ".mailmap")
            if os.path.isfile(mailmap_file):
                mailmap_data = parse_mailmap(mailmap_file)

            branch_cache = {}  # key: (project_id, branch_name) -> BranchModel

            existing_commit_hashes = set(
                h[0] for h in self.db.query(CommitModel.hash).filter(CommitModel.project_id == project.id).all()
            )

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
                msg = commit.msg or ""   # guard: PyDriller may return None for empty commit messages
                if commit.insertions > 1000:
                    is_squash = True
                elif "Co-authored-by:" in msg:
                    is_squash = True
                elif re.search(r'\(#\d+\)$', msg.split('\n')[0].strip()):
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
                    message=msg,
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
                            # AST failure never aborts commit extraction (tree-sitter raises untyped errors)
                            logger.debug("AST metrics skipped for %s", filename, exc_info=True)

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
                                ['git', '-C', repo_path, 'blame', '-e', commit.hash, '--', mod.new_path],
                                stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE,
                                text=True,
                                timeout=60,
                                check=True
                            )
                            blame_counts = {}
                            for line in (blame_res.stdout or "").split('\n'):
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
                        except (subprocess.SubprocessError, OSError, ValueError):
                            # Blame is best-effort enrichment; never abort commit extraction
                            logger.debug("git blame skipped for %s @ %s", mod.new_path, commit.hash, exc_info=True)

                    self.db.add(file_change)

                self.db.flush()

            # Update project local_saved_path & is_local_copy_stored if enabled
            if should_store_local:
                proj_model = self.db.query(ProjectModel).filter(ProjectModel.id == project.id).first()
                if proj_model:
                    proj_model.local_saved_path = os.path.abspath(repo_path)
                    proj_model.is_local_copy_stored = True

            self.db.commit()
            succeeded = True

        except Exception:
            logger.exception("Error during project extraction, rolling back transaction")
            self.db.rollback()
            raise

        finally:
            # Keep the working tree only for a stored project whose extraction
            # succeeded; otherwise remove it so a partial clone never leaks.
            if not should_store_local or not succeeded:
                if os.path.exists(target_dir):
                    _safe_rmtree(target_dir)
            _release_project_lock(lock_path)

        return {
            "status": "success",
            "total_commits": total_commits,
            "total_authors": new_authors_count,
            "squash_warnings": squash_warnings,
        }

