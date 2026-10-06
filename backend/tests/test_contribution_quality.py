"""Unit tests for the pure contribution-quality domain module.

Mirrors the conventions of test_identity_signals.py: no DB/session import,
plain-literal inputs, bare asserts. Every expected number is derived directly
from the deduction rules in src/domain/contribution_quality.py.
"""

from src.domain.contribution_quality import (
    assess_contribution_quality,
    resolve_verdict_band,
    apply_verdict_band,
    MIN_QUALITY_SAMPLE,
    VERDICT_HIGH,
    VERDICT_MODERATE,
    VERDICT_POOR,
    VERDICT_UNVERIFIED,
    FLAG_NO_COMMITS,
    FLAG_FREE_RIDER_SHARE,
    FLAG_FREE_RIDER_GINI,
    FLAG_NO_SAMPLE,
)


# Sensible defaults so each test only sets the fields it exercises.
def _assess(**overrides):
    base = dict(
        total_author_commits=10,
        num_members=4,
        expected_avg_share=25.0,
        commit_share=25.0,
        loc_share=25.0,
        gini_val=0.2,
        lowest_commit_count=8,
        total_sampled_ai=10,
        vague_count=0,
        mismatch_count=0,
        sec_risk_count=0,
        late_commits_count=0,
        deadline_tracked=False,
    )
    base.update(overrides)
    return assess_contribution_quality(**base)


# ── Full marks ────────────────────────────────────────────────────────────────
def test_perfect_contributor_scores_ten_and_high_quality():
    a = _assess()
    assert a.quality_score == 10
    assert a.score_assessed is True
    assert a.score_unverified is False
    assert a.free_rider_suspected is False
    assert a.total_deductions == 0
    band = resolve_verdict_band(a.quality_score, a.free_rider_suspected, a.score_unverified)
    assert band == VERDICT_HIGH


# ── Min-sample gate ─────────────────────────────────────────────────────────────
def test_single_analyzed_commit_suppresses_quality_deductions():
    # 1 analyzed commit that is vague + mismatched + a security risk. Ungated this
    # 0 analyzed commits -> quality cannot be assessed, score is Unverified.
    a = _assess(
        total_author_commits=5,
        num_members=3,
        expected_avg_share=33.33,
        commit_share=30.0,
        loc_share=28.0,
        lowest_commit_count=4,
        total_sampled_ai=0,
        vague_count=0,
        mismatch_count=0,
        sec_risk_count=0,
    )
    assert a.quality_deductions == 0
    assert a.score_assessed is False
    assert a.score_unverified is True
    assert a.free_rider_suspected is False
    assert FLAG_NO_SAMPLE in a.red_flags
    band = resolve_verdict_band(a.quality_score, a.free_rider_suspected, a.score_unverified)
    assert band == VERDICT_UNVERIFIED


def test_gate_boundary_three_samples_is_assessed():
    # When MIN_QUALITY_SAMPLE is 0, any sample > 0 is assessed; 0 is unverified.
    assert MIN_QUALITY_SAMPLE == 0
    a = _assess(total_sampled_ai=1, num_members=1)
    assert a.score_assessed is True
    assert a.score_unverified is False
    b = _assess(total_sampled_ai=0, num_members=1)
    assert b.score_assessed is False
    assert b.score_unverified is True


def test_zero_samples_flags_no_sample():
    a = _assess(total_author_commits=4, num_members=1, total_sampled_ai=0)
    assert a.score_unverified is True
    assert FLAG_NO_SAMPLE in a.red_flags


# ── Free-rider detection ────────────────────────────────────────────────────────
def test_free_rider_fires_below_gate():
    # Tiny share, 0 analyzed commits: share-based flag must still fire even though
    # quality is Unverified.
    a = _assess(
        total_author_commits=1,
        commit_share=3.0,
        loc_share=2.0,
        gini_val=0.6,
        lowest_commit_count=1,
        total_sampled_ai=0,
    )
    assert a.free_rider_suspected is True
    assert FLAG_FREE_RIDER_SHARE in a.red_flags
    assert a.score_unverified is True
    band = resolve_verdict_band(a.quality_score, a.free_rider_suspected, a.score_unverified)
    assert band == VERDICT_UNVERIFIED  # Unverified takes precedence over the free-rider cap


def test_free_rider_above_gate_is_capped_at_moderate():
    # Few commits but lots of lines: free-rider (low commit share) yet a clean, large
    # sample -> raw score 10. The verdict band must be capped at Moderate, never High.
    a = _assess(
        total_author_commits=10,
        commit_share=5.0,   # < half of 25 -> free-rider
        loc_share=30.0,     # high LOC share -> effective share high -> no workload hit
        total_sampled_ai=5,
    )
    assert a.free_rider_suspected is True
    assert a.score_assessed is True
    assert a.quality_score == 10
    band = resolve_verdict_band(a.quality_score, a.free_rider_suspected, a.score_unverified)
    assert band == VERDICT_MODERATE


def test_gini_flag_when_lowest_contributor_in_skewed_project():
    # Share not low enough to trip the half-average rule, but High-Gini + lowest count.
    a = _assess(
        total_author_commits=6,
        num_members=4,
        commit_share=14.0,  # above half-avg (12.5) -> no share flag
        loc_share=14.0,
        gini_val=0.55,
        lowest_commit_count=6,
        total_sampled_ai=6,
    )
    assert a.free_rider_suspected is True
    assert FLAG_FREE_RIDER_GINI in a.red_flags
    assert FLAG_FREE_RIDER_SHARE not in a.red_flags


