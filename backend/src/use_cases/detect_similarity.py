"""
Use Case: Detect Code Similarity (Winnowing Algorithm)
======================================================
Orchestrates scanning project repos for a course, extracting AST fingerprints,
storing them in the database, performing inverted index pairwise matching,
and generating similarity reports.
"""

import os
import json
import logging
from datetime import datetime
from typing import Dict, List, Optional, Tuple, Any
from collections import defaultdict

from src.domain.constants import HIGH_CONFIDENCE_THRESHOLD, RESOLVED_PLAGIARISM_STATUSES
from src.domain.entities import FingerprintEntity
from src.use_cases.interfaces import ISimilarityRepository, ISimilarityEngine

logger = logging.getLogger(__name__)


def analyze_course_similarity(
    repo: ISimilarityRepository,
    engine: ISimilarityEngine,
    course_id: int,
    k: int = 5,
    w: int = 4,
    similarity_threshold: float = 40.0,
    allowed_extensions: Optional[List[str]] = None,
) -> Dict:
    """Runs the 10-step Winnowing AST similarity analysis across all projects in a course."""
    course = repo.get_course(course_id)
    if not course:
        raise ValueError(f"Course with ID {course_id} not found.")

    projects = repo.get_course_projects(course_id)
    if len(projects) < 2:
        return {
            "status": "warning",
            "message": "At least 2 projects are required to perform pairwise similarity detection.",
            "projects_scanned": len(projects),
            "reports": [],
        }

    project_fingerprints_map: Dict[int, List[Any]] = {}

    # STEP 1 - STEP 7: Process each project
    for project in projects:
        project_dir = getattr(project, "local_saved_path", None)
        fingerprints = engine.extract_project_fingerprints(
            project_dir=project_dir,
            k=k,
            w=w,
            allowed_extensions=allowed_extensions,
        )
        project_fingerprints_map[project.id] = fingerprints

    # STEP 8: Store fingerprints via repository
    for proj_id, fp_list in project_fingerprints_map.items():
        repo.save_project_fingerprints(proj_id, fp_list)

    # STEP 9 & STEP 10: Inverted index pairwise similarity comparison & reporting
    raw_reports = engine.compute_pairwise_similarity(
        project_fingerprints_map,
        similarity_threshold=similarity_threshold,
        k=k,
    )

    # Replace similarity reports for course via repository
    saved_reports = repo.save_similarity_reports(course_id, raw_reports)
    project_name_map = {p.id: p.name for p in projects}

    response_reports = []
    for r in raw_reports:
        response_reports.append({
            "report_id": r.get("id"),
            "project_a_id": r["project_a_id"],
            "project_a_name": project_name_map.get(r["project_a_id"], "Unknown"),
            "project_b_id": r["project_b_id"],
            "project_b_name": project_name_map.get(r["project_b_id"], "Unknown"),
            "similarity_score": r["similarity_score"],
            "file_match_percentage": r.get("file_match_percentage", r["similarity_score"]),
            "identifier_overlap_percentage": r.get("identifier_overlap_percentage", 100.0),
            "matched_hashes_count": r["matched_hashes_count"],
            "total_matched_tokens": r.get("total_matched_tokens", r["matched_hashes_count"] * k),
            "total_match_runs": r.get("total_match_runs", len(r["matched_blocks"])),
            "max_contiguous_run_tokens": r.get("max_contiguous_run_tokens", 0),
            "confidence_level": r["confidence_level"],
            "matched_blocks": r["matched_blocks"],
            "status": r.get("status", "Needs Review"),
        })

    clusters, additional_reports = detect_similarity_clusters(
        response_reports, project_name_map, project_fingerprints_map, engine
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
    project_fingerprints: Optional[Dict[int, List[Any]]] = None,
    comparator: Optional[Any] = None,
    project_time_map: Optional[Dict[int, datetime]] = None,
) -> Tuple[List[Dict], List[Dict]]:
    """
    Builds an undirected graph of flagged project pairs (similarity >= 30%)
    using Disjoint Set Union (DSU) incremental graph clustering.
    Ranks members by Origin Likelihood based on earliest submission timestamp.
    Pass 2: For any cluster with 3+ projects, triggers reanalyze_cluster_pairs
    to resolve unflagged intra-cluster pairs without corpus stopword self-suppression.
    """
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


