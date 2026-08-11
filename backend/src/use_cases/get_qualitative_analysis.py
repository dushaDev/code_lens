import json
import os
import concurrent.futures
import logging
from datetime import timedelta
from typing import Dict, Any, List, Optional
from collections import defaultdict
from sqlalchemy.exc import SQLAlchemyError
from src.use_cases.interfaces import IProjectRepository, IAuthorRepository, ICommitRepository
from src.use_cases.commit_sampler import build_stratified_sample, compute_sampling_stats
from src.infrastructure.services.local_ai_service import LocalAIService
from src.domain.metrics import calculate_gini, get_gini_status

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

def extract_extended_quantitative_metrics(db, project_id: int, project=None, commits=None) -> dict:
    """Extract extended quantitative metrics: branches, similarity reports, AST complexity, timeline peak."""
    from sqlalchemy import func, desc
    from src.infrastructure.database.models import (
        BranchModel, commit_branches, SimilarityReportModel,
        ProjectModel, FileChangeModel, CommitModel
    )
    
    # 1. Branches summary
    branches_summary = {"total_branches": 0, "top_branches": []}
    try:
        if db:
            results = db.query(
                BranchModel.name,
                func.count(commit_branches.c.commit_hash).label("commit_count")
            ).outerjoin(commit_branches, BranchModel.id == commit_branches.c.branch_id)\
             .filter(BranchModel.project_id == project_id)\
             .group_by(BranchModel.id, BranchModel.name)\
             .order_by(desc("commit_count")).all()
            
            total_b = len(results)
            top_b = [{"name": r[0], "commits": r[1]} for r in results[:10]]
            branches_summary = {
                "total_branches": total_b,
                "top_branches": top_b
            }
    except SQLAlchemyError as e:
        logger.warning(f"Branch extraction error: {e}")

    # 2. Plagiarism / Similarity summary
    plagiarism_summary = {
        "has_scan": False,
        "max_similarity_score": 0.0,
        "matched_project_name": None,
        "status": "No Scan Performed",
        "matched_blocks_count": 0
    }
    try:
        if db:
            reports = db.query(SimilarityReportModel).filter(
                (SimilarityReportModel.project_a_id == project_id) |
                (SimilarityReportModel.project_b_id == project_id)
            ).order_by(desc(SimilarityReportModel.similarity_score)).all()
            
            if reports:
                top_r = reports[0]
                partner_id = top_r.project_b_id if top_r.project_a_id == project_id else top_r.project_a_id
                partner_proj = db.query(ProjectModel).filter(ProjectModel.id == partner_id).first()
                partner_name = partner_proj.name if partner_proj else f"Project #{partner_id}"
                
                plagiarism_summary = {
                    "has_scan": True,
                    "max_similarity_score": round(top_r.similarity_score * 100.0, 1) if top_r.similarity_score <= 1.0 else round(top_r.similarity_score, 1),
                    "matched_project_name": partner_name,
                    "status": top_r.status or "Needs Review",
                    "matched_blocks_count": top_r.matched_hashes_count or 0
                }
    except SQLAlchemyError as e:
        logger.warning(f"Similarity extraction error: {e}")

    # 3. AST Complexity & Squash commits
    ast_complexity_summary = {
        "avg_complexity_score": 0.0,
        "total_functions": 0,
        "squash_suspected_commits": 0
    }
    try:
        if db:
            ast_res = db.query(
                func.avg(FileChangeModel.complexity_score),
                func.sum(FileChangeModel.function_count)
            ).join(CommitModel, FileChangeModel.commit_hash == CommitModel.hash)\
             .filter(CommitModel.project_id == project_id).first()
            
            squash_count = db.query(func.count(CommitModel.hash)).filter(
                CommitModel.project_id == project_id,
                CommitModel.is_squash_suspected == True
            ).scalar() or 0

            avg_comp = round(float(ast_res[0]), 1) if ast_res and ast_res[0] is not None else 0.0
            tot_func = int(ast_res[1]) if ast_res and ast_res[1] is not None else 0
            
            ast_complexity_summary = {
                "avg_complexity_score": avg_comp,
                "total_functions": tot_func,
                "squash_suspected_commits": squash_count
            }
    except SQLAlchemyError as e:
        logger.warning(f"AST complexity error: {e}")

    # 4. Pacing peak & daily velocity summary
    pacing_summary = {
        "peak_commit_date": "N/A",
        "peak_commit_count": 0,
        "avg_commits_per_active_day": 0.0,
        "project_span_days": 0,
        "active_days_count": 0
    }
    try:
        if commits:
            daily_counts = {}
            for c in commits:
                if c.timestamp:
                    d_str = c.timestamp.strftime("%Y-%m-%d")
                    daily_counts[d_str] = daily_counts.get(d_str, 0) + 1
            if daily_counts:
                peak_date = max(daily_counts, key=daily_counts.get)
                peak_val = daily_counts[peak_date]
                avg_val = round(sum(daily_counts.values()) / len(daily_counts), 1)
                
                # Calculate project span (start date to end date)
                timestamps = [c.timestamp for c in commits if c.timestamp]
                project_span_days = 0
                if timestamps:
                    start_date = min(timestamps)
                    end_date = max(timestamps)
                    project_span_days = (end_date.date() - start_date.date()).days + 1
                
                pacing_summary = {
                    "peak_commit_date": peak_date,
                    "peak_commit_count": peak_val,
                    "avg_commits_per_active_day": avg_val,
                    "project_span_days": project_span_days,
                    "active_days_count": len(daily_counts)
                }
    except Exception as e:
        # Last-resort boundary to ensure pacing calculation errors do not crash the entire quantitative metrics extraction
        logger.exception(f"Pacing summary extraction failed: {e}")

    return {
        "branches_summary": branches_summary,
        "plagiarism_summary": plagiarism_summary,
        "ast_complexity_summary": ast_complexity_summary,
        "pacing_summary": pacing_summary
    }

