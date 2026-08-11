"""
Use Case: Detect Code Similarity (Winnowing Algorithm)
======================================================
Orchestrates scanning project repos for a course, extracting AST fingerprints,
storing them in the database, performing inverted index pairwise matching,
and generating similarity reports.
"""

from datetime import datetime
import json
import logging
from typing import Dict, List, Optional, Tuple

from sqlalchemy.orm import Session
from src.infrastructure.database.models import (
    CourseModel,
    ProjectFingerprintModel,
    ProjectModel,
    SimilarityReportModel,
)
from src.infrastructure.services.winnowing_engine import (
    AstParserService,
    FileCollector,
    Fingerprint,
    SimilarityComparator,
    WinnowingService,
)

logger = logging.getLogger(__name__)


def analyze_course_similarity(
    db: Session,
    course_id: int,
    k: int = 5,
    w: int = 4,
    similarity_threshold: float = 40.0,
    allowed_extensions: Optional[List[str]] = None,
) -> Dict:
    """Runs the 10-step Winnowing AST similarity analysis across all projects in a course."""
    course = db.query(CourseModel).filter(CourseModel.id == course_id).first()
    if not course:
        raise ValueError(f"Course with ID {course_id} not found.")

    projects = db.query(ProjectModel).filter(ProjectModel.course_id == course_id).all()
    if len(projects) < 2:
        return {
            "status": "warning",
            "message": "At least 2 projects are required to perform pairwise similarity detection.",
            "projects_scanned": len(projects),
            "reports": [],
        }

    ext_set = set(allowed_extensions) if allowed_extensions else None
    collector = FileCollector(allowed_extensions=ext_set)
    parser = AstParserService()
    winnowing = WinnowingService(k=k, w=w)

    project_fingerprints_map: Dict[int, List[Fingerprint]] = {}

    # STEP 1 - STEP 7: Process each project
    for project in projects:
        project_dir = project.local_saved_path
        file_paths = collector.collect_files(project_dir)

        project_tokens = []
        for rel_file in file_paths:
            full_path = f"{project_dir}/{rel_file}" if not project_dir.endswith("/") else f"{project_dir}{rel_file}"
            file_tokens = parser.parse_file(full_path, rel_file)
            project_tokens.extend(file_tokens)

        # Generate Winnowing fingerprints
        fingerprints = winnowing.generate_fingerprints(project_tokens)
        project_fingerprints_map[project.id] = fingerprints

    # STEP 8: Store fingerprints in DB
    # Clear existing fingerprints for these projects first
    project_ids = [p.id for p in projects]
    db.query(ProjectFingerprintModel).filter(
        ProjectFingerprintModel.project_id.in_(project_ids)
    ).delete(synchronize_session=False)

    db_fingerprints = []
    for proj_id, fp_list in project_fingerprints_map.items():
        for fp in fp_list:
            db_fingerprints.append(
                ProjectFingerprintModel(
                    project_id=proj_id,
                    hash_value=fp.hash_value,
                    file_path=fp.file_path,
                    line_number=fp.line_number,
                )
            )

    if db_fingerprints:
        db.bulk_save_objects(db_fingerprints)
    db.commit()

    # STEP 9 & STEP 10: Inverted index pairwise similarity comparison & reporting
    comparator = SimilarityComparator(file_match_threshold=similarity_threshold)
    raw_reports = comparator.compute_pairwise_similarity(project_fingerprints_map)

    # Capture existing status map before clear
    existing_reports = db.query(SimilarityReportModel).filter(SimilarityReportModel.course_id == course_id).all()
    status_map = {(r.project_a_id, r.project_b_id): getattr(r, "status", "Needs Review") for r in existing_reports if getattr(r, "status", None)}

    # Clear existing similarity reports for this course
    db.query(SimilarityReportModel).filter(SimilarityReportModel.course_id == course_id).delete(
        synchronize_session=False
    )

    db_reports = []
    response_reports = []

    # Map project IDs to names for clean response
    project_name_map = {p.id: p.name for p in projects}

    for r in raw_reports:
        matched_blocks_json = json.dumps(r["matched_blocks"])
        pair_key = (r["project_a_id"], r["project_b_id"])
        prev_status = status_map.get(pair_key, "Needs Review")

        report_obj = SimilarityReportModel(
            course_id=course_id,
            project_a_id=r["project_a_id"],
            project_b_id=r["project_b_id"],
            similarity_score=r["similarity_score"],
            matched_hashes_count=r["matched_hashes_count"],
            matched_blocks_json=matched_blocks_json,
            status=prev_status,
        )
        db.add(report_obj)
        db.flush() # Populates report_obj.id

        response_reports.append({
            "report_id": report_obj.id,
            "project_a_id": r["project_a_id"],
            "project_a_name": project_name_map.get(r["project_a_id"], "Unknown"),
            "project_b_id": r["project_b_id"],
            "project_b_name": project_name_map.get(r["project_b_id"], "Unknown"),
            "similarity_score": r["similarity_score"],
            "file_match_percentage": r.get("file_match_percentage", r["similarity_score"]),
            "identifier_overlap_percentage": r.get("identifier_overlap_percentage", 100.0),
            "matched_hashes_count": r["matched_hashes_count"],
            "total_match_runs": r.get("total_match_runs", len(r["matched_blocks"])),
            "max_contiguous_run_tokens": r.get("max_contiguous_run_tokens", 0),
            "confidence_level": r["confidence_level"],
            "matched_blocks": r["matched_blocks"],
            "status": prev_status,
        })

    db.commit()

    clusters, additional_reports = detect_similarity_clusters(
        response_reports, project_name_map, project_fingerprints_map, comparator
    )

    if additional_reports:
        response_reports.extend(additional_reports)

    return {
        "status": "success",
        "course_id": course_id,
        "projects_scanned": len(projects),
        "total_flagged_pairs": len(response_reports),
        "total_clusters": len(clusters),
        "clusters": clusters,
        "reports": response_reports,
    }


