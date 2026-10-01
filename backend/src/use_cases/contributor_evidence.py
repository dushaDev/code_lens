"""Per-contributor file-change evidence assembly.

Builds a live, code-derived picture of *which specific files/modules* each
canonical contributor changed and how heavily — beyond the top-level folder
aggregation used elsewhere (``ownership_areas``). Consumed by the cloud-report
prompt and the render-time deterministic fallback so the PDF's "Contribution
Summary" can describe what a person actually built (real filenames + edit
intensity), instead of a bare folder name.

Best-effort and side-effect-light: assembly only reads the DB, never writes;
enrichment mutates ``qual_data`` in memory only (matching the live-compute
precedent used for plagiarism/identity). Any failure leaves ``qual_data``
untouched and the report degrades to the existing folder-level summary.

DATA EGRESS NOTE: the derived signals produced here (filenames, per-file edit
counts, summed complexity / function counts) are later fed into the cloud-report
prompt and therefore egress to the external provider. Raw diffs are NOT
included.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


def collect_contributor_file_evidence(
    db,
    project_id: int,
    canonical_map: Optional[Dict[int, int]] = None,
    top_n: int = 6,
) -> Dict[int, List[dict]]:
    """Return, per canonical author id, a ranked list of the specific files a
    contributor changed most, with edit intensity and code-shape aggregates.

    One grouped query over ``file_changes`` ⋈ ``commits`` (filtered by project),
    grouped by ``(filename, author_id)``. Raw author ids are folded into their
    canonical root via ``canonical_map`` (``{raw_id: root_id}``) so merged
    identities aggregate together.

    Each entry: ``{"file", "changes", "complexity", "functions"}`` where
    ``changes`` is how many commits touched that file. Ranked by change count
    then complexity (desc), truncated to ``top_n`` per contributor. Returns an
    empty dict on any error — never raises.
    """
    canonical_map = canonical_map or {}
    result: Dict[int, List[dict]] = {}
    try:
        if hasattr(db, "get_raw_contributor_file_change_stats"):
            rows = db.get_raw_contributor_file_change_stats(project_id)
        elif hasattr(db, "query"):
            # Supports duck-typed test mock sessions without importing sqlalchemy
            rows = db.query().all()
        else:
            return {}
    except Exception as e:
        logger.warning(f"Error collecting contributor file evidence: {e}")
        return {}

    # Fold raw author ids → canonical, summing per (canonical id, normalized file).
    agg: Dict[int, Dict[str, dict]] = defaultdict(dict)
    for filename, author_id_raw, changes, complexity, functions in rows:
        if not filename:
            continue
        cid = canonical_map.get(author_id_raw, author_id_raw)
        norm = str(filename).replace("\\", "/").lstrip("/")
        bucket = agg[cid]
        entry = bucket.get(norm)
        if entry is None:
            bucket[norm] = {
                "file": norm,
                "changes": int(changes or 0),
                "complexity": int(complexity or 0),
                "functions": int(functions or 0),
            }
        else:
            entry["changes"] += int(changes or 0)
            entry["complexity"] += int(complexity or 0)
            entry["functions"] += int(functions or 0)

    for cid, files_map in agg.items():
        ranked = sorted(
            files_map.values(),
            key=lambda e: (e["changes"], e["complexity"]),
            reverse=True,
        )
        result[cid] = ranked[: max(0, top_n)]
    return result


def enrich_contributors_with_file_evidence(
    db,
    project,
    qual_data: dict,
    canonical_map: Optional[Dict[int, int]] = None,
    top_n: int = 6,
) -> None:
    """Attach ``stats["top_files_detail"]`` to each contributor in ``qual_data``.

    Matches each contributor to its file evidence by the contributor's
    top-level ``canonical_author_id`` (falling back to ``author_id``). In-memory
    mutation only; fully guarded so any failure leaves ``qual_data`` untouched.
    """
    if not qual_data or not isinstance(qual_data, dict):
        return
    contributors = qual_data.get("contributors")
    if not isinstance(contributors, dict) or not contributors:
        return
    try:
        project_id = getattr(project, "id", None)
        if project_id is None:
            return
        evidence = collect_contributor_file_evidence(
            db, project_id, canonical_map, top_n=top_n
        )
        if not evidence:
            return
        for _name, cdata in contributors.items():
            if not isinstance(cdata, dict):
                continue
            cid = cdata.get("canonical_author_id", cdata.get("author_id"))
            files = evidence.get(cid)
            if not files:
                continue
            stats = cdata.get("stats")
            if not isinstance(stats, dict):
                stats = {}
                cdata["stats"] = stats
            stats["top_files_detail"] = files
    except Exception as e:
        logger.warning(f"Contributor file-evidence enrichment skipped: {e}")
