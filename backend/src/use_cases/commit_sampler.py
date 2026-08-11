"""
Stratified Smart-Sampling Engine for Qualitative Commit Analysis
================================================================
Provides three modes:
  full   — all commits, no sampling
  sample — always-include high-signal rules + 20% stratified per contributor
  random — pure random percentage of the entire pool (not recommended)

Always-include rules (for 'sample' mode):
  - First and last commit per contributor
  - All commits within 48 hrs before deadline
  - All commits after deadline
  - Top-10 largest diffs by (insertions + deletions), globally
  - All merge / squash-suspected commits
  - Commits with very short/vague messages (< 15 chars)
  - Random sample remainder per contributor at 'sample_pct' rate (min floor = 3)
"""

import math
import random
import logging
from datetime import datetime, timedelta
from typing import Optional

logger = logging.getLogger(__name__)


def build_stratified_sample(
    commits: list,
    commits_by_author: dict,
    deadline: Optional[datetime] = None,
    mode: str = "sample",
    sample_pct: float = 0.20,

    min_per_author: int = 3,
    top_n_large_diffs: int = 10,
    short_msg_threshold: int = 15,
) -> list:
    """
    Returns an ordered list of commit objects to process based on the selected mode.

    Args:
        commits:               All commits for the project (flat list).
        commits_by_author:     Dict[author_id, list[commit]].
        deadline:              Optional submission deadline datetime.
        mode:                  "full" | "sample" | "random".
        sample_pct:            Fraction of remaining commits to include per author (0-1).
        min_per_author:        Minimum commits guaranteed per author in sample mode.
        top_n_large_diffs:     How many largest diffs to always include globally.
        short_msg_threshold:   Char length below which a message is considered vague.

    Returns:
        Deduplicated list of commit objects to process, ordered by timestamp asc.
    """
    if not commits:
        return []

    # ── Mode: full ────────────────────────────────────────────────────────────
    if mode == "full":
        return sorted(commits, key=lambda c: c.timestamp)

    # ── Mode: random ─────────────────────────────────────────────────────────
    if mode == "random":
        n = max(1, math.ceil(len(commits) * sample_pct))
        sample = random.sample(commits, min(n, len(commits)))
        return sorted(sample, key=lambda c: c.timestamp)

    # ── Mode: sample (Stratified Smart-Sampling) ──────────────────────────────
    always_include_hashes: set = set()
    selected: list = []

    # Rule 1 — First & last commit per contributor
    for author_id, author_commits in commits_by_author.items():
        if not author_commits:
            continue
        sorted_ac = sorted(author_commits, key=lambda c: c.timestamp)
        for c in [sorted_ac[0], sorted_ac[-1]]:
            if c.hash not in always_include_hashes:
                always_include_hashes.add(c.hash)
                selected.append(c)

    # Rule 2 — Deadline-aware commits (48h window + after deadline)
    if deadline:
        window_start = deadline - timedelta(hours=48)
        for c in commits:
            if c.hash in always_include_hashes:
                continue
            try:
                ts = c.timestamp
                if ts is None:
                    continue
                if ts >= window_start or ts > deadline:
                    always_include_hashes.add(c.hash)
                    selected.append(c)
            except Exception as e:
                logger.warning(f"Failed to check deadline criteria for commit {c.hash}: {e}")

    # Rule 3 — Top-N largest diffs globally
    def diff_size(c) -> int:
        return (getattr(c, "insertions", 0) or 0) + (getattr(c, "deletions", 0) or 0)

    remaining_for_large = [c for c in commits if c.hash not in always_include_hashes]
    large_commits = sorted(remaining_for_large, key=diff_size, reverse=True)[:top_n_large_diffs]
    for c in large_commits:
        if c.hash not in always_include_hashes:
            always_include_hashes.add(c.hash)
            selected.append(c)

    # Rule 4 — Merge / squash-suspected commits
    for c in commits:
        if c.hash in always_include_hashes:
            continue
        if getattr(c, "is_squash_suspected", False):
            always_include_hashes.add(c.hash)
            selected.append(c)

    # Rule 5 — Short / vague commit messages
    for c in commits:
        if c.hash in always_include_hashes:
            continue
        msg = (c.message or "").strip()
        if len(msg) < short_msg_threshold:
            always_include_hashes.add(c.hash)
            selected.append(c)

    # Rule 6 — Stratified random sample from remaining commits, per contributor
    for author_id, author_commits in commits_by_author.items():
        remaining = [c for c in author_commits if c.hash not in always_include_hashes]
        if not remaining:
            continue
        n_sample = max(min_per_author, math.ceil(len(remaining) * sample_pct))
        n_sample = min(n_sample, len(remaining))
        sampled = random.sample(remaining, n_sample)
        for c in sampled:
            always_include_hashes.add(c.hash)
            selected.append(c)

    return sorted(selected, key=lambda c: c.timestamp)


def compute_sampling_stats(
    all_commits: list,
    selected_commits: list,
    deadline: Optional[datetime] = None,
    mode: str = "sample",
    sample_pct: float = 0.20,
) -> dict:
    """
    Returns summary statistics about the sampling decision.
    Embedded into project_summary for transparency.
    """
    total = len(all_commits)
    sampled = len(selected_commits)

    after_deadline = 0
    within_48h = 0

    if deadline:
        window_start = deadline - timedelta(hours=48)
        for c in all_commits:
            try:
                ts = c.timestamp
                if ts is None:
                    continue
                if ts > deadline:
                    after_deadline += 1
                elif ts >= window_start:
                    within_48h += 1
            except Exception as e:
                logger.warning(f"Failed to calculate stats for commit {c.hash}: {e}")

    date_range = ""
    if all_commits:
        sorted_all = sorted(all_commits, key=lambda c: c.timestamp)
        start_d = sorted_all[0].timestamp
        end_d = sorted_all[-1].timestamp
        if start_d and end_d:
            date_range = f"{start_d.strftime('%Y-%m-%d')} to {end_d.strftime('%Y-%m-%d')}"

    mode_label_map = {
        "full": "full_scan_all_commits",
        "random": f"random_{int(sample_pct * 100)}pct",
        "sample": f"stratified_sample_{int(sample_pct * 100)}pct_plus_always_include_rules",
    }

    return {
        "sampling_mode": mode_label_map.get(mode, mode),
        "date_range": date_range,
        "deadline": deadline.isoformat() if deadline else None,
        "commits_after_deadline": after_deadline if deadline else None,
        "commits_within_48h_of_deadline": within_48h if deadline else None,
    }