def test_no_commits_identity_is_not_a_free_rider():
    a = _assess(total_author_commits=0, total_sampled_ai=0)
    assert a.free_rider_suspected is False
    assert a.workload_deductions == 0
    assert a.red_flags == [FLAG_NO_COMMITS]
    assert a.score_unverified is False  # no data at all -> caller renders 0/N-A, not "Unverified"


# ── Workload deduction tiers ────────────────────────────────────────────────────
def test_workload_deduction_tiers():
    # ratio = max(commit, loc) share / expected_avg_share (25.0); large clean sample.
    assert _assess(commit_share=3.0, loc_share=3.0).workload_deductions == 3    # 0.12 < 0.15
    assert _assess(commit_share=9.0, loc_share=9.0).workload_deductions == 2    # 0.36 < 0.40
    assert _assess(commit_share=15.0, loc_share=15.0).workload_deductions == 1  # 0.60 < 0.75
    assert _assess(commit_share=25.0, loc_share=25.0).workload_deductions == 0  # 1.00


def test_solo_project_has_no_workload_or_free_rider():
    a = _assess(num_members=1, commit_share=100.0, loc_share=100.0)
    assert a.workload_deductions == 0
    assert a.free_rider_suspected is False


# ── Quality deduction tiers ─────────────────────────────────────────────────────
def test_quality_deduction_tiers_combined():
    # num_members=1 isolates quality (no workload / free-rider). 10 samples.
    a = _assess(num_members=1, total_sampled_ai=10, vague_count=6, mismatch_count=4, sec_risk_count=5)
    # vague 60% -> +3, mismatch 40% -> +4, security min(3,5) -> +3  => 10
    assert a.quality_deductions == 10
    assert a.quality_score == 0
    band = resolve_verdict_band(a.quality_score, a.free_rider_suspected, a.score_unverified)
    assert band == VERDICT_POOR


def test_mild_quality_signal_stays_high():
    a = _assess(num_members=1, total_sampled_ai=10, vague_count=2)  # 20% -> +1
    assert a.quality_deductions == 1
    assert a.quality_score == 9
    band = resolve_verdict_band(a.quality_score, a.free_rider_suspected, a.score_unverified)
    assert band == VERDICT_HIGH


# ── Timing deductions ───────────────────────────────────────────────────────────
def test_timing_deductions_capped_at_two_and_gated_on_deadline():
    assert _assess(num_members=1, late_commits_count=5, deadline_tracked=True).timing_deductions == 2
    assert _assess(num_members=1, late_commits_count=1, deadline_tracked=True).timing_deductions == 1
    # No deadline configured -> timing never deducts.
    assert _assess(num_members=1, late_commits_count=5, deadline_tracked=False).timing_deductions == 0


# ── resolve_verdict_band precedence ─────────────────────────────────────────────
def test_resolve_verdict_band_precedence():
    assert resolve_verdict_band(10, False, True) == VERDICT_UNVERIFIED   # unverified wins
    assert resolve_verdict_band(10, True, False) == VERDICT_MODERATE     # free-rider caps High
    assert resolve_verdict_band(10, False, False) == VERDICT_HIGH
    assert resolve_verdict_band(8, True, False) == VERDICT_MODERATE
    assert resolve_verdict_band(6, False, False) == VERDICT_MODERATE
    assert resolve_verdict_band(4, False, False) == VERDICT_POOR
    assert resolve_verdict_band(3, True, False) == VERDICT_POOR


# ── apply_verdict_band prose handling ───────────────────────────────────────────
def test_apply_verdict_band_strips_stale_prefix_keeps_reason():
    out = apply_verdict_band("Low Risk - Solid work on the auth layer.", VERDICT_MODERATE)
    assert out == "Moderate Quality - Solid work on the auth layer."


def test_apply_verdict_band_handles_colon_separator():
    out = apply_verdict_band("High Quality: Great contribution across modules.", VERDICT_HIGH)
    assert out == "High Quality - Great contribution across modules."


def test_apply_verdict_band_uses_default_reason_when_empty():
    out = apply_verdict_band("", VERDICT_UNVERIFIED)
    assert out.startswith("Unverified - ")
    assert len(out) > len("Unverified - ")


def test_apply_verdict_band_preserves_non_band_leading_text():
    # A real sentence whose first words are not a band label must be kept intact.
    reason = "Alice built the backend - solid throughout."
    out = apply_verdict_band(reason, VERDICT_HIGH)
    assert out == f"High Quality - {reason}"


# ── Scenario regression: a skewed 3-person project ──────────────────────────────
# Captures the reported defect (a 1-commit contributor reading 3/10 and a free-rider
# reading "High/Low Risk"). Values are illustrative of the shape that motivated the
# fix, not transcribed from a specific chart.
def test_skewed_project_regression_shapes():
    # Dominant contributor: big clean share, large sample -> High Quality.
    dominant = _assess(
        total_author_commits=30, num_members=3, expected_avg_share=33.33,
        commit_share=70.0, loc_share=68.0, gini_val=0.55, lowest_commit_count=1,
        total_sampled_ai=12,
    )
    assert resolve_verdict_band(
        dominant.quality_score, dominant.free_rider_suspected, dominant.score_unverified
    ) == VERDICT_HIGH

    # One-commit contributor in the same skewed project with 0 analyzed samples -> Unverified + free-rider,
    # NOT a punitive numeric score.
    tiny = _assess(
        total_author_commits=1, num_members=3, expected_avg_share=33.33,
        commit_share=2.0, loc_share=1.0, gini_val=0.55, lowest_commit_count=1,
        total_sampled_ai=0, mismatch_count=0,
    )
    assert tiny.score_unverified is True
    assert tiny.free_rider_suspected is True
    assert resolve_verdict_band(
        tiny.quality_score, tiny.free_rider_suspected, tiny.score_unverified
    ) == VERDICT_UNVERIFIED