class DisjointSetUnion:
    """Disjoint Set Union (DSU) for incremental graph connected component clustering."""
    def __init__(self, elements):
        self.parent = {e: e for e in elements}
        self.rank = {e: 0 for e in elements}

    def find(self, i):
        if i not in self.parent:
            self.parent[i] = i
            self.rank[i] = 0
            return i
        if self.parent[i] == i:
            return i
        self.parent[i] = self.find(self.parent[i])
        return self.parent[i]

    def union(self, i, j):
        root_i = self.find(i)
        root_j = self.find(j)
        if root_i != root_j:
            if self.rank[root_i] < self.rank[root_j]:
                root_i, root_j = root_j, root_i
            self.parent[root_j] = root_i
            if self.rank[root_i] == self.rank[root_j]:
                self.rank[root_i] += 1
            return True
        return False


def detect_similarity_clusters(
    reports: List[Dict],
    project_name_map: Dict[int, str],
    project_fingerprints: Optional[Dict[int, List[Fingerprint]]] = None,
    comparator: Optional[SimilarityComparator] = None,
    project_time_map: Optional[Dict[int, datetime]] = None,
) -> Tuple[List[Dict], List[Dict]]:
    """
    Builds an undirected graph of flagged project pairs (similarity >= 30%)
    using Disjoint Set Union (DSU) incremental graph clustering.
    Ranks members by Origin Likelihood based on earliest submission timestamp.
    Pass 2: For any cluster with 3+ projects, triggers reanalyze_cluster_pairs
    to resolve unflagged intra-cluster pairs without corpus stopword self-suppression.
    """
    from collections import defaultdict

    all_pids = set()
    for r in reports:
        all_pids.add(r["project_a_id"])
        all_pids.add(r["project_b_id"])

    dsu = DisjointSetUnion(all_pids)
    pair_scores = {}
    existing_flagged_pairs = set()

    for r in reports:
        p1 = r["project_a_id"]
        p2 = r["project_b_id"]
        score = r.get("file_match_percentage", r.get("similarity_score", 0))

        if score >= 30.0:
            dsu.union(p1, p2)
            pair_key = (min(p1, p2), max(p1, p2))
            pair_scores[pair_key] = score
            existing_flagged_pairs.add(pair_key)

    # Group projects by DSU root
    components_map = defaultdict(list)
    for pid in all_pids:
        root = dsu.find(pid)
        components_map[root].append(pid)

    clusters = []
    additional_reports = []
    cluster_counter = 1

    for root, component in components_map.items():
        if len(component) >= 3:
            # Pass 2: Re-analyze cluster member pairs without stopword self-suppression
            if project_fingerprints and comparator:
                extra_cluster_reports = comparator.reanalyze_cluster_pairs(
                    component, project_fingerprints, existing_flagged_pairs
                )
                for r in extra_cluster_reports:
                    r["project_a_name"] = project_name_map.get(r["project_a_id"], "Unknown")
                    r["project_b_name"] = project_name_map.get(r["project_b_id"], "Unknown")
                    additional_reports.append(r)
                    pair_key = (min(r["project_a_id"], r["project_b_id"]), max(r["project_a_id"], r["project_b_id"]))
                    pair_scores[pair_key] = r["similarity_score"]

            # Sort member projects by created_at timestamp to determine Origin Likelihood Ranking
            sorted_component = sorted(
                component,
                key=lambda pid: project_time_map.get(pid, datetime.max) if project_time_map else pid
            )

            member_projects = []
            for idx, pid in enumerate(sorted_component):
                is_origin = (idx == 0)
                member_projects.append({
                    "id": pid,
                    "name": project_name_map.get(pid, f"Project #{pid}"),
                    "is_probable_origin": is_origin,
                    "origin_likelihood": "High (Earliest Submission)" if is_origin else "Likely Derivative/Copy",
                    "submitted_at": project_time_map.get(pid).isoformat() if project_time_map and project_time_map.get(pid) else None,
                })

            comp_scores = []
            for i in range(len(component)):
                for j in range(i + 1, len(component)):
                    pair_key = (min(component[i], component[j]), max(component[i], component[j]))
                    if pair_key in pair_scores:
                        comp_scores.append(pair_scores[pair_key])

            avg_score = round(sum(comp_scores) / max(1, len(comp_scores)), 2)

            clusters.append({
                "cluster_id": cluster_counter,
                "title": f"Cluster #{cluster_counter}: Multi-Project Copying Group",
                "label": "Possible shared source / multi-group copying",
                "member_count": len(component),
                "avg_similarity_score": avg_score,
                "probable_origin": member_projects[0],
                "projects": member_projects,
                "project_ids": component,
            })
            cluster_counter += 1

    return clusters, additional_reports


