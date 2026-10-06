import json
import os
import concurrent.futures
import logging
from datetime import timedelta
from typing import Dict, Any, List, Optional
from collections import defaultdict
from src.use_cases.interfaces import IProjectRepository, IAuthorRepository, ICommitRepository, ILocalAIService, IRepoInspector
from src.use_cases.commit_sampler import build_stratified_sample, compute_sampling_stats
from src.use_cases.author_utils import build_canonical_map
from src.domain.metrics import calculate_gini, get_gini_status
from src.domain.identity_signals import analyze_identity_signals, is_bot_identity
from src.domain.contribution_quality import assess_contribution_quality

logger = logging.getLogger(__name__)


# Module-level thread pool executor for local AI tasks (long-lived)
_LOCAL_AI_EXECUTOR = concurrent.futures.ThreadPoolExecutor(max_workers=8)

# Global in-memory cache for local AI commit classifications to avoid redundant LLM invocations
# WARNING: The following mutable globals (CLASSIFICATION_CACHE, CANCELLED_PROJECT_IDS,
# and RUNNING_PROJECTS) are in-memory state and require a single-worker deployment
# (e.g. uvicorn --workers 1) to function correctly. Do not run under multiple uvicorn
# workers without migrating this state to Redis or the Database.
CLASSIFICATION_CACHE = {}
CANCELLED_PROJECT_IDS = set()

# Global tracker: project_id -> { status, progress, message }
# status: 'running' | 'complete' | 'cancelled' | 'idle'
RUNNING_PROJECTS: Dict[int, Dict] = {}

# Bounded state setters to prevent memory leaks in long-running sessions
def _add_cancelled_project(project_id: int):
    CANCELLED_PROJECT_IDS.add(project_id)
    if len(CANCELLED_PROJECT_IDS) > 1000:
        # Evict oldest element
        CANCELLED_PROJECT_IDS.remove(next(iter(CANCELLED_PROJECT_IDS)))

def update_running_project(project_id: int, status: str = None, progress: int = None, message: str = None, new_state: dict = None):
    if new_state is not None:
        RUNNING_PROJECTS[project_id] = new_state
    else:
        if project_id not in RUNNING_PROJECTS:
            RUNNING_PROJECTS[project_id] = {"status": "idle", "progress": 0, "message": ""}
        if status is not None:
            RUNNING_PROJECTS[project_id]["status"] = status
        if progress is not None:
            RUNNING_PROJECTS[project_id]["progress"] = progress
        if message is not None:
            RUNNING_PROJECTS[project_id]["message"] = message
            
    # Prune running projects if size exceeds 500
    if len(RUNNING_PROJECTS) > 500:
        for pid in list(RUNNING_PROJECTS.keys()):
            if RUNNING_PROJECTS[pid].get("status") not in ("running", "cancelling"):
                RUNNING_PROJECTS.pop(pid)
                if len(RUNNING_PROJECTS) <= 500:
                    break


def get_project_analysis_status(project_id: int) -> Dict:
    return RUNNING_PROJECTS.get(project_id, {"status": "idle", "progress": 0, "message": ""})

def cancel_qualitative_analysis(project_id: int):
    _add_cancelled_project(project_id)
    if project_id in RUNNING_PROJECTS:
        update_running_project(project_id, status="cancelling")

def extract_extended_quantitative_metrics(project_repo, project_id: int, project=None, commits=None) -> dict:
    """Extract extended quantitative metrics: branches, similarity reports, AST complexity, timeline peak."""
    if project_repo is not None and hasattr(project_repo, "get_extended_quantitative_metrics"):
        return project_repo.get_extended_quantitative_metrics(project_id, commits)
    return {
        "branches_summary": {"total_branches": 0, "top_branches": []},
        "plagiarism_summary": {"has_scan": False, "max_similarity_score": 0.0, "matched_project_name": None, "status": "No Scan Performed", "matched_blocks_count": 0},
        "ast_complexity_summary": {"avg_complexity_score": 0.0, "total_functions": 0, "squash_suspected_commits": 0},
        "pacing_summary": {"peak_commit_date": "N/A", "peak_commit_count": 0, "avg_commits_per_active_day": 0.0, "project_span_days": 0, "active_days_count": 0}
    }

