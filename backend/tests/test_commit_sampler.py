import pytest
from datetime import datetime, timedelta
from dataclasses import dataclass
from typing import Optional
from src.use_cases.commit_sampler import build_stratified_sample, compute_sampling_stats


@dataclass
class FakeCommit:
    hash: str
    timestamp: datetime
    author_id: int
    insertions: int = 10
    deletions: int = 5
    message: str = "Feat: implement feature logic"
    is_squash_suspected: bool = False


def create_test_repo_commits():
    base_time = datetime(2026, 1, 1, 10, 0, 0)
    commits = []
    commits_by_author = {1: [], 2: [], 3: []}

    # Author 1: High-volume contributor (12 commits)
    for i in range(12):
        c = FakeCommit(
            hash=f"auth1_c{i}",
            timestamp=base_time + timedelta(days=i),
            author_id=1,
            insertions=50 + i * 10,
            deletions=10,
            message=f"Commit {i} by Author 1",
        )
        commits.append(c)
        commits_by_author[1].append(c)

    # Author 2: Low-volume contributor (1 commit)
    c_auth2 = FakeCommit(
        hash="auth2_c0",
        timestamp=base_time + timedelta(days=3, hours=2),
        author_id=2,
        insertions=120,
        deletions=5,
        message="Initial auth setup by Author 2",
    )
    commits.append(c_auth2)
    commits_by_author[2].append(c_auth2)

    # Author 3: Low-volume contributor (2 commits)
    for i in range(2):
        c = FakeCommit(
            hash=f"auth3_c{i}",
            timestamp=base_time + timedelta(days=5 + i, hours=4),
            author_id=3,
            insertions=80,
            deletions=15,
            message=f"Bugfix {i} by Author 3",
        )
        commits.append(c)
        commits_by_author[3].append(c)

    return commits, commits_by_author


def test_commit_sampler_guarantees_low_commit_authors_in_all_modes():
    commits, commits_by_author = create_test_repo_commits()

    for mode in ["full", "sample", "random"]:
        selected = build_stratified_sample(
            commits=commits,
            commits_by_author=commits_by_author,
            mode=mode,
            sample_pct=0.10,  # Very low sampling rate (10%) to stress-test random mode
            low_commit_threshold=3,
            guarantee_min_per_author=1,
        )
        selected_hashes = {c.hash for c in selected}

        # Author 2 (1 commit) MUST have 100% of commits included
        assert "auth2_c0" in selected_hashes, f"Author 2 commit missing in mode={mode}"

        # Author 3 (2 commits) MUST have 100% of commits included
        assert "auth3_c0" in selected_hashes, f"Author 3 commit 0 missing in mode={mode}"
        assert "auth3_c1" in selected_hashes, f"Author 3 commit 1 missing in mode={mode}"

        # Author 1 (12 commits) must have at least 1 commit
        auth1_selected = [c for c in selected if c.author_id == 1]
        assert len(auth1_selected) >= 1, f"Author 1 has 0 commits in mode={mode}"

        # Verify ordering by timestamp
        timestamps = [c.timestamp for c in selected]
        assert timestamps == sorted(timestamps), f"Commits not sorted in mode={mode}"


def test_commit_sampler_random_mode_low_sampling_rate():
    # Large repository with one single-commit author
    commits = []
    commits_by_author = {1: [], 2: []}
    base_time = datetime(2026, 2, 1, 12, 0, 0)

    for i in range(100):
        c = FakeCommit(
            hash=f"auth1_c{i}",
            timestamp=base_time + timedelta(hours=i),
            author_id=1,
        )
        commits.append(c)
        commits_by_author[1].append(c)

    c_rare = FakeCommit(
        hash="rare_commit",
        timestamp=base_time + timedelta(hours=50),
        author_id=2,
    )
    commits.append(c_rare)
    commits_by_author[2].append(c_rare)

    # In random mode with 5% sampling rate
    selected = build_stratified_sample(
        commits=commits,
        commits_by_author=commits_by_author,
        mode="random",
        sample_pct=0.05,
    )
    selected_hashes = {c.hash for c in selected}
    assert "rare_commit" in selected_hashes, "Rare author commit was dropped in random mode"


def test_compute_sampling_stats():
    commits, commits_by_author = create_test_repo_commits()
    selected = build_stratified_sample(
        commits=commits,
        commits_by_author=commits_by_author,
        mode="sample",
    )
    stats = compute_sampling_stats(
        all_commits=commits,
        selected_commits=selected,
        mode="sample",
    )
    assert stats["sampling_mode"] == "stratified_sample_20pct_plus_always_include_rules"
    assert "date_range" in stats