def sync_project_comparison_coverage(db: Session, course_id: int):
    """
    Ensures complete pairwise comparison coverage for all projects in a course.
    Updates the comparison_coverage table to reflect required vs completed comparisons.
    """
    from src.infrastructure.database.models import ComparisonCoverageModel
    projects = db.query(ProjectModel).filter(ProjectModel.course_id == course_id).all()
    total_projects = len(projects)
    required_per_proj = max(0, total_projects - 1)

    reports = db.query(SimilarityReportModel).filter(SimilarityReportModel.course_id == course_id).all()
    completed_pairs = set()
    for r in reports:
        completed_pairs.add((min(r.project_a_id, r.project_b_id), max(r.project_a_id, r.project_b_id)))

    for p in projects:
        comp_count = sum(1 for other in projects if other.id != p.id and (min(p.id, other.id), max(p.id, other.id)) in completed_pairs)
        cov = db.query(ComparisonCoverageModel).filter(ComparisonCoverageModel.project_id == p.id).first()
        status_str = "completed" if comp_count >= required_per_proj else ("in_progress" if comp_count > 0 else "pending")

        if not cov:
            cov = ComparisonCoverageModel(
                course_id=course_id,
                project_id=p.id,
                total_required_comparisons=required_per_proj,
                completed_comparisons=comp_count,
                status=status_str,
            )
            db.add(cov)
        else:
            cov.total_required_comparisons = required_per_proj
            cov.completed_comparisons = comp_count
            cov.status = status_str

    db.commit()