class GetQualitativeAnalysisUseCase:
    def __init__(
        self,
        project_repo: IProjectRepository,
        author_repo: IAuthorRepository,
        commit_repo: ICommitRepository,
        local_ai: LocalAIService = None
    ):
        self.project_repo = project_repo
        self.author_repo = author_repo
        self.commit_repo = commit_repo
        self.local_ai = local_ai or LocalAIService()

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
        if project_id in CANCELLED_PROJECT_IDS:
            CANCELLED_PROJECT_IDS.discard(project_id)

        # Mark as running
        update_running_project(project_id, new_state={"status": "running", "progress": 0, "message": "Starting analysis..."})

        project = self.project_repo.get_by_id(project_id)
        if not project:
            RUNNING_PROJECTS.pop(project_id, None)
            yield {"type": "error", "message": f"Project with ID {project_id} not found."}
            return

        # Resolve course deadline from relationship
        deadline: Optional[object] = None
        try:
            if project.course and project.course.deadline:
                deadline = project.course.deadline
        except SQLAlchemyError as deadline_err:
            logger.warning(f"Course deadline resolution failed: {deadline_err}")

        # Check DB cache first unless force_refresh is True
        if not force_refresh and getattr(project, 'qualitative_report', None):
            try:
                cached_data = json.loads(project.qualitative_report)
                update_running_project(project_id, new_state={"status": "complete", "progress": 100, "message": "Loaded from database cache."})
                yield {"type": "complete", "progress": 100, "message": "Loaded cached analysis from database.", "data": cached_data}
                return
            except (json.JSONDecodeError, SQLAlchemyError) as cache_err:
                logger.warning(f"Error reading DB qualitative_report cache: {cache_err}")

        if force_refresh:
            update_running_project(project_id, new_state={"status": "running", "progress": 2, "message": "Re-analyzing project..."})

        update_running_project(project_id, progress=3, message="Fetching authors and commits...")
        yield {"type": "progress", "progress": 3, "message": "Fetching authors and commits..."}
        authors = self.author_repo.get_by_project_id(project_id)
        commits = self.commit_repo.get_by_project_id(project_id)

        if not commits:
            yield {"type": "complete", "progress": 100, "message": "No commits found.", "data": {
                "project_summary": {},
                "contributors": {}
            }}
            return

        # ── Stratified Sampling with Canonical Author Consolidation ──────────
        # Resolve each author_id to its canonical root id (caching results)
        canonical_id_map = {}
        for a in authors:
            curr_id = a.id
            visited = set()
            while curr_id is not None and curr_id not in visited:
                visited.add(curr_id)
                author = self.author_repo.get_by_id(curr_id)
                if not author or author.canonical_author_id is None:
                    break
                curr_id = author.canonical_author_id
            canonical_id_map[a.id] = curr_id or a.id

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
        yield {
            "type": "progress",
            "progress": 7,
            "message": f"Selected {total_process} commits to analyze ({mode} mode)."
        }

        # Store results here: canonical_author_id -> list of processed commit data
        processed_commits: Dict = defaultdict(list)
        total_parse_failures = 0
        total_fallbacks = 0

        # ── Per-Commit LLM Classification ─────────────────────────────────────
        for idx, c in enumerate(commits_to_process):
            if project_id in CANCELLED_PROJECT_IDS:
                CANCELLED_PROJECT_IDS.discard(project_id)
                update_running_project(project_id, new_state={"status": "cancelled", "progress": 0, "message": "Analysis cancelled by user."})
                yield {"type": "cancelled", "message": "Analysis cancelled by user."}
                return

            pct = 8 + int(82 * ((idx + 1) / total_process))
            msg_snippet = c.message[:35].replace('\n', ' ') + ("..." if len(c.message) > 35 else "")
            canonical_aid = canonical_id_map.get(c.author_id, c.author_id)
            author_name = author_map[canonical_aid].name if canonical_aid in author_map else "Unknown"
            update_running_project(project_id, progress=pct, message=f"[{idx+1}/{total_process}] Labeling commit by {author_name}")

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
                commit_msg_to_analyze = c.message or ""
                words = commit_msg_to_analyze.split()
                if len(words) > 250:
                    commit_msg_to_analyze = " ".join(words[:250])

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
                    labels = future.result(timeout=15.0)
                except concurrent.futures.TimeoutError as te:
                    logger.warning(f"Local AI classification timed out for commit {c.hash}: {te}")
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

            yield {
                "type": "progress",
                "progress": pct,
                "message": f"Labeling [{author_name}] commit ({idx+1}/{total_process}): '{msg_snippet}'"
            }

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

        # Quality check: parse failures & fallback rate
        if total_process > 0:
            parse_fail_rate = total_parse_failures / total_process
            fallback_rate = total_fallbacks / total_process
            if parse_fail_rate > 0.15 or fallback_rate > 0.15:
                err_msg = (
                    f"Local AI analysis reliability is low. "
                    f"Parse failure rate: {parse_fail_rate:.1%}, Fallback rate: {fallback_rate:.1%}. "
                    f"This exceeds the allowed 15% threshold. Please check if your local LLM is running correctly."
                )
                update_running_project(project_id, new_state={"status": "failed", "progress": 0, "message": err_msg})
                raise ValueError(err_msg)

        # ── Per-Contributor Aggregation ───────────────────────────────────────
        contributors_data = {}
        ai_degraded = False

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

        # Calculate Gini Coefficient first so we can use it to determine individual risk anomalies
        unique_canonical_ids = set(canonical_id_map.values())
        contrib_commit_counts = [len(commits_by_author.get(cid, [])) for cid in unique_canonical_ids]
        gini_val = calculate_gini(contrib_commit_counts)
        gini_status = get_gini_status(gini_val)

        # Pre-calculate total lines of code changed (LOC) across the project
        total_project_loc = 0
        canonical_loc_map = {}
        canonical_added_map = {}
        canonical_removed_map = {}
        for cid in unique_canonical_ids:
            author_commits = commits_by_author.get(cid, [])
            author_added = sum(getattr(c, 'insertions', 0) or 0 for c in author_commits)
            author_removed = sum(getattr(c, 'deletions', 0) or 0 for c in author_commits)
            author_loc = author_added + author_removed
            canonical_loc_map[cid] = author_loc
            canonical_added_map[cid] = author_added
            canonical_removed_map[cid] = author_removed
            total_project_loc += author_loc

        total_commits_all = len(commits)
        lowest_commit_count = min(contrib_commit_counts) if contrib_commit_counts else 0

        # Loop through all canonical contributors (even if 0 commits processed/sampled)
        for author_id in unique_canonical_ids:
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

                example_obj = {"hash": pc["hash"], "message": pc["message"], "type": c_type}
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

            num_members = len(unique_canonical_ids)
            expected_avg_share = 100.0 / num_members if num_members > 0 else 100.0

            # suspections of free-riding (skewed contribution share)
            is_free_rider_suspected = False
            red_flags_list = []

            # 1. Volume / share metric under half the expected average
            if num_members > 1:
                half_avg = expected_avg_share / 2.0
                if commit_share < half_avg or loc_share < half_avg:
                    is_free_rider_suspected = True
                    red_flags_list.append("Low contribution share suspected (Free-rider risk)")

            # 2. Contradiction avoidance: if Gini is High Risk and this is a lowest contributor
            if gini_val >= 0.5 and num_members > 1 and total_author_commits == lowest_commit_count:
                is_free_rider_suspected = True
                if "Low contribution share suspected (Free-rider risk)" not in red_flags_list:
                    red_flags_list.append("Lowest project contributor (Gini-flagged inequality)")

            # Calculate individual quality risk
            quality_risk = 0
            if total_sampled_ai > 0:
                vague_pct = (vague_count / total_sampled_ai) * 100
                if vague_pct > 50:
                    quality_risk += 3
                elif vague_pct > 30:
                    quality_risk += 2
                elif vague_pct > 10:
                    quality_risk += 1

                mismatch_pct = (mismatch_count / total_sampled_ai) * 100
                if mismatch_pct > 30:
                    quality_risk += 4
                elif mismatch_pct > 15:
                    quality_risk += 2

                if sec_risk_count > 0:
                    quality_risk += min(3, sec_risk_count)

            # Timing flags (if deadline is present)
            timing_risk = 0
            if deadline and late_commits_count > 0:
                timing_risk += min(2, late_commits_count)

            # Combine risk scores
            base_risk = quality_risk + timing_risk
            volume_risk_floor = 6 if is_free_rider_suspected else 0
            final_individual_risk = min(10, max(base_risk, volume_risk_floor))

            if total_sampled > 0:
                late_pct = round((deadline_close_count / total_sampled) * 100, 0)
                timing_pattern = f"{int(late_pct)}% of sampled commits within 48h before deadline" if late_pct > 0 else "Spread across project timeline"
            else:
                timing_pattern = "No commits sampled"

            # PR review evaluations default to None if missing/not tracked
            # We don't have native PR review tracking, so we represent it as None / not tracked
            contributors_data[author_name] = {
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
                    "ai_risk_score": final_individual_risk if total_sampled_ai > 0 else 0,
                    "free_rider_suspected": is_free_rider_suspected,
                    "detected_red_flags": red_flags_list if red_flags_list else ["None"]
                },
                "examples": {
                    "substantial_commits": substantial_examples,
                    "trivial_commits": trivial_examples,
                    "after_deadline_commits": after_deadline_examples if deadline else None,
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
                top_dirs = []
                tot_files = 0
                tot_dirs = 0
                has_tests = False
                
                for root, dirs, files in os.walk(repo_path):
                    dirs[:] = [d for d in dirs if not d.startswith('.') and d not in ('node_modules', '__pycache__', 'venv', 'env', 'build', 'dist')]
                    tot_dirs += len(dirs)
                    tot_files += len(files)
                    
                    if root == repo_path:
                        top_dirs = list(dirs)
                        
                    for d in dirs:
                        if d.lower() in ('test', 'tests', '__tests__', 'spec', 'specs'):
                            has_tests = True

                modularity = "Monolithic (Flat)"
                if len(top_dirs) >= 3 or has_tests:
                    modularity = "High Modularity (Structured Directories)"
                elif len(top_dirs) >= 1:
                    modularity = "Moderate Modularity"

                folder_structure = {
                    "top_level_directories": top_dirs[:8],
                    "total_directories": tot_dirs,
                    "total_files": tot_files,
                    "has_tests_dir": has_tests,
                    "modularity_score": modularity
                }

                readme_file = None
                for fname in os.listdir(repo_path):
                    if fname.lower().startswith('readme'):
                        readme_file = os.path.join(repo_path, fname)
                        break
                
                if readme_file and os.path.isfile(readme_file):
                    size_kb = round(os.path.getsize(readme_file) / 1024.0, 2)
                    has_setup = False
                    has_arch = False
                    
                    try:
                        with open(readme_file, 'r', encoding='utf-8', errors='ignore') as f:
                            content = f.read().lower()
                            if any(k in content for k in ['install', 'setup', 'run', 'build', 'usage', 'getting started']):
                                has_setup = True
                            if any(k in content for k in ['architecture', 'design', 'structure', 'api', 'component', 'overview']):
                                has_arch = True
                    except Exception as readme_err:
                        logger.warning(f"Failed to read README file at '{readme_file}': {readme_err}")

                    if size_kb > 2.0 and has_setup and has_arch:
                        doc_score = "Comprehensive (9/10)"
                    elif size_kb > 0.5 or has_setup:
                        doc_score = "Basic (5/10)"
                    else:
                        doc_score = "Minimal (3/10)"

                    readme_quality = {
                        "has_readme": True,
                        "readme_size_kb": size_kb,
                        "has_setup_guide": has_setup,
                        "has_architecture_doc": has_arch,
                        "documentation_score": doc_score
                    }
                else:
                    readme_quality["documentation_score"] = "Missing (0/10)"
            except Exception as repo_err:
                logger.warning(f"Error inspecting repo folder structure / README: {repo_err}")

        # ── Extract Extended Quantitative Metrics (Branches, Plagiarism, AST, Peak Timeline) ──
        ext_metrics = {}
        try:
            db_session = getattr(self.project_repo, 'db', None)
            ext_metrics = extract_extended_quantitative_metrics(
                db=db_session,
                project_id=project_id,
                project=project,
                commits=commits
            )
        except Exception as ext_err:
            # Last-resort boundary to prevent failure in extended metrics from halting the main qualitative analysis
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
            "gini_coefficient": f"{gini_val} ({gini_status})",
            "red_flags": red_flags,
            "peer_review_summary": peer_review_summary,
            "substantial_to_trivial_ratio": round(proj_substance_dist["substantial"] / max(1, proj_substance_dist["trivial"]), 2) if proj_substance_dist["trivial"] > 0 or proj_substance_dist["substantial"] > 0 else None
        }

        # Data Quality Assessment object
        classification_reliability = "high"
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
            "fallback_rate_type": round(total_fallbacks / max(1, total_process), 3) if total_process > 0 else 0.0,
            "fallback_rate_substance": round(total_fallbacks / max(1, total_process), 3) if total_process > 0 else 0.0,
            "parse_failure_rate": round(total_parse_failures / max(1, total_process), 3) if total_process > 0 else 0.0,
            "missing_fields": [],
            "partial_analysis_degraded": ai_degraded
        }
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