def sync_project_comparison_coverage(repo: ISimilarityRepository, course_id: int):
    """
    Ensures complete pairwise comparison coverage for all projects in a course.
    Updates the comparison_coverage table to reflect required vs completed comparisons.
    """
    projects = repo.get_course_projects(course_id)
    reports = repo.get_existing_reports(course_id)
    repo.update_comparison_coverage(course_id, projects, reports)


def get_course_comparison_coverage(repo: ISimilarityRepository, course_id: int) -> Dict:
    """Retrieves pairwise comparison coverage metrics for administrative visibility."""
    sync_project_comparison_coverage(repo, course_id)

    coverage_rows = repo.get_comparison_coverage(course_id)
    incomplete_count = sum(1 for r in coverage_rows if r.get("status") not in ("complete", "completed"))

    return {
        "course_id": course_id,
        "total_projects": len(coverage_rows),
        "incomplete_count": incomplete_count,
        "is_complete_coverage": (incomplete_count == 0),
        "coverage_details": coverage_rows,
    }


def get_course_similarity_reports(repo: ISimilarityRepository, course_id: int) -> Dict:
    """Retrieves stored similarity reports and multi-project clusters for a course."""
    projects = repo.get_course_projects(course_id)
    project_name_map = {p.id: p.name for p in projects}
    project_time_map = {p.id: getattr(p, "created_at", None) for p in projects}

    reports = repo.get_course_reports(course_id)

    output = []
    for r in reports:
        blocks_raw = getattr(r, "matched_blocks", None) or getattr(r, "matched_blocks_json", None)
        blocks = json.loads(blocks_raw) if isinstance(blocks_raw, str) else (blocks_raw or [])
        max_run_tokens = max([b.get("token_span", 0) for b in blocks], default=0)
        ident_overlaps = [b.get("ident_overlap", 100.0) for b in blocks if "ident_overlap" in b]
        avg_ident_overlap = round(sum(ident_overlaps) / len(ident_overlaps), 1) if ident_overlaps else 100.0

        p_a = getattr(r, "project_a", None)
        p_b = getattr(r, "project_b", None)
        p_a_name = p_a.name if p_a else project_name_map.get(r.project_a_id, f"Project #{r.project_a_id}")
        p_b_name = p_b.name if p_b else project_name_map.get(r.project_b_id, f"Project #{r.project_b_id}")

        output.append({
            "report_id": r.id,
            "course_id": r.course_id,
            "project_a_id": r.project_a_id,
            "project_a_name": p_a_name,
            "project_b_id": r.project_b_id,
            "project_b_name": p_b_name,
            "similarity_score": r.similarity_score,
            "file_match_percentage": getattr(r, "file_match_percentage", r.similarity_score),
            "identifier_overlap_percentage": avg_ident_overlap,
            "matched_hashes_count": r.matched_hashes_count,
            "total_match_runs": len(blocks),
            "max_contiguous_run_tokens": max_run_tokens,
            "confidence_level": "HIGH" if r.similarity_score >= HIGH_CONFIDENCE_THRESHOLD else "MEDIUM",
            "matched_blocks": blocks,
            "status": getattr(r, "status", "Needs Review"),
            "created_at": r.created_at.isoformat() if getattr(r, "created_at", None) else None,
        })

    clusters, _ = detect_similarity_clusters(output, project_name_map, project_time_map=project_time_map)
    sync_project_comparison_coverage(repo, course_id)

    return {
        "status": "success",
        "course_id": course_id,
        "total_reports": len(output),
        "total_clusters": len(clusters),
        "reports": output,
        "clusters": clusters,
    }


def get_project_plagiarism_detail(repo: ISimilarityRepository, project_id: int, max_blocks_per_match: int = 5) -> Dict:
    """Build a detailed, decision-support plagiarism view for a SINGLE project."""
    if hasattr(repo, "get_project_plagiarism_detail"):
        return repo.get_project_plagiarism_detail(project_id)
    return {
        "scanned": False,
        "has_findings": False,
        "max_similarity_score": 0.0,
        "total_matches": 0,
        "matches": [],
        "cluster": None,
    }

