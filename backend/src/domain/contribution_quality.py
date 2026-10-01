"""Per-contributor Contribution Quality scoring and verdict reconciliation.

Pure Python module (zero DB/network dependencies). It owns two related pieces of
business logic that used to live inline in the qualitative-analysis use case:

1. `assess_contribution_quality(...)` — turns already-computed per-contributor
   counts/shares into a 0–10 Quality Score (10 = perfect, deduction-based),
   plus the free-rider flag and human-readable red flags. Higher is better.

2. `resolve_verdict_band(...)` / `apply_verdict_band(...)` — map a computed score +
   free-rider flag to one canonical verdict band and rewrite an LLM-authored verdict
   so its prefix always matches the metrics (a free-rider can never read "High
   Quality"). Keeps the model's prose reason, only fixes the categorical label.

Scoring model (matches the reviewed spec):
  Base 10, final = max(0, 10 - total_deductions), where total_deductions =
    workload (0–3, from contribution share vs the team average)
  + quality  (0–up, from vague/mismatch/security signals) — only when the analyzed
             sample is large enough to be meaningful (>= MIN_QUALITY_SAMPLE)
  + timing   (0–2, late commits when a deadline is tracked).

A contributor with commits but fewer than MIN_QUALITY_SAMPLE analyzed commits is
reported as Unverified (no numeric score shown), because a percentage over 1–2 data
points is noise. The share-based free-rider flag does NOT depend on sample size, so
it still fires for under-contributors regardless of how many commits were analyzed.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List

# Below this many AI-analyzed commits, percentage-based quality flags (vague %,
# message-diff mismatch %, security) are statistically meaningless and are suppressed;
# the contributor's quality reads as Unverified instead.
# Quality evidence is normalized against the whole project commit population.
# There is intentionally no fixed per-contributor minimum sample threshold.
MIN_QUALITY_SAMPLE = 0

# Canonical per-contributor verdict prefixes (Quality wording; higher = better).
VERDICT_HIGH = "High Quality"
VERDICT_MODERATE = "Moderate Quality"
VERDICT_POOR = "Poor Quality"
VERDICT_UNVERIFIED = "Unverified"

# Red-flag strings (kept as module constants so callers/tests share the exact wording).
FLAG_NO_COMMITS = "No commits attributed to this identity"
FLAG_FREE_RIDER_SHARE = "Low contribution share suspected (Free-rider risk)"
FLAG_FREE_RIDER_GINI = "Lowest project contributor (Gini-flagged inequality)"
FLAG_NO_SAMPLE = "Insufficient analyzed commits to assess quality"
FLAG_ONLY_TRIVIAL = "Only trivial/non-meaningful changes detected"
FLAG_MOSTLY_TRIVIAL = "Most analyzed changes were trivial"

# Words that mark the leading token(s) of a verdict as a band label rather than reason
# text. Used only to strip a stale prefix the LLM wrote before we prepend the canonical
# one; matching is confined to the short head before the first separator.
_BAND_KEYWORDS = (
    "quality", "risk", "unverified", "standing", "concern",
    "good", "poor", "strong", "solid", "moderate", "high", "low", "medium",
    "fair", "minor", "n/a",
)

_DEFAULT_REASONS = {
    VERDICT_HIGH: "Consistent, substantial contribution with clean signals.",
    VERDICT_MODERATE: "Some quality or contribution concerns.",
    VERDICT_POOR: "Significant quality or contribution concerns.",
    VERDICT_UNVERIFIED: "Insufficient analyzed commits to assess quality.",
}


@dataclass
class QualityAssessment:
    """Result of scoring one contributor. Primitive/flat so it maps straight onto the
    existing `stats` payload keys; the deduction breakdown is exposed for transparency
    and testing but the use case only needs the top fields."""
    quality_score: int          # 0–10, raw computed (shown only when score_assessed)
    score_assessed: bool        # True when total_sampled_ai >= MIN_QUALITY_SAMPLE
    score_unverified: bool      # has commits but sample too small to judge quality
    free_rider_suspected: bool
    red_flags: List[str] = field(default_factory=list)
    workload_deductions: int = 0
    meaningful_work_deductions: int = 0
    quality_deductions: int = 0
    timing_deductions: int = 0
    total_deductions: int = 0


def assess_contribution_quality(
    *,
    total_author_commits: int,
    num_members: int,
    expected_avg_share: float,
    commit_share: float,
    loc_share: float,
    gini_val: float,
    lowest_commit_count: int,
    total_sampled_ai: int,
    total_project_commits: int = 0,
    substantial_count: int = 0,
    moderate_count: int = 0,
    trivial_count: int = 0,
    vague_count: int,
    mismatch_count: int,
    sec_risk_count: int,
    late_commits_count: int,
    deadline_tracked: bool,
) -> QualityAssessment:
    """Score one contributor. All inputs are already computed by the caller.

    Args:
        total_author_commits: This identity's total attributed commits (humans only).
        num_members: Number of active (non-bot, committing) members on the project.
        expected_avg_share: Fair-share percentage, i.e. 100 / num_members.
        commit_share: This identity's % of total commits.
        loc_share: This identity's % of total lines changed.
        gini_val: Project commit-count Gini (0 = equal, 1 = maximally skewed).
        lowest_commit_count: Smallest per-member commit count on the project.
        total_sampled_ai: Number of this identity's commits the local AI analyzed.
        vague_count: Analyzed commits with a vague message.
        mismatch_count: Analyzed commits whose message did not match the diff.
        sec_risk_count: Analyzed commits with a security risk.
        late_commits_count: Commits after the deadline.
        deadline_tracked: Whether a deadline is configured (gates timing deductions).

    Returns:
        A QualityAssessment. When the sample is too small to judge quality,
        `score_unverified` is True and callers should render N/A rather than the number.
    """
    free_rider_suspected = False
    red_flags: List[str] = []

    if total_author_commits == 0:
        # Canonical identity with no attributed commits — a metadata artifact, not a
        # participating member. Never score or flag it as a free-rider.
        red_flags.append(FLAG_NO_COMMITS)
    else:
        # 1. Volume / share metric under half the expected average.
        if num_members > 1:
            half_avg = expected_avg_share / 2.0
            if commit_share < half_avg or loc_share < half_avg:
                free_rider_suspected = True
                red_flags.append(FLAG_FREE_RIDER_SHARE)

        # 2. Contradiction avoidance: if Gini is High Risk and this is a lowest contributor.
        if gini_val >= 0.5 and num_members > 1 and total_author_commits == lowest_commit_count:
            free_rider_suspected = True
            if FLAG_FREE_RIDER_SHARE not in red_flags:
                red_flags.append(FLAG_FREE_RIDER_GINI)

    # 3. Workload / free-riding deductions (share-based; independent of sample size).
    workload_deductions = 0
    if total_author_commits > 0 and num_members > 1:
        # Give the benefit of the doubt by using the larger of commit or LOC share.
        effective_share = max(commit_share, loc_share)
        share_ratio = effective_share / expected_avg_share if expected_avg_share > 0 else 1.0
        if share_ratio < 0.15:
            workload_deductions = 3
        elif share_ratio < 0.40:
            workload_deductions = 2
        elif share_ratio < 0.75:
            workload_deductions = 1

    # 4. Meaningful-work deductions. Commit volume alone is not enough: a contributor
    #    whose analyzed changes are only images, formatting, tiny configuration edits,
    #    or other trivial work must not receive the same score as feature/logic work.
    meaningful_work_deductions = 0
    classified_substance_total = substantial_count + moderate_count + trivial_count
    if classified_substance_total > 0:
        trivial_ratio = trivial_count / classified_substance_total
        meaningful_count = substantial_count + moderate_count
        if meaningful_count == 0:
            meaningful_work_deductions = 6
            red_flags.append(FLAG_ONLY_TRIVIAL)
        elif trivial_ratio >= 0.75:
            meaningful_work_deductions = 3
            red_flags.append(FLAG_MOSTLY_TRIVIAL)
        elif trivial_ratio >= 0.50:
            meaningful_work_deductions = 1

    # 5. Quality deductions. Rates are normalized against the whole project commit
    #    population, so a small project or a contributor with few commits is not
    #    judged by an arbitrary per-contributor sample threshold.
    quality_deductions = 0
    quality_denominator = total_project_commits or total_sampled_ai
    if quality_denominator > 0:
        vague_pct = (vague_count / quality_denominator) * 100
        if vague_pct > 50:
            quality_deductions += 3
        elif vague_pct > 30:
            quality_deductions += 2
        elif vague_pct > 10:
            quality_deductions += 1

        mismatch_pct = (mismatch_count / quality_denominator) * 100
        if mismatch_pct > 30:
            quality_deductions += 4
        elif mismatch_pct > 15:
            quality_deductions += 2

        if sec_risk_count > 0:
            quality_deductions += min(3, sec_risk_count)

    # 6. Timing deductions (only when a deadline is tracked).
    timing_deductions = 0
    if deadline_tracked and late_commits_count > 0:
        timing_deductions += min(2, late_commits_count)

    total_deductions = (
        workload_deductions
        + meaningful_work_deductions
        + quality_deductions
        + timing_deductions
    )
    quality_score = max(0, 10 - total_deductions)

    # No arbitrary minimum sample: every contributor receives a score based on
    # available evidence and project-wide denominators.
    score_assessed = total_sampled_ai > 0
    score_unverified = (total_author_commits > 0) and not score_assessed
    if score_unverified:
        red_flags.append(FLAG_NO_SAMPLE)

    return QualityAssessment(
        quality_score=quality_score,
        score_assessed=score_assessed,
        score_unverified=score_unverified,
        free_rider_suspected=free_rider_suspected,
        red_flags=red_flags,
        workload_deductions=workload_deductions,
        meaningful_work_deductions=meaningful_work_deductions,
        quality_deductions=quality_deductions,
        timing_deductions=timing_deductions,
        total_deductions=total_deductions,
    )


def resolve_verdict_band(
    quality_score: int,
    free_rider_suspected: bool,
    score_unverified: bool,
) -> str:
    """Map a contributor's computed metrics to one canonical verdict band.

    Precedence: no data (Unverified) > free-rider cap > score band. A free-rider can
    never reach `High Quality`, so the per-student verdict cannot contradict the
    free-rider flag shown elsewhere in the report.
    """
    if score_unverified:
        return VERDICT_UNVERIFIED
    if quality_score >= 8 and not free_rider_suspected:
        return VERDICT_HIGH
    if quality_score >= 5:
        return VERDICT_MODERATE
    return VERDICT_POOR


def apply_verdict_band(llm_verdict: str, band: str) -> str:
    """Rewrite an LLM-authored verdict so its prefix is the canonical `band`.

    Strips any band-like prefix the model wrote (e.g. "Low Risk - ", "High Quality: ")
    and keeps the reason text, then prepends the canonical band. If the model gave no
    usable reason, a band-appropriate default is used. Returns "<band> - <reason>".
    """
    text = (llm_verdict or "").strip()
    reason = ""
    if text:
        head, sep, tail = _split_on_separator(text)
        if sep and _is_band_like(head):
            reason = tail.strip()
        else:
            reason = text
    if not reason:
        reason = _DEFAULT_REASONS.get(band, "")
    return f"{band} - {reason}".rstrip(" -")


def _split_on_separator(text: str):
    """Split on the first verdict separator found. Returns (head, sep, tail)."""
    for sep in (" - ", " — ", " – ", ": "):
        if sep in text:
            head, tail = text.split(sep, 1)
            return head, sep, tail
    return text, "", ""


def _is_band_like(head: str) -> bool:
    """True when `head` (the text before the first separator) looks like a band label
    rather than the start of a real sentence — short and containing a band keyword."""
    h = head.strip().lower()
    if not h or len(h.split()) > 5:
        return False
    return any(kw in h for kw in _BAND_KEYWORDS)