class GetQualitativeAnalysisUseCase:
    def __init__(
        self,
        project_repo: IProjectRepository,
        author_repo: IAuthorRepository,
        commit_repo: ICommitRepository,
        local_ai: ILocalAIService,
        repo_inspector: IRepoInspector,
    ):
        self.project_repo = project_repo
        self.author_repo = author_repo
        self.commit_repo = commit_repo
        self.local_ai = local_ai
        self.repo_inspector = repo_inspector

    def execute_stream(
        self,
        project_id: int,
        mode: str = "sample",
        sample_pct: float = 0.20,
        force_refresh: bool = False
    ):
        """
        Stream qualitative analysis events for a project.

        Args:
            project_id:     Target project ID.
            mode:           Sampling mode — "full" | "sample" | "random".
            sample_pct:     Fraction of each contributor's remaining commits to include (0-1).
            force_refresh:  Bypass DB cache and re-analyze.
        """
        logger.info("[QUAL] ===== execute_stream START  project_id=%s  mode=%s  force_refresh=%s =====", project_id, mode, force_refresh)

        if project_id in CANCELLED_PROJECT_IDS:
            CANCELLED_PROJECT_IDS.discard(project_id)

        # Mark as running
        update_running_project(project_id, new_state={"status": "running", "progress": 0, "message": "Starting analysis..."})

        logger.info("[QUAL] Fetching project %s from DB...", project_id)
        project = self.project_repo.get_by_id(project_id)
        if not project:
            logger.error("[QUAL] Project %s NOT FOUND in DB — aborting.", project_id)
            RUNNING_PROJECTS.pop(project_id, None)
            yield {"type": "error", "message": f"Project with ID {project_id} not found."}
            return
        logger.info("[QUAL] Project found: id=%s name=%r", project.id, getattr(project, 'name', '?'))

        # Resolve course deadline. NOTE: project is a ProjectEntity (from
        # get_by_id), which exposes only `course_id` — it has no `course`
        # relationship. Load the course row via the repo's DB session instead.
        deadline: Optional[object] = None
        try:
            deadline = self.project_repo.get_course_deadline(project_id)
        except Exception as deadline_err:
            logger.warning(f"Course deadline resolution failed: {deadline_err}")

        # Check the DB cache first (unless force_refresh). `project` is a
        # ProjectEntity, which does NOT carry the qualitative_report column —
        # read it back through the repository instead of off the entity.
        cached_report_json = None
        if not force_refresh and hasattr(self.project_repo, 'get_qualitative_report'):
            try:
                cached_report_json = self.project_repo.get_qualitative_report(project_id)
            except SQLAlchemyError as cache_read_err:
                logger.warning("[QUAL] Error reading DB qualitative_report cache: %s", cache_read_err)

        if cached_report_json:
            logger.info("[QUAL] DB cache hit for project %s — skipping local AI analysis.", project_id)
            try:
                cached_data = json.loads(cached_report_json)
                ps = cached_data.setdefault("project_summary", {})
                if "identity_analysis" not in ps:
                    try:
                        raw_authors = self.author_repo.get_by_project_id(project_id)
                        raw_commits = self.commit_repo.get_by_project_id(project_id)
                        c_map = build_canonical_map(self.author_repo, raw_authors)
                        a_payload = [{"id": a.id, "name": a.name, "email": a.email, "name_variants": getattr(a, "name_variants", None), "canonical_author_id": a.canonical_author_id} for a in raw_authors]
                        c_payload = [{"author_id": c.author_id, "committer_email": getattr(c, "committer_email", None), "committer_name": getattr(c, "committer_name", None)} for c in raw_commits]
                        ia = analyze_identity_signals(a_payload, c_payload, c_map)
                        ps["identity_analysis"] = ia
                        ps["is_solo_project"] = ia["is_solo_project"]
                        if ia["is_solo_project"]:
                            ps["gini_coefficient"] = "N/A (Single Contributor)"
                    except Exception as backfill_err:
                        logger.warning("[QUAL] Error backfilling identity_analysis on cached report: %s", backfill_err)

                update_running_project(project_id, new_state={"status": "complete", "progress": 100, "message": "Loaded from database cache."})
                yield {"type": "complete", "progress": 100, "message": "Loaded cached analysis from database.", "data": cached_data}
                return
            except json.JSONDecodeError as cache_err:
                logger.warning("[QUAL] Corrupt DB qualitative_report cache — re-analyzing: %s", cache_err)
        else:
            logger.info("[QUAL] No DB cache (force_refresh=%s) — running fresh analysis.", force_refresh)

        if force_refresh:
            update_running_project(project_id, new_state={"status": "running", "progress": 2, "message": "Re-analyzing project..."})

        update_running_project(project_id, progress=3, message="Fetching authors and commits...")
        yield {"type": "progress", "progress": 3, "message": "Fetching authors and commits..."}
        authors = self.author_repo.get_by_project_id(project_id)
        commits = self.commit_repo.get_by_project_id(project_id)
        logger.info("[QUAL] Fetched %d authors, %d commits for project %s.", len(authors) if authors else 0, len(commits) if commits else 0, project_id)

        if not commits:
            logger.warning("[QUAL] No commits found for project %s — yielding empty complete.", project_id)
            yield {"type": "complete", "progress": 100, "message": "No commits found.", "data": {
                "project_summary": {},
                "contributors": {}
            }}
            return

        # ── Stratified Sampling with Canonical Author Consolidation ──────────
        # Resolve each author_id to its canonical root id
        canonical_id_map = build_canonical_map(self.author_repo, authors)

        # Build author map using canonical authors
        author_map = {}
        for a in authors:
            canonical_id = canonical_id_map.get(a.id, a.id)
            if canonical_id not in author_map or a.id == canonical_id:
                author_map[canonical_id] = self.author_repo.get_by_id(canonical_id) or a

        commits_by_author: Dict = defaultdict(list)
        for c in commits:
            canonical_aid = canonical_id_map.get(c.author_id, c.author_id)
            commits_by_author[canonical_aid].append(c)

        update_running_project(project_id, message=f"Building {mode} sample...")
        yield {"type": "progress", "progress": 5, "message": f"Building {mode} sample..."}

        logger.info("[QUAL] Building stratified sample — mode=%s sample_pct=%s total_commits=%d", mode, sample_pct, len(commits))
        commits_to_process = build_stratified_sample(
            commits=commits,
            commits_by_author=dict(commits_by_author),
            deadline=deadline,
            mode=mode,
            sample_pct=sample_pct,
        )

        sampling_stats = compute_sampling_stats(
            all_commits=commits,
            selected_commits=commits_to_process,
            deadline=deadline,
            mode=mode,
            sample_pct=sample_pct,
        )

        total_process = len(commits_to_process)
        logger.info("[QUAL] Sample ready: %d commits selected from %d total.", total_process, len(commits))
        yield {
            "type": "progress",
            "progress": 7,
            "message": f"Selected {total_process} commits to analyze ({mode} mode)."
        }

        # Store results here: canonical_author_id -> list of processed commit data
        processed_commits: Dict = defaultdict(list)
        total_parse_failures = 0
        total_fallbacks = 0
        reliability_degraded = False
        reliability_warning = None

        # ── Per-Commit LLM Classification ─────────────────────────────────────
        for idx, c in enumerate(commits_to_process):
            if project_id in CANCELLED_PROJECT_IDS:
                CANCELLED_PROJECT_IDS.discard(project_id)
                update_running_project(project_id, new_state={"status": "cancelled", "progress": 0, "message": "Analysis cancelled by user."})
                yield {"type": "cancelled", "message": "Analysis cancelled by user."}
                return

            pct = 8 + int(82 * ((idx + 1) / total_process))
            msg = c.message or ""  # guard: existing DB rows may have NULL message
            msg_snippet = msg[:35].replace('\n', ' ') + ("..." if len(msg) > 35 else "")
            canonical_aid = canonical_id_map.get(c.author_id, c.author_id)
            author_name = author_map[canonical_aid].name if canonical_aid in author_map else "Unknown"
            update_running_project(project_id, progress=pct, message=f"[{idx+1}/{total_process}] Labeling commit by {author_name}")

            # Emit heartbeat BEFORE waiting on the LLM so the SSE stream stays alive
            # (the model cold-start can take 30-60s on first call; without this the
            # frontend shows 0% forever until the executor returns)
            yield {
                "type": "progress",
                "progress": pct,
                "message": f"Labeling [{author_name}] commit ({idx+1}/{total_process}): '{msg_snippet}'"
            }

            combined_diff = ""
            if hasattr(c, 'file_changes') and c.file_changes:
                for fc in c.file_changes[:2]:  # max 2 files for speed
                    if fc.raw_diff:
                        combined_diff += f"--- {fc.filename}\n{fc.raw_diff[:300]}\n"  # 300 chars per file

            # Compute deadline-aware timing metadata
            hours_before_deadline = None
            timing_flag = "normal"
            is_after_deadline = False
            if deadline and c.timestamp:
                try:
                    delta = (deadline - c.timestamp).total_seconds() / 3600
                    if delta < 0:
                        timing_flag = "after_deadline"
                        is_after_deadline = True
                        hours_before_deadline = round(-delta, 1)
                    elif delta <= 48:
                        timing_flag = "before_deadline_close"
                        hours_before_deadline = round(delta, 1)
                except (TypeError, ValueError) as timing_err:
                    logger.warning(f"Timing calculation failed for commit {c.hash}: {timing_err}")

            # Check cache first
            cache_key = c.hash
            if cache_key in CLASSIFICATION_CACHE:
                labels = CLASSIFICATION_CACHE[cache_key]
            else:
                # Truncate message to first 250 words for analyze process
                commit_msg_to_analyze = msg  # already coerced above
                words = commit_msg_to_analyze.split()
                if len(words) > 250:
                    commit_msg_to_analyze = " ".join(words[:250])

                # First commit triggers a cold model load in Ollama (30-60s on
                # CPU) — give it a long timeout. Warm calls measured ~15-20s for a
                # single attempt, and classify_commit may make a second (retry)
                # attempt on invalid JSON, so allow ~45s before falling back.
                call_timeout = 120.0 if idx == 0 else 45.0

                logger.info("[QUAL] Submitting commit %s (idx=%d) to Ollama  timeout=%.0fs  msg=%r",
                            c.hash[:8], idx, call_timeout, msg_snippet)
                try:
                    future = _LOCAL_AI_EXECUTOR.submit(
                        self.local_ai.classify_commit,
                        commit_message=commit_msg_to_analyze,
                        code_diff=combined_diff or "No diff body available.",
                        lines_added=getattr(c, 'insertions', 0) or 0,
                        lines_removed=getattr(c, 'deletions', 0) or 0,
                        timing_flag=timing_flag,
                        hours_before_deadline=hours_before_deadline,
                    )
                    labels = future.result(timeout=call_timeout)
                    logger.debug("[QUAL] Ollama returned for commit %s: type=%r substance=%r analysis_available=%s",
                                 c.hash[:8], labels.get('type'), labels.get('substance'), labels.get('analysis_available'))
                except concurrent.futures.TimeoutError as te:
                    logger.warning("[QUAL] TIMEOUT (%.0fs) for commit %s: %s", call_timeout, c.hash[:8], te)
                    labels = {
                        "type": "other",
                        "substance": "moderate",
                        "message_quality": "descriptive",
                        "consistent": True,
                        "message_diff_consistency": "consistent",
                        "consistency_note": "Analysis timeout fallback",
                        "timing_flag": timing_flag,
                        "hours_before_deadline": hours_before_deadline,
                        "has_security_risk": False,
                        "security_risk_type": "none",
                        "code_smells": [],
                        "architecture_issues": [],
                        "notes": "Timeout fallback",
                        "parse_failure": True,
                        "fell_back": True,
                        "analysis_available": False,
                    }
                except Exception as ai_err:
                    # Last-resort boundary for unexpected thread/execution failures during commit classification
                    logger.exception(f"Local AI classification failed for commit {c.hash}: {ai_err}")
                    labels = {
                        "type": "other",
                        "substance": "moderate",
                        "message_quality": "descriptive",
                        "consistent": True,
                        "message_diff_consistency": "consistent",
                        "consistency_note": "Analysis failure fallback",
                        "timing_flag": timing_flag,
                        "hours_before_deadline": hours_before_deadline,
                        "has_security_risk": False,
                        "security_risk_type": "none",
                        "code_smells": [],
                        "architecture_issues": [],
                        "notes": "Failure fallback",
                        "parse_failure": True,
                        "fell_back": True,
                        "analysis_available": False,
                    }
                CLASSIFICATION_CACHE[cache_key] = labels
                # Bounded cache eviction (cap at 10,000 to prevent memory leaks)
                if len(CLASSIFICATION_CACHE) > 10000:
                    try:
                        CLASSIFICATION_CACHE.pop(next(iter(CLASSIFICATION_CACHE)))
                    except KeyError:
                        pass

            if labels.get("parse_failure", False):
                total_parse_failures += 1
            if labels.get("fell_back", False):
                total_fallbacks += 1

            # Inject timing context into labels (server-computed, not LLM-computed)
            labels["timing_flag"] = timing_flag
            labels["is_after_deadline"] = is_after_deadline
            if hours_before_deadline is not None:
                labels["hours_before_deadline"] = hours_before_deadline

            commit_data = {
                "hash": c.hash[:8],
                "message": c.message,
                "timestamp": c.timestamp.isoformat() if c.timestamp else None,
                "is_after_deadline": is_after_deadline,
                "timing_flag": timing_flag,
                "hours_before_deadline": hours_before_deadline,
                "lines_added": getattr(c, 'insertions', 0) or 0,
                "lines_removed": getattr(c, 'deletions', 0) or 0,
                "labels": labels
            }
            processed_commits[canonical_aid].append(commit_data)

        # Quality check: keep the analysis available in degraded mode. Reliability
        # metrics and warnings are carried into the payload/PDF so consumers do not
        # mistake deterministic fallback labels for successful local-AI analysis.
        if total_process > 0:
            parse_fail_rate = total_parse_failures / total_process
            fallback_rate = total_fallbacks / total_process
            if parse_fail_rate > 0.15 or fallback_rate > 0.15:
                reliability_degraded = True
                reliability_warning = (
                    f"Local AI analysis reliability is low. "
                    f"Parse failure rate: {parse_fail_rate:.1%}, Fallback rate: {fallback_rate:.1%}. "
                    f"This exceeds the preferred 15% threshold; fallback-based results are marked as degraded."
                )
                logger.warning("[QUAL] %s", reliability_warning)
                update_running_project(project_id, progress=91, message=reliability_warning)
                yield {
                    "type": "progress",
                    "progress": 91,
                    "message": reliability_warning,
                    "warning": True,
                }

        # ── Per-Contributor Aggregation ───────────────────────────────────────
        contributors_data = {}
        ai_degraded = reliability_degraded

        proj_type_dist = defaultdict(int)
        proj_substance_dist = {"trivial": 0, "moderate": 0, "substantial": 0}
        proj_vague_count = 0
        proj_mismatch_count = 0
        proj_security_risk_count = 0
        proj_code_smells_dist = defaultdict(int)
        proj_architecture_dist = defaultdict(int)
        proj_total_sampled = 0
        proj_total_sampled_ai = 0
        proj_late_commits = 0

        # Pacing: count substantial commits in the final 3 days before deadline
        proj_final_3d_substantial = 0

        # Calculate Gini Coefficient and run Identity Analysis
        unique_canonical_ids = set(canonical_id_map.values())
        # Only canonical identities with >=1 attributed commit are real members.
        # Zero-commit rows (authors created from committer/co-author metadata whose
        # commits are attributed to another id) must NOT inflate member counts,
        # bias the Gini coefficient, or be flagged as free-riders.
        # Automated (bot) identities are not students: exclude from member counts,
        # contribution shares, Gini, and risk scoring.
        bot_canonical_ids = {
            canonical_id_map.get(a.id, a.id)
            for a in authors
            if is_bot_identity(getattr(a, "name", None), getattr(a, "email", None))
        }
        excluded_bot_names = sorted({
            author_map[cid].name for cid in bot_canonical_ids
            if cid in author_map and author_map[cid] is not None
        })

        active_canonical_ids = {
            cid for cid in unique_canonical_ids
            if commits_by_author.get(cid) and cid not in bot_canonical_ids
        }
        contrib_commit_counts = [len(commits_by_author.get(cid, [])) for cid in active_canonical_ids]

        # ── Contributor Identity & Authenticity Signals ───────────────────────
        authors_payload = [
            {
                "id": a.id,
                "name": a.name,
                "email": a.email,
                "name_variants": getattr(a, "name_variants", None),
                "canonical_author_id": a.canonical_author_id,
                "project_id": project_id,
            }
            for a in authors
        ]
        commits_payload = [
            {
                "author_id": c.author_id,
                "committer_email": getattr(c, "committer_email", None),
                "committer_name": getattr(c, "committer_name", None),
                "hash": c.hash,
                "message": c.message,
            }
            for c in commits
        ]
        identity_analysis = analyze_identity_signals(
            authors=authors_payload,
            commits=commits_payload,
            canonical_id_map=canonical_id_map,
        )
        is_solo = identity_analysis["is_solo_project"]
        co_authors_no_commits = identity_analysis.get("co_authors_no_commits", [])

        # Pre-calculate total lines of code changed (LOC) across the project
        total_project_loc = 0
        canonical_loc_map = {}
        canonical_added_map = {}
        canonical_removed_map = {}
        for cid in active_canonical_ids:
            author_commits = commits_by_author.get(cid, [])
            author_added = sum(getattr(c, 'insertions', 0) or 0 for c in author_commits)
            author_removed = sum(getattr(c, 'deletions', 0) or 0 for c in author_commits)
            author_loc = author_added + author_removed
            canonical_loc_map[cid] = author_loc
            canonical_added_map[cid] = author_added
            canonical_removed_map[cid] = author_removed
            total_project_loc += author_loc

        if is_solo:
            gini_val = 0.0
            gini_status = "N/A (Single Contributor)"
        else:
            # Factor in non-committing co-authors as 0-lines contributors for realistic inequality assessment
            contrib_lines_added = [canonical_added_map.get(cid, 0) for cid in active_canonical_ids]
            gini_lines_added = list(contrib_lines_added) + [0] * len(co_authors_no_commits)
            gini_val = calculate_gini(gini_lines_added)
            gini_status = get_gini_status(gini_val)

        # Human commits only — bot commits must not dilute contributor shares.
        total_commits_all = sum(len(commits_by_author.get(cid, [])) for cid in active_canonical_ids)
        lowest_commit_count = min(contrib_commit_counts) if contrib_commit_counts else 0

        # ── Per-Contributor Ownership Areas (top folders touched) ─────────────
        # Derive each canonical author's most-touched top-level folders from the
        # file-change history so the report can show "who owns what". Best-effort:
        # any DB issue leaves ownership empty and never blocks the core analysis.
        ownership_by_canonical: Dict = defaultdict(lambda: defaultdict(int))
        try:
            own_rows = self.commit_repo.get_file_change_author_pairs(project_id)
            for filename, author_id_raw in own_rows:
                if not filename:
                    continue
                cid = canonical_id_map.get(author_id_raw, author_id_raw)
                norm = str(filename).replace("\\", "/").lstrip("/")
                top = norm.split("/")[0] if "/" in norm else "(root)"
                ownership_by_canonical[cid][top or "(root)"] += 1
        except Exception as own_err:
            logger.warning(f"Unexpected error during ownership aggregation: {own_err}")
            ownership_by_canonical = defaultdict(lambda: defaultdict(int))

        def _top_folders(cid, limit=4):
            counts = ownership_by_canonical.get(cid) or {}
            ranked = sorted(counts.items(), key=lambda kv: kv[1], reverse=True)
            return [name for name, _cnt in ranked[:limit]]

        # Loop through all canonical contributors (even if 0 commits processed/sampled)
        for author_id in unique_canonical_ids:
            if author_id in bot_canonical_ids:
                continue  # bots are not evaluated as contributors
            author_name = author_map[author_id].name if author_id in author_map else str(author_id)
            author_processed = processed_commits.get(author_id, [])

            type_dist = defaultdict(int)
            substance_dist = {"trivial": 0, "moderate": 0, "substantial": 0}
            vague_count = 0
            mismatch_count = 0
            sec_risk_count = 0
            author_code_smells_dist = defaultdict(int)
            author_architecture_dist = defaultdict(int)
            late_commits_count = 0
            deadline_close_count = 0
            total_sampled_ai = 0

            substantial_examples = []
            trivial_examples = []
            after_deadline_examples = []

            for pc in author_processed:
                lbls = pc["labels"]
                if lbls.get("analysis_available", True) == False:
                    ai_degraded = True
                    continue

                total_sampled_ai += 1
                proj_total_sampled_ai += 1

                c_type = lbls.get("type", "other")
                type_dist[c_type] += 1
                proj_type_dist[c_type] += 1

                sub = lbls.get("substance", "moderate")
                if sub in substance_dist:
                    substance_dist[sub] += 1
                    proj_substance_dist[sub] += 1

                if pc.get("is_after_deadline"):
                    late_commits_count += 1
                    proj_late_commits += 1
                    after_deadline_examples.append({"hash": pc["hash"], "message": pc["message"]})

                if pc.get("timing_flag") == "before_deadline_close":
                    deadline_close_count += 1

                # Pacing tracking
                if deadline and pc.get("timestamp") and sub == "substantial":
                    try:
                        ts = pc["timestamp"]
                        ts_dt = __import__("datetime").datetime.fromisoformat(ts) if isinstance(ts, str) else ts
                        if ts_dt and (deadline - ts_dt).total_seconds() <= 3 * 86400:
                            proj_final_3d_substantial += 1
                    except Exception as pacing_err:
                        logger.warning(f"Pacing timestamp parsing failed: {pacing_err}")

                example_obj = {"hash": pc["hash"], "message": pc["message"], "type": c_type, "notes": lbls.get("notes", "")}
                if sub == "substantial" and len(substantial_examples) < 3:
                    substantial_examples.append(example_obj)
                elif sub == "trivial" and len(trivial_examples) < 3:
                    trivial_examples.append(example_obj)

                if lbls.get("message_quality") == "vague":
                    vague_count += 1
                    proj_vague_count += 1

                if not lbls.get("consistent", True):
                    mismatch_count += 1
                    proj_mismatch_count += 1

                if lbls.get("has_security_risk", False):
                    sec_risk_count += 1
                    proj_security_risk_count += 1

                for sm in lbls.get("code_smells", []):
                    if sm and sm != "none":
                        author_code_smells_dist[sm] += 1
                        proj_code_smells_dist[sm] += 1

                for arch in lbls.get("architecture_issues", []):
                    if arch and arch != "none":
                        author_architecture_dist[arch] += 1
                        proj_architecture_dist[arch] += 1

            total_sampled = len(author_processed)
            proj_total_sampled += total_sampled
            total_author_commits = len(commits_by_author.get(author_id, []))

            # Contribution Shares & Pacing
            commit_share = round((total_author_commits / total_commits_all) * 100, 1) if total_commits_all > 0 else 0.0
            author_loc = canonical_loc_map.get(author_id, 0)
            loc_share = round((author_loc / total_project_loc) * 100, 1) if total_project_loc > 0 else 0.0

            num_members = len(active_canonical_ids)
            expected_avg_share = 100.0 / num_members if num_members > 0 else 100.0

            # Contribution Quality scoring + free-rider detection (pure domain logic;
            # see src/domain/contribution_quality.py). Quality flags are gated on a
            # minimum analyzed sample so a single flagged commit can't read as, e.g.,
            # "100% mismatch"; the share-based free-rider flag fires regardless.
            assessment = assess_contribution_quality(
                total_author_commits=total_author_commits,
                num_members=num_members,
                expected_avg_share=expected_avg_share,
                commit_share=commit_share,
                loc_share=loc_share,
                gini_val=gini_val,
                lowest_commit_count=lowest_commit_count,
                total_sampled_ai=total_sampled_ai,
                total_project_commits=total_commits_all,
                substantial_count=substance_dist["substantial"],
                moderate_count=substance_dist["moderate"],
                trivial_count=substance_dist["trivial"],
                vague_count=vague_count,
                mismatch_count=mismatch_count,
                sec_risk_count=sec_risk_count,
                late_commits_count=late_commits_count,
                deadline_tracked=bool(deadline),
            )

            if total_sampled > 0:
                late_pct = round((deadline_close_count / total_sampled) * 100, 0)
                timing_pattern = f"{int(late_pct)}% of sampled commits within 48h before deadline" if late_pct > 0 else "Spread across project timeline"
            else:
                timing_pattern = "No commits sampled"

            contrib_key = author_name
            if contrib_key in contributors_data:
                author_email_display = author_map[author_id].email if author_id in author_map else str(author_id)
                contrib_key = f"{author_name} ({author_email_display})"

            # PR review evaluations default to None if missing/not tracked
            # We don't have native PR review tracking, so we represent it as None / not tracked
            contributors_data[contrib_key] = {
                "author_id": author_id,
                "canonical_author_id": author_id,
                "author_name": author_name,
                "email": author_map[author_id].email if author_id in author_map else "",
                "is_solo": is_solo,
                "stats": {
                    "total_project_commits": total_author_commits,
                    "sampled_commits": total_sampled,
                    "commit_share_percentage": commit_share,
                    "loc_share_percentage": loc_share,
                    "lines_added": canonical_added_map.get(author_id, 0),
                    "lines_removed": canonical_removed_map.get(author_id, 0),
                    "lines_changed": author_loc,
                    "type_distribution": dict(type_dist),
                    "substance_distribution": substance_dist,
                    "vague_message_percentage": round((vague_count / total_sampled_ai) * 100, 1) if total_sampled_ai else 0,
                    "message_mismatch_percentage": round((mismatch_count / total_sampled_ai) * 100, 1) if total_sampled_ai else 0,
                    "security_risk_commits": sec_risk_count,
                    "code_smell_distribution": dict(author_code_smells_dist),
                    "architecture_issue_distribution": dict(author_architecture_dist),
                    "late_commits": late_commits_count if deadline else None,
                    "commits_near_deadline": deadline_close_count if deadline else None,
                    "timing_pattern": timing_pattern if deadline else "Not Tracked (No deadline configured)",
                    "ai_quality_score": assessment.quality_score if assessment.score_assessed else 0,
                    "score_unverified": assessment.score_unverified,
                    "free_rider_suspected": assessment.free_rider_suspected,
                    "meaningful_work_deductions": assessment.meaningful_work_deductions,
                    "detected_red_flags": assessment.red_flags if assessment.red_flags else ["None"],
                    "ownership_areas": _top_folders(author_id)
                },
                "examples": {
                    "substantial_commits": substantial_examples,
                    "trivial_commits": trivial_examples,
                    "after_deadline_commits": after_deadline_examples if deadline else None,
                }
            }

        # Add any co-authors who have 0 direct commits to contributors_data
        for idx, co in enumerate(co_authors_no_commits):
            co_name = co["name"]
            co_email = co["email"]
            co_key = co_name
            if co_key in contributors_data:
                co_key = f"{co_name} ({co_email})"

            contributors_data[co_key] = {
                "author_id": -(idx + 1),
                "canonical_author_id": -(idx + 1),
                "author_name": co_name,
                "email": co_email,
                "is_solo": False,
                "is_co_author_only": True,
                "stats": {
                    "total_project_commits": 0,
                    "sampled_commits": 0,
                    "commit_share_percentage": 0.0,
                    "loc_share_percentage": 0.0,
                    "lines_added": 0,
                    "lines_removed": 0,
                    "lines_changed": 0,
                    "type_distribution": {},
                    "substance_distribution": {"substantial": 0, "moderate": 0, "trivial": 0},
                    "vague_message_percentage": 0,
                    "message_mismatch_percentage": 0,
                    "security_risk_commits": 0,
                    "code_smell_distribution": {},
                    "architecture_issue_distribution": {},
                    "late_commits": 0 if deadline else None,
                    "commits_near_deadline": 0 if deadline else None,
                    "timing_pattern": "No direct commits (Co-author tagged in messages)",
                    "ai_quality_score": 0,
                    "score_unverified": True,
                    "free_rider_suspected": True,
                    "meaningful_work_deductions": 0,
                    "detected_red_flags": [
                        "Proxy committer pattern: tagged as co-author in commit messages, but authored 0 direct commits"
                    ],
                    "ownership_areas": []
                },
                "examples": {
                    "substantial_commits": [],
                    "trivial_commits": [],
                    "after_deadline_commits": None
                }
            }

        # ── Code Resurrection Check ───────────────────────────────────────────
        resurrection_flags = []
        deleted_snippets = []
        added_snippets = []

        for author_id, author_processed in processed_commits.items():
            author_name = author_map[author_id].name if author_id in author_map else str(author_id)
            for pc in author_processed:
                diff = pc.get("diff", "")
                if diff:
                    del_lines = "\n".join([line[1:] for line in diff.split("\n") if line.startswith("-") and not line.startswith("---") and len(line.strip()) > 5])
                    add_lines = "\n".join([line[1:] for line in diff.split("\n") if line.startswith("+") and not line.startswith("+++") and len(line.strip()) > 5])
                    if len(del_lines) > 50:
                        deleted_snippets.append({"author": author_name, "hash": pc["hash"], "code": del_lines[:800]})
                    if len(add_lines) > 50:
                        added_snippets.append({"author": author_name, "hash": pc["hash"], "code": add_lines[:800]})

        compare_count = 0
        for del_item in deleted_snippets:
            if compare_count >= 2:
                break
            for add_item in added_snippets:
                if del_item["author"] != add_item["author"]:
                    try:
                        future = _LOCAL_AI_EXECUTOR.submit(self.local_ai.compare_snippets, del_item["code"], add_item["code"])
                        res = future.result(timeout=2.5)
                    except concurrent.futures.TimeoutError as te:
                        logger.warning(f"Timeout comparing snippets for {del_item['hash']} and {add_item['hash']}: {te}")
                        res = {"is_duplicate_or_revert": False, "similarity_type": "independent_work", "analysis_available": False}
                    except Exception as e:
                        logger.warning(f"Error comparing snippets for {del_item['hash']} and {add_item['hash']}: {e}")
                        res = {"is_duplicate_or_revert": False, "similarity_type": "independent_work", "analysis_available": False}

                    compare_count += 1
                    if res.get("analysis_available", True) == False:
                        ai_degraded = True
                    elif res.get("is_duplicate_or_revert"):
                        resurrection_flags.append({
                            "original_author": del_item["author"],
                            "restored_author": add_item["author"],
                            "similarity_type": res.get("similarity_type"),
                            "explanation": res.get("explanation"),
                            "original_commit": del_item["hash"],
                            "restored_commit": add_item["hash"]
                        })
                    if compare_count >= 2:
                        break

        # ── Peer Review Evaluation (Optional, default to None if 0 review comments evaluated) ──────────────────
        total_review_score = 0
        review_count = 0
        constructive_count = 0
        rubber_stamp_count = 0

        for author_id, author_processed in processed_commits.items():
            for pc in author_processed[:1]:
                try:
                    future = _LOCAL_AI_EXECUTOR.submit(self.local_ai.evaluate_review_comment, pc["message"])
                    eval_res = future.result(timeout=2.5)
                except concurrent.futures.TimeoutError as te:
                    logger.warning(f"Timeout evaluating review comment for commit {pc['hash']}: {te}")
                    eval_res = {"substance": "minor_feedback", "quality_score": 5, "analysis_available": False}
                except Exception as e:
                    logger.warning(f"Error evaluating review comment for commit {pc['hash']}: {e}")
                    eval_res = {"substance": "minor_feedback", "quality_score": 5, "analysis_available": False}

                if eval_res.get("analysis_available", True) == False:
                    ai_degraded = True
                    continue

                total_review_score += eval_res.get("quality_score", 5)
                review_count += 1
                if eval_res.get("substance") == "constructive_review":
                    constructive_count += 1
                elif eval_res.get("substance") == "rubber_stamp":
                    rubber_stamp_count += 1

        avg_peer_review_score = round(total_review_score / max(1, review_count), 1)

        # ── Project-Level Aggregation ─────────────────────────────────────────
        # Pacing assessment
        proj_total_substantial = proj_substance_dist.get("substantial", 0)
        pacing_note = "even"
        if proj_total_substantial > 0:
            final_3d_pct = round((proj_final_3d_substantial / proj_total_substantial) * 100)
            if final_3d_pct >= 40:
                pacing_note = f"back-loaded — {final_3d_pct}% of substantial commits occurred in final 3 days"
            elif final_3d_pct >= 20:
                pacing_note = f"slightly back-loaded — {final_3d_pct}% of substantial commits in final 3 days"
            else:
                pacing_note = f"well-distributed — only {final_3d_pct}% of substantial commits in final 3 days"

        # Red flags
        red_flags = []
        if deadline and proj_late_commits > 0:
            red_flags.append(f"{proj_late_commits} commit(s) pushed after deadline")
        if proj_substance_dist.get("trivial", 0) > proj_total_sampled * 0.5:
            red_flags.append("Over 50% of sampled commits are trivial")
        if proj_vague_count > proj_total_sampled * 0.3:
            red_flags.append(f"{proj_vague_count} commits with vague messages ({round((proj_vague_count / max(proj_total_sampled, 1)) * 100)}%)")
        if proj_security_risk_count > 0:
            red_flags.append(f"{proj_security_risk_count} commit(s) flagged for security risk")
        if resurrection_flags:
            red_flags.append(f"{len(resurrection_flags)} potential code resurrection / ownership transfer detected")

        # Determine peer review summary (None if not tracked)
        if review_count > 0:
            peer_review_summary = {
                "average_quality_score": avg_peer_review_score,
                "evaluated_comments": review_count,
                "constructive_reviews": constructive_count,
                "rubber_stamps": rubber_stamp_count
            }
        else:
            peer_review_summary = None

        # Calculate Commit Timeline (Daily aggregated commit volume)
        commit_timeline_dict = defaultdict(int)
        for c in commits:
            if getattr(c, 'timestamp', None):
                d_str = c.timestamp.strftime("%Y-%m-%d")
                commit_timeline_dict[d_str] += 1
        sorted_commit_timeline = [{"date": d, "count": cnt} for d, cnt in sorted(commit_timeline_dict.items())]

        # Fetch Language Distribution
        lang_dist = {}
        try:
            if hasattr(self.project_repo, 'get_language_distribution'):
                lang_dist = self.project_repo.get_language_distribution(project_id) or {}
        except Exception as lang_err:
            logger.warning(f"Error fetching language distribution: {lang_err}")

        # Folder Structure & README Quality Inspection
        folder_structure = {
            "top_level_directories": [],
            "total_directories": 0,
            "total_files": 0,
            "has_tests_dir": False,
            "modularity_score": "Standard"
        }

        readme_quality = {
            "has_readme": False,
            "readme_size_kb": 0.0,
            "has_setup_guide": False,
            "has_architecture_doc": False,
            "documentation_score": "Not Found"
        }

        repo_path = getattr(project, 'local_saved_path', None)
        if repo_path and os.path.exists(repo_path) and os.path.isdir(repo_path):
            try:
                repo_info = self.repo_inspector.inspect_repository(repo_path, self.local_ai)
                folder_structure = repo_info.get("folder_structure", folder_structure)
                readme_quality = repo_info.get("readme_quality", readme_quality)
            except Exception as repo_err:
                logger.warning(f"Error inspecting repo folder structure / README: {repo_err}")

        # ── Extract Extended Quantitative Metrics (Branches, Plagiarism, AST, Peak Timeline) ──
        ext_metrics = {}
        try:
            ext_metrics = self.project_repo.get_extended_quantitative_metrics(
                project_id=project_id,
                commits=commits
            )
        except Exception as ext_err:
            logger.exception(f"Error generating extended metrics: {ext_err}")

        project_summary = {
            **sampling_stats,
            **ext_metrics,
            "total_commits": len(commits),
            "sampled_commits": proj_total_sampled,
            "commit_timeline": sorted_commit_timeline,
            "language_distribution": lang_dist,
            "folder_structure": folder_structure,
            "readme_quality": readme_quality,
            "type_distribution": dict(proj_type_dist),
            "substance_distribution": proj_substance_dist,
            "vague_message_percentage": round((proj_vague_count / proj_total_sampled_ai) * 100, 1) if proj_total_sampled_ai else 0,
            "message_mismatch_percentage": round((proj_mismatch_count / proj_total_sampled_ai) * 100, 1) if proj_total_sampled_ai else 0,
            "security_risk_commits": proj_security_risk_count,
            "code_smell_distribution": dict(proj_code_smells_dist),
            "architecture_issue_distribution": dict(proj_architecture_dist),
            "code_resurrection_flags": resurrection_flags,
            "overall_pacing": pacing_note if deadline else "Not Tracked (No deadline configured)",
            "gini_coefficient": "N/A (Single Contributor)" if is_solo else f"{gini_val} ({gini_status})",
            "red_flags": red_flags,
            "peer_review_summary": peer_review_summary,
            "substantial_to_trivial_ratio": round(proj_substance_dist["substantial"] / max(1, proj_substance_dist["trivial"]), 2) if proj_substance_dist["trivial"] > 0 or proj_substance_dist["substantial"] > 0 else None,
            "identity_analysis": identity_analysis,
            "is_solo_project": is_solo,
            "is_proxy_solo_committer": identity_analysis.get("is_proxy_solo_committer", False),
            "has_proxy_committers": len(co_authors_no_commits) > 0,
            "co_authors_only_count": len(co_authors_no_commits),
            "co_authors_no_commits": co_authors_no_commits,
            "excluded_bots": excluded_bot_names,
        }

        # Data Quality Assessment object
        classification_reliability = "high"
        if reliability_degraded:
            classification_reliability = "low"
        for sub_cat, count in proj_substance_dist.items():
            if proj_total_sampled_ai > 0 and (count / proj_total_sampled_ai) > 0.90:
                classification_reliability = "low"
                break
        for t_cat, count in proj_type_dist.items():
            if proj_total_sampled_ai > 0 and (count / proj_total_sampled_ai) > 0.90:
                classification_reliability = "low"
                break

        data_quality = {
            "classification_reliability": classification_reliability,
            "local_model": getattr(self.local_ai, 'model_name', 'qwen2.5-coder:3b'),
            "fallback_rate_type": round(total_fallbacks / max(1, total_process), 3) if total_process > 0 else 0.0,
            "fallback_rate_substance": round(total_fallbacks / max(1, total_process), 3) if total_process > 0 else 0.0,
            "parse_failure_rate": round(total_parse_failures / max(1, total_process), 3) if total_process > 0 else 0.0,
            "missing_fields": [],
            "partial_analysis_degraded": ai_degraded
        }
        if reliability_warning:
            data_quality["reliability_warning"] = reliability_warning
        if not deadline:
            data_quality["missing_fields"].append("deadline_compliance")
        if review_count == 0:
            data_quality["missing_fields"].append("peer_review_data")

        final_payload = {
            "project_id": project_id,
            "project_name": project.name,
            "project_summary": project_summary,
            "contributors": contributors_data,
            "data_quality": data_quality,
            "partial_analysis_degraded": ai_degraded
        }

        # Persist finalized report JSON into ProjectModel database column
        try:
            if hasattr(self.project_repo, 'save_qualitative_report'):
                self.project_repo.save_qualitative_report(project_id, json.dumps(final_payload))
            # A fresh qualitative pass (first-time analyze OR Re-analyze) makes any
            # cached cloud narrative stale: cloud_report was synthesized from the
            # OLD qualitative_report. Drop it here so the next report generation
            # rebuilds from this latest data instead of silently reusing the
            # outdated cloud_report in the PDF endpoint.
            if hasattr(self.project_repo, 'clear_cloud_report'):
                self.project_repo.clear_cloud_report(project_id)
        except SQLAlchemyError as db_save_err:
            logger.warning(f"Failed to persist qualitative_report to DB: {db_save_err}")

        RUNNING_PROJECTS[project_id] = {"status": "complete", "progress": 100, "message": "Analysis Complete!"}
        yield {"type": "complete", "progress": 100, "message": "Analysis Complete!", "data": final_payload}

    def execute(self, project_id: int, mode: str = "sample", sample_pct: float = 0.20) -> Dict[str, Any]:
        """Synchronous wrapper for backwards compatibility."""
        final_res = None
        for step in self.execute_stream(project_id, mode=mode, sample_pct=sample_pct):
            if step.get("type") == "complete":
                final_res = step.get("data")
        return final_res or {}