def get_course_comparison_coverage(db: Session, course_id: int) -> Dict:
    """Retrieves pairwise comparison coverage metrics for administrative visibility."""
    from src.infrastructure.database.models import ComparisonCoverageModel
    sync_project_comparison_coverage(db, course_id)

    projects = db.query(ProjectModel).filter(ProjectModel.course_id == course_id).all()
    proj_map = {p.id: p.name for p in projects}

    coverage_rows = db.query(ComparisonCoverageModel).filter(ComparisonCoverageModel.course_id == course_id).all()

    incomplete_count = sum(1 for r in coverage_rows if r.completed_comparisons < r.total_required_comparisons)

    output_rows = []
    for r in coverage_rows:
        output_rows.append({
            "project_id": r.project_id,
            "project_name": proj_map.get(r.project_id, f"Project #{r.project_id}"),
            "total_required": r.total_required_comparisons,
            "completed": r.completed_comparisons,
            "status": r.status,
            "last_updated": r.last_updated.isoformat() if r.last_updated else None,
        })

    return {
        "course_id": course_id,
        "total_projects": len(projects),
        "incomplete_count": incomplete_count,
        "is_complete_coverage": (incomplete_count == 0),
        "coverage_details": output_rows,
    }


def get_course_similarity_reports(db: Session, course_id: int) -> Dict:
    """Retrieves stored similarity reports and multi-project clusters for a course."""
    projects = db.query(ProjectModel).filter(ProjectModel.course_id == course_id).all()
    project_name_map = {p.id: p.name for p in projects}
    project_time_map = {p.id: p.created_at for p in projects}

    reports = db.query(SimilarityReportModel).filter(SimilarityReportModel.course_id == course_id).order_by(
        SimilarityReportModel.similarity_score.desc()
    ).all()

    output = []
    for r in reports:
        blocks = json.loads(r.matched_blocks_json) if r.matched_blocks_json else []
        max_run_tokens = max([b.get("token_span", 0) for b in blocks], default=0)
        ident_overlaps = [b.get("ident_overlap", 100.0) for b in blocks if "ident_overlap" in b]
        avg_ident_overlap = round(sum(ident_overlaps) / len(ident_overlaps), 1) if ident_overlaps else 100.0

        output.append({
            "report_id": r.id,
            "course_id": r.course_id,
            "project_a_id": r.project_a_id,
            "project_a_name": r.project_a.name if r.project_a else project_name_map.get(r.project_a_id, f"Project #{r.project_a_id}"),
            "project_b_id": r.project_b_id,
            "project_b_name": r.project_b.name if r.project_b else project_name_map.get(r.project_b_id, f"Project #{r.project_b_id}"),
            "similarity_score": r.similarity_score,
            "file_match_percentage": r.similarity_score,
            "identifier_overlap_percentage": avg_ident_overlap,
            "matched_hashes_count": r.matched_hashes_count,
            "total_match_runs": len(blocks),
            "max_contiguous_run_tokens": max_run_tokens,
            "confidence_level": "HIGH" if r.similarity_score >= 70.0 else "MEDIUM",
            "matched_blocks": blocks,
            "status": r.status or "Needs Review",
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })

    clusters, _ = detect_similarity_clusters(output, project_name_map, project_time_map=project_time_map)
    sync_project_comparison_coverage(db, course_id)

    return {
        "status": "success",
        "course_id": course_id,
        "total_reports": len(output),
        "total_clusters": len(clusters),
        "reports": output,
        "clusters": clusters,
    }
