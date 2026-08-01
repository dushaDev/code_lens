import json
import concurrent.futures
from typing import Dict, Any, List
from collections import defaultdict
from src.use_cases.interfaces import IProjectRepository, IAuthorRepository, ICommitRepository
from src.infrastructure.services.local_ai_service import LocalAIService

# Global in-memory cache for local AI commit classifications to avoid redundant LLM invocations
CLASSIFICATION_CACHE = {}
CANCELLED_PROJECT_IDS = set()

# Global tracker: project_id -> { status, progress, message }
# status: 'running' | 'complete' | 'cancelled' | 'idle'
RUNNING_PROJECTS: Dict[int, Dict] = {}

def get_project_analysis_status(project_id: int) -> Dict:
    return RUNNING_PROJECTS.get(project_id, {"status": "idle", "progress": 0, "message": ""})

def cancel_qualitative_analysis(project_id: int):
    CANCELLED_PROJECT_IDS.add(project_id)
    if project_id in RUNNING_PROJECTS:
        RUNNING_PROJECTS[project_id]["status"] = "cancelling"

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

    def execute_stream(self, project_id: int, max_commits_per_author: int = 3, force_refresh: bool = False):
        if project_id in CANCELLED_PROJECT_IDS:
            CANCELLED_PROJECT_IDS.discard(project_id)

        # Mark as running
        RUNNING_PROJECTS[project_id] = {"status": "running", "progress": 0, "message": "Starting analysis..."}

        project = self.project_repo.get_by_id(project_id)
        if not project:
            RUNNING_PROJECTS.pop(project_id, None)
            yield {"type": "error", "message": f"Project with ID {project_id} not found."}
            return

        # Check DB cache first unless force_refresh is True
        if not force_refresh and getattr(project, 'qualitative_report', None):
            try:
                cached_data = json.loads(project.qualitative_report)
                RUNNING_PROJECTS[project_id] = {"status": "complete", "progress": 100, "message": "Loaded from database cache."}
                yield {"type": "complete", "progress": 100, "message": "Loaded cached analysis from database.", "data": cached_data}
                return
            except Exception as cache_err:
                print(f"Error reading DB qualitative_report cache: {cache_err}")

        # On force_refresh, clear old DB cache
        if force_refresh:
            RUNNING_PROJECTS[project_id] = {"status": "running", "progress": 2, "message": "Re-analyzing project..."}

        RUNNING_PROJECTS[project_id]["message"] = "Fetching authors and commits..."
        RUNNING_PROJECTS[project_id]["progress"] = 3
        yield {"type": "progress", "progress": 3, "message": "Fetching authors and commits..."}
        authors = self.author_repo.get_by_project_id(project_id)
        commits = self.commit_repo.get_by_project_id(project_id)

        if not commits:
            yield {"type": "complete", "progress": 100, "message": "No commits found.", "data": {
                "project_summary": {},
                "contributors": {}
            }}
            return

        # 1. Group commits by author and sample
        author_map = {a.id: a for a in authors}
        commits_by_author = defaultdict(list)
        for c in commits:
            commits_by_author[c.author_id].append(c)

        commits_to_process = []
        for author_id, author_commits in commits_by_author.items():
            # Sort by timestamp desc to get recent commits
            sorted_commits = sorted(author_commits, key=lambda c: c.timestamp, reverse=True)
            sampled = sorted_commits[:max_commits_per_author]
            commits_to_process.extend(sampled)

        total_process = len(commits_to_process)
        
        # Store results here: author_id -> list of processed commit data
        processed_commits = defaultdict(list)

        # 2. Process each commit through the local AI
        for idx, c in enumerate(commits_to_process):
            if project_id in CANCELLED_PROJECT_IDS:
                CANCELLED_PROJECT_IDS.discard(project_id)
                RUNNING_PROJECTS[project_id] = {"status": "cancelled", "progress": 0, "message": "Analysis cancelled by user."}
                yield {"type": "cancelled", "message": "Analysis cancelled by user."}
                return
            pct = 5 + int(85 * ((idx + 1) / total_process))
            msg_snippet = c.message[:35].replace('\n', ' ') + ("..." if len(c.message) > 35 else "")
            author_name = author_map[c.author_id].name if c.author_id in author_map else "Unknown"
            RUNNING_PROJECTS[project_id]["progress"] = pct
            RUNNING_PROJECTS[project_id]["message"] = f"[{idx+1}/{total_process}] Labeling commit by {author_name}"

            combined_diff = ""
            if hasattr(c, 'file_changes') and c.file_changes:
                for fc in c.file_changes[:2]:  # max 2 files for speed
                    if fc.raw_diff:
                        combined_diff += f"--- {fc.filename}\n{fc.raw_diff[:300]}\n"  # 300 chars per file

            # Check cache first
            if c.hash in CLASSIFICATION_CACHE:
                labels = CLASSIFICATION_CACHE[c.hash]
            else:
                try:
                    with concurrent.futures.ThreadPoolExecutor() as executor:
                        future = executor.submit(
                            self.local_ai.classify_commit,
                            commit_message=c.message,
                            code_diff=combined_diff or "No diff body available."
                        )
                        labels = future.result(timeout=12.0)
                except Exception:
                    labels = {
                        "type": "other",
                        "substance": "moderate",
                        "message_quality": "descriptive",
                        "consistent": True,
                        "has_security_risk": False,
                        "security_risk_type": "none",
                        "ai_generated_likelihood": "low",
                        "ai_signature_reason": "Analysis timeout fallback",
                        "anti_patterns": []
                    }
                CLASSIFICATION_CACHE[c.hash] = labels

            yield {
                "type": "progress", 
                "progress": pct, 
                "message": f"Labeling [{author_name}] commit ({idx+1}/{total_process}): '{msg_snippet}'",
                "log_entry": {
                    "step": idx + 1,
                    "total": total_process,
                    "author": author_name,
                    "hash": c.hash[:8],
                    "input": {
                        "message": c.message[:250] + ("..." if len(c.message) > 250 else ""),
                        "diff": combined_diff[:300] or "No diff body available."
                    },
                    "output": labels
                }
            }
            
            commit_data = {
                "hash": c.hash[:8],
                "message": c.message,
                "timestamp": c.timestamp.isoformat() if c.timestamp else None,
                "labels": labels
            }
            processed_commits[c.author_id].append(commit_data)

        RUNNING_PROJECTS[project_id]["progress"] = 95
        RUNNING_PROJECTS[project_id]["message"] = "Aggregating qualitative data..."
        yield {"type": "progress", "progress": 95, "message": "Aggregating qualitative data..."}

        # 3. Aggregate per contributor
        contributors_data = {}
        
        # Project level aggregations
        proj_type_dist = defaultdict(int)
        proj_substance_dist = {"trivial": 0, "moderate": 0, "substantial": 0}
        proj_vague_count = 0
        proj_mismatch_count = 0
        proj_security_risk_count = 0
        proj_code_smells_dist = defaultdict(int)
        proj_architecture_dist = defaultdict(int)
        proj_total_sampled = 0

        for author_id, author_processed in processed_commits.items():
            author_name = author_map[author_id].name if author_id in author_map else str(author_id)
            
            type_dist = defaultdict(int)
            substance_dist = {"trivial": 0, "moderate": 0, "substantial": 0}
            vague_count = 0
            mismatch_count = 0
            sec_risk_count = 0
            author_code_smells_dist = defaultdict(int)
            author_architecture_dist = defaultdict(int)
            
            substantial_examples = []
            trivial_examples = []
            
            for pc in author_processed:
                lbls = pc["labels"]
                
                # Type
                c_type = lbls.get("type", "other")
                type_dist[c_type] += 1
                proj_type_dist[c_type] += 1
                
                # Substance
                sub = lbls.get("substance", "moderate")
                if sub in substance_dist:
                    substance_dist[sub] += 1
                    proj_substance_dist[sub] += 1
                
                # Examples collection
                example_obj = {
                    "hash": pc["hash"],
                    "message": pc["message"],
                    "type": c_type
                }
                if sub == "substantial" and len(substantial_examples) < 3:
                    substantial_examples.append(example_obj)
                elif sub == "trivial" and len(trivial_examples) < 3:
                    trivial_examples.append(example_obj)
                
                # Message quality
                if lbls.get("message_quality") == "vague":
                    vague_count += 1
                    proj_vague_count += 1
                    
                # Consistency
                if not lbls.get("consistent", True):
                    mismatch_count += 1
                    proj_mismatch_count += 1

                # Security check
                if lbls.get("has_security_risk", False):
                    sec_risk_count += 1
                    proj_security_risk_count += 1

                # Code smells check
                for sm in lbls.get("code_smells", []):
                    if sm and sm != "none":
                        author_code_smells_dist[sm] += 1
                        proj_code_smells_dist[sm] += 1
                        
                # Architecture issues check
                for arch in lbls.get("architecture_issues", []):
                    if arch and arch != "none":
                        author_architecture_dist[arch] += 1
                        proj_architecture_dist[arch] += 1
                    
            total_sampled = len(author_processed)
            proj_total_sampled += total_sampled
            
            contributors_data[author_name] = {
                "stats": {
                    "total_project_commits": len(commits_by_author[author_id]),
                    "sampled_commits": total_sampled,
                    "type_distribution": dict(type_dist),
                    "substance_distribution": substance_dist,
                    "vague_message_percentage": round((vague_count / total_sampled) * 100, 1) if total_sampled else 0,
                    "message_mismatch_percentage": round((mismatch_count / total_sampled) * 100, 1) if total_sampled else 0,
                    "security_risk_commits": sec_risk_count,
                    "code_smell_distribution": dict(author_code_smells_dist),
                    "architecture_issue_distribution": dict(author_architecture_dist)
                },
                "examples": {
                    "substantial_commits": substantial_examples,
                    "trivial_commits": trivial_examples
                }
            }

        # Paired Snippet Resurrection Check across authors
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

        # Compare up to 2 candidate deleted vs added pairs across different authors
        compare_count = 0
        for del_item in deleted_snippets:
            if compare_count >= 2:
                break
            for add_item in added_snippets:
                if del_item["author"] != add_item["author"]:
                    try:
                        with concurrent.futures.ThreadPoolExecutor() as executor:
                            future = executor.submit(self.local_ai.compare_snippets, del_item["code"], add_item["code"])
                            res = future.result(timeout=2.5)
                    except Exception:
                        res = {"is_duplicate_or_revert": False, "similarity_type": "independent_work"}
                    
                    compare_count += 1
                    if res.get("is_duplicate_or_revert"):
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

        # Peer Review Comment Evaluation
        total_review_score = 0
        review_count = 0
        constructive_count = 0
        rubber_stamp_count = 0

        for author_id, author_processed in processed_commits.items():
            author_name = author_map[author_id].name if author_id in author_map else str(author_id)
            # Evaluate top descriptive commit message as a review sample (1 sample per author)
            for pc in author_processed[:1]:
                try:
                    with concurrent.futures.ThreadPoolExecutor() as executor:
                        future = executor.submit(self.local_ai.evaluate_review_comment, pc["message"])
                        eval_res = future.result(timeout=2.5)
                except Exception:
                    eval_res = {"substance": "constructive_review", "quality_score": 7}
                
                total_review_score += eval_res.get("quality_score", 5)
                review_count += 1
                if eval_res.get("substance") == "constructive_review":
                    constructive_count += 1
                elif eval_res.get("substance") == "rubber_stamp":
                    rubber_stamp_count += 1

        avg_peer_review_score = round(total_review_score / max(1, review_count), 1)

        # 4. Project Level aggregation
        project_summary = {
            "total_commits": len(commits),
            "sampled_commits": proj_total_sampled,
            "type_distribution": dict(proj_type_dist),
            "substance_distribution": proj_substance_dist,
            "vague_message_percentage": round((proj_vague_count / proj_total_sampled) * 100, 1) if proj_total_sampled else 0,
            "message_mismatch_percentage": round((proj_mismatch_count / proj_total_sampled) * 100, 1) if proj_total_sampled else 0,
            "security_risk_commits": proj_security_risk_count,
            "code_smell_distribution": dict(proj_code_smells_dist),
            "architecture_issue_distribution": dict(proj_architecture_dist),
            "code_resurrection_flags": resurrection_flags,
            "peer_review_summary": {
                "average_quality_score": avg_peer_review_score,
                "evaluated_comments": review_count,
                "constructive_reviews": constructive_count,
                "rubber_stamps": rubber_stamp_count
            },
            "substantial_to_trivial_ratio": round(proj_substance_dist["substantial"] / max(1, proj_substance_dist["trivial"]), 2)
        }

        final_payload = {
            "project_id": project_id,
            "project_name": project.name,
            "project_summary": project_summary,
            "contributors": contributors_data
        }

        # Persist finalized report JSON payload into ProjectModel database column
        try:
            project.qualitative_report = json.dumps(final_payload)
            self.project_repo.update(project)
        except Exception as db_save_err:
            print(f"Failed to persist qualitative_report to DB: {db_save_err}")

        RUNNING_PROJECTS[project_id] = {"status": "complete", "progress": 100, "message": "Analysis Complete!"}
        yield {"type": "complete", "progress": 100, "message": "Analysis Complete!", "data": final_payload}

    def execute(self, project_id: int, max_commits_per_author: int = 25) -> Dict[str, Any]:
        """Synchronous wrapper for backwards compatibility."""
        final_res = None
        for step in self.execute_stream(project_id, max_commits_per_author):
            if step.get("type") == "complete":
                final_res = step.get("data")
        return final_res or {}
