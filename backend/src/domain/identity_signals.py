"""
Domain: Contributor Identity & Authenticity Signals
===================================================
Pure Python module (zero DB/network dependencies) for analyzing Git contributor
identities, detecting solo projects, flagging suspected same-person split
identities, and identifying shared accounts or proxy committers.

These are DECISION-SUPPORT SIGNALS for educators and evaluators — they suggest
and provide evidence, never auto-merge.
"""

from dataclasses import dataclass, field
from itertools import combinations
import re
from typing import Dict, List, Optional, Set, Tuple
import unicodedata


# ---------------------------------------------------------------------------
# Normalization Helpers
# ---------------------------------------------------------------------------

def normalize_name_string(name: Optional[str]) -> str:
    """
    Lowercases, strips diacritics/accents, removes digits, and collapses whitespace.
    """
    if not name:
        return ""
    # Normalize unicode (decompose accents)
    nfkd = unicodedata.normalize("NFKD", name)
    no_accents = "".join(c for c in nfkd if not unicodedata.combining(c))
    # Remove digits and symbols (keep letters and spaces)
    cleaned = re.sub(r"[^a-zA-Z\s]", " ", no_accents)
    # Collapse multiple spaces and strip
    return " ".join(cleaned.lower().split())


def normalize_name_tokens(name: Optional[str]) -> Set[str]:
    """
    Returns the set of significant name tokens (length >= 2) from a normalized name.
    """
    cleaned_str = normalize_name_string(name)
    if not cleaned_str:
        return set()
    return {tok for tok in cleaned_str.split() if len(tok) >= 2}


def is_bot_identity(name: Optional[str], email: Optional[str]) -> bool:
    """Return True when the author name or email contains the '[bot]' suffix,
    identifying GitHub automation accounts (dependabot[bot], github-actions[bot],
    google-labs-jules[bot], etc.). These are NOT students and must be excluded
    from contributor counts, contribution shares, Gini, and risk scoring.
    Extend with an explicit denylist if you have bots that do not use the [bot] suffix."""
    n = (name or "").lower()
    e = (email or "").lower()
    return "[bot]" in n or "[bot]" in e


def email_local(email: Optional[str]) -> Tuple[str, Optional[str]]:
    """
    Extracts the normalized local-part of an email address and any GitHub username.

    Handles:
    - Standard emails: 'dushan@gmail.com' -> ('dushan', None)
    - GitHub noreply with ID: '12345+dushan6693@users.noreply.github.com' -> ('dushan6693', 'dushan6693')
    - GitHub noreply without ID: 'dushan6693@users.noreply.github.com' -> ('dushan6693', 'dushan6693')
    - Plus-addressing: 'user+tag@domain.com' -> ('user', None)

    Returns:
        (normalized_local_part, github_username_or_None)
    """
    if not email or "@" not in email:
        return ("", None)

    email_clean = email.strip().lower()
    local_part, domain = email_clean.split("@", 1)

    gh_username = None

    # Check for GitHub noreply format
    if "noreply.github.com" in domain:
        # Format: [digits+]username@users.noreply.github.com
        match = re.match(r"^(?:\d+\+)?([a-zA-Z0-9_\-]+)$", local_part)
        if match:
            gh_username = match.group(1).lower()
            local_part = gh_username
    else:
        # Standard plus-addressing: user+tag -> user
        if "+" in local_part:
            local_part = local_part.split("+")[0]

    # Clean local part (letters/digits)
    norm_local = re.sub(r"[^a-zA-Z0-9]", "", local_part)
    return (norm_local, gh_username)


def calculate_jaccard_similarity(set_a: Set[str], set_b: Set[str]) -> float:
    """Calculates Jaccard index between two token sets."""
    if not set_a or not set_b:
        return 0.0
    intersection = len(set_a.intersection(set_b))
    union = len(set_a.union(set_b))
    return intersection / union if union > 0 else 0.0


# ---------------------------------------------------------------------------
# Data Models for Identity Analysis
# ---------------------------------------------------------------------------

@dataclass
class AuthorIdentityRecord:
    id: int
    name: str
    email: str
    name_variants: List[str] = field(default_factory=list)
    commit_count: int = 0
    committer_emails: List[str] = field(default_factory=list)
    canonical_id: Optional[int] = None


@dataclass
class IdentityIssue:
    kind: str  # "split_identity" | "shared_account" | "pushed_by_other" | "cross_submission"
    confidence: str  # "HIGH" | "MEDIUM" | "LOW"
    members: List[str]  # e.g. ["Dushan Madushanka <d@x.com>", "dushan6693 <d@noreply>"]
    evidence: List[str]  # Detailed factual reasons
    recommended_action: str
    author_ids: List[int] = field(default_factory=list)
    matched_tokens: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "kind": self.kind,
            "confidence": self.confidence,
            "members": self.members,
            "evidence": self.evidence,
            "recommended_action": self.recommended_action,
            "author_ids": self.author_ids,
            "matched_tokens": self.matched_tokens,
        }


# ---------------------------------------------------------------------------
# Core Identity Analysis Engine
# ---------------------------------------------------------------------------

def analyze_identity_signals(
    authors: List[Dict],
    commits: Optional[List[Dict]] = None,
    canonical_id_map: Optional[Dict[int, int]] = None,
    cross_project_authors: Optional[List[Dict]] = None,
) -> Dict:
    """
    Executes all identity authenticity and duplicate detection algorithms.

    Args:
        authors: List of author dictionaries with keys:
                 {'id', 'name', 'email', optional: 'name_variants', 'canonical_author_id'}
        commits: Optional list of commit dictionaries with keys:
                 {'author_id', 'committer_email', 'committer_name', 'hash'}
        canonical_id_map: Optional pre-resolved mapping of author_id -> canonical_id
        cross_project_authors: Optional list of other project authors in the same course

    Returns:
        Structured dictionary with solo detection metrics, suspected split identities,
        shared accounts, and consolidated issues.
    """
    commits = commits or []
    canonical_id_map = canonical_id_map or {}

    # Build AuthorIdentityRecord objects
    author_records: Dict[int, AuthorIdentityRecord] = {}
    for a in authors:
        a_id = a["id"]
        c_id = canonical_id_map.get(a_id, a.get("canonical_author_id") or a_id)

        # Parse name variants
        variants = a.get("name_variants") or []
        if isinstance(variants, str):
            import json
            try:
                variants = json.loads(variants)
            except Exception:
                variants = [a.get("name", "")]

        author_records[a_id] = AuthorIdentityRecord(
            id=a_id,
            name=a.get("name", "").strip(),
            email=a.get("email", "").strip(),
            name_variants=variants if variants else [a.get("name", "").strip()],
            canonical_id=c_id,
        )

    # Attach commit stats and committer emails
    for c in commits:
        a_id = c.get("author_id")
        if a_id in author_records:
            author_records[a_id].commit_count += 1
            c_email = c.get("committer_email")
            if c_email:
                author_records[a_id].committer_emails.append(c_email.strip().lower())

    # Map records to canonical groups
    canonical_groups: Dict[int, List[AuthorIdentityRecord]] = {}
    for a_id, rec in author_records.items():
        c_id = rec.canonical_id or a_id
        if c_id not in canonical_groups:
            canonical_groups[c_id] = []
        canonical_groups[c_id].append(rec)

    # -----------------------------------------------------------------------
    # (Co-Authors / Proxy Committer Extraction)
    # -----------------------------------------------------------------------
    co_author_pattern = re.compile(r"Co-authored-by:\s*(.*?)\s*<(.*?)>", re.IGNORECASE)
    direct_commit_emails = {rec.email.lower() for rec in author_records.values() if rec.email}
    co_authors_dict: Dict[str, str] = {}  # email -> name

    if commits:
        for c in commits:
            msg = c.get("message")
            if msg:
                for match in co_author_pattern.findall(msg):
                    co_name, co_email = match
                    co_name = co_name.strip()
                    co_email = co_email.strip().lower()
                    if co_email and not is_bot_identity(co_name, co_email):
                        if co_email not in direct_commit_emails and co_email not in co_authors_dict:
                            co_authors_dict[co_email] = co_name

    co_authors_no_commits = [
        {"name": name, "email": email}
        for email, name in co_authors_dict.items()
    ]
    co_authors_only_count = len(co_authors_no_commits)

    # -----------------------------------------------------------------------
    # (A) Solo Project Detection
    # -----------------------------------------------------------------------
    raw_identity_count = len(author_records)
    canonical_contributor_count = len(canonical_groups)
    resolved_alias_count = max(0, raw_identity_count - canonical_contributor_count)

    is_proxy_solo_committer = False
    if canonical_contributor_count == 1:
        if co_authors_only_count > 0:
            is_solo_project = False
            is_proxy_solo_committer = True
            committer_name = next(iter(author_records.values())).name if author_records else "1 committer"
            identity_summary = (
                f"Proxy committer group project: {committer_name} pushed all commits on behalf of "
                f"{co_authors_only_count} co-author(s). Workload disparity is extreme."
            )
        else:
            is_solo_project = True
            if raw_identity_count > 1:
                identity_summary = (
                    f"Single-contributor submission ({raw_identity_count} Git identities "
                    f"consolidated to 1 contributor). Teamwork and workload distribution metrics are N/A."
                )
            else:
                identity_summary = (
                    "Single-contributor submission. Teamwork and workload distribution metrics are N/A."
                )
    elif resolved_alias_count > 0:
        is_solo_project = False
        identity_summary = (
            f"Multi-contributor project ({raw_identity_count} Git identities resolved "
            f"to {canonical_contributor_count} distinct contributors)."
        )
    else:
        is_solo_project = False
        identity_summary = (
            f"Multi-contributor project ({canonical_contributor_count} distinct contributors)."
        )

    proxy_committers: List[IdentityIssue] = []
    if co_authors_only_count > 0:
        committer_rec = next(iter(author_records.values())) if author_records else None
        committer_label = f"{committer_rec.name} <{committer_rec.email}>" if committer_rec else "Single Committer"
        proxy_committers.append(
            IdentityIssue(
                kind="proxy_committer",
                confidence="HIGH",
                members=[committer_label] + [f"{c['name']} <{c['email']}>" for c in co_authors_no_commits],
                evidence=[
                    f"{co_authors_only_count} team member(s) ({', '.join(c['name'] for c in co_authors_no_commits)}) "
                    f"were tagged via Co-authored-by in Git commit messages, but have authored 0 direct commits.",
                    f"All repository commits were pushed exclusively by {committer_label}.",
                ],
                recommended_action=(
                    "Lecturer verification required: Interview group members to verify individual contributions, "
                    "offline pair programming, or proxy commit practices."
                ),
                author_ids=list(author_records.keys()),
                matched_tokens=[c["email"] for c in co_authors_no_commits],
            )
        )

    suspected_same_person: List[IdentityIssue] = []
    shared_accounts: List[IdentityIssue] = []
    pushed_by_other: List[IdentityIssue] = []
    cross_submissions: List[IdentityIssue] = []

    # -----------------------------------------------------------------------
    # (B) Suspected Same-Person (Split Identity) Detection
    # -----------------------------------------------------------------------
    # Perform pairwise evaluation across DISTINCT canonical author groups
    canonical_ids = list(canonical_groups.keys())

    for c1, c2 in combinations(canonical_ids, 2):
        recs1 = canonical_groups[c1]
        recs2 = canonical_groups[c2]

        for r1 in recs1:
            for r2 in recs2:
                reasons = []
                matched_tokens = []
                confidence = None

                norm_full_1 = normalize_name_string(r1.name)
                norm_full_2 = normalize_name_string(r2.name)

                tokens1 = normalize_name_tokens(r1.name)
                tokens2 = normalize_name_tokens(r2.name)

                local1, gh1 = email_local(r1.email)
                local2, gh2 = email_local(r2.email)

                # Check 1: Exact normalized display name match across different emails
                if norm_full_1 and norm_full_2 and norm_full_1 == norm_full_2:
                    confidence = "HIGH"
                    reasons.append(
                        f"Exact display name match ('{r1.name}') across distinct email addresses "
                        f"('{r1.email}' vs '{r2.email}')."
                    )
                    matched_tokens.extend(list(tokens1))

                # Check 2: GitHub noreply username matches other's name tokens or email local
                if gh1 and (gh1 in local2 or any(t == gh1 for t in tokens2 if len(t) >= 3)):
                    confidence = "HIGH"
                    reasons.append(
                        f"GitHub noreply username '{gh1}' matches identity details of '{r2.name}' ({r2.email})."
                    )
                    matched_tokens.append(gh1)
                elif gh2 and (gh2 in local1 or any(t == gh2 for t in tokens1 if len(t) >= 3)):
                    confidence = "HIGH"
                    reasons.append(
                        f"GitHub noreply username '{gh2}' matches identity details of '{r1.name}' ({r1.email})."
                    )
                    matched_tokens.append(gh2)

                # Check 3: Email local contains name token (len >= 4)
                # Example: 'dushan6693' containing 'dushan' from 'Dushan Madushanka'
                for t1 in tokens1:
                    if len(t1) >= 4 and t1 in local2:
                        if not confidence:
                            confidence = "HIGH" if len(t1) >= 6 else "MEDIUM"
                        reasons.append(
                            f"Email username '{local2}' in '{r2.email}' contains name token '{t1}' of '{r1.name}'."
                        )
                        matched_tokens.append(t1)

                for t2 in tokens2:
                    if len(t2) >= 4 and t2 in local1:
                        if not confidence:
                            confidence = "HIGH" if len(t2) >= 6 else "MEDIUM"
                        reasons.append(
                            f"Email username '{local1}' in '{r1.email}' contains name token '{t2}' of '{r2.name}'."
                        )
                        matched_tokens.append(t2)

                # Check 4: Name-token Jaccard index >= 0.5 (e.g. multi-word names with high overlap)
                jaccard = calculate_jaccard_similarity(tokens1, tokens2)
                if jaccard >= 0.5:
                    if not confidence:
                        confidence = "HIGH" if jaccard >= 0.75 else "MEDIUM"
                    reasons.append(
                        f"High name similarity ({int(jaccard * 100)}% token overlap between '{r1.name}' and '{r2.name}')."
                    )
                    matched_tokens.extend(list(tokens1.intersection(tokens2)))

                if reasons and confidence:
                    # Deduplicate tokens
                    unique_tokens = sorted(list(set(matched_tokens)))
                    suspected_same_person.append(
                        IdentityIssue(
                            kind="split_identity",
                            confidence=confidence,
                            members=[f"{r1.name} <{r1.email}>", f"{r2.name} <{r2.email}>"],
                            evidence=reasons,
                            recommended_action=(
                                f"Verify whether '{r1.name}' and '{r2.name}' are the same person. "
                                f"If confirmed, merge these identities in Contributors settings."
                            ),
                            author_ids=[r1.id, r2.id],
                            matched_tokens=unique_tokens,
                        )
                    )

    # -----------------------------------------------------------------------
    # (C) Shared / Matching Account & Proxy Pushes
    # -----------------------------------------------------------------------
    for a_id, rec in author_records.items():
        # 1. Multiple distinct display names under one email
        if rec.name_variants and len(rec.name_variants) >= 2:
            norm_variants = [normalize_name_string(v) for v in rec.name_variants if v]
            unique_norm = list(set(norm_variants))

            # Filter variants to see if there are genuinely distinct names
            distinct_names = []
            for v in rec.name_variants:
                if v and v not in distinct_names:
                    distinct_names.append(v)

            if len(unique_norm) >= 2:
                shared_accounts.append(
                    IdentityIssue(
                        kind="shared_account",
                        confidence="HIGH",
                        members=[f"{rec.name} <{rec.email}>"],
                        evidence=[
                            f"Single email '{rec.email}' was used with {len(distinct_names)} distinct "
                            f"commit author display names: {', '.join(distinct_names)}.",
                            "Commits under a single account by multiple named individuals prevents reliable individual attribution."
                        ],
                        recommended_action=(
                            f"Confirm student account ownership for '{rec.email}'. "
                            f"Ensure students commit from individual university or personal accounts."
                        ),
                        author_ids=[rec.id],
                        matched_tokens=distinct_names,
                    )
                )

        # 2. Pushed by other (committer_email differs from author_email for majority of commits)
        if rec.committer_emails and rec.commit_count >= 3:
            differing_committers = [
                ce for ce in rec.committer_emails if ce.lower() != rec.email.lower()
            ]
            pct_other = (len(differing_committers) / len(rec.committer_emails)) * 100

            if pct_other > 50.0:
                top_committer = max(set(differing_committers), key=differing_committers.count)
                pushed_by_other.append(
                    IdentityIssue(
                        kind="pushed_by_other",
                        confidence="MEDIUM",
                        members=[f"{rec.name} <{rec.email}>"],
                        evidence=[
                            f"{int(pct_other)}% of commits authored by '{rec.name}' ({rec.email}) "
                            f"were committed/pushed by a different email ('{top_committer}').",
                            f"Total commits affected: {len(differing_committers)} of {rec.commit_count}."
                        ],
                        recommended_action=(
                            f"Verify with '{rec.name}' whether pair programming, shared workstations, "
                            f"or proxy pushing took place with '{top_committer}'."
                        ),
                        author_ids=[rec.id],
                        matched_tokens=[top_committer],
                    )
                )

    # 3. Cross-submission check (if course-level author metadata provided)
    if cross_project_authors:
        # Find if same email contributed to other projects in the course
        curr_emails = {rec.email.lower() for rec in author_records.values() if rec.email}
        for other in cross_project_authors:
            other_email = (other.get("email") or "").lower()
            other_proj = other.get("project_name", "another project")
            if other_email in curr_emails and other.get("project_id") != authors[0].get("project_id"):
                cross_submissions.append(
                    IdentityIssue(
                        kind="cross_submission",
                        confidence="HIGH",
                        members=[f"{other.get('name')} <{other_email}>"],
                        evidence=[
                            f"Email '{other_email}' also contributed commits to {other_proj} "
                            f"within the same course cohort."
                        ],
                        recommended_action=(
                            f"Check for cross-project collaboration or duplicate submissions across projects."
                        ),
                        author_ids=[],
                        matched_tokens=[other_email],
                    )
                )

    # Combine all issues
    all_issues = (
        proxy_committers + suspected_same_person + shared_accounts + pushed_by_other + cross_submissions
    )

    return {
        "is_solo_project": is_solo_project,
        "is_proxy_solo_committer": is_proxy_solo_committer,
        "has_proxy_committers": co_authors_only_count > 0,
        "co_authors_only_count": co_authors_only_count,
        "co_authors_no_commits": co_authors_no_commits,
        "canonical_contributor_count": canonical_contributor_count,
        "raw_identity_count": raw_identity_count,
        "resolved_alias_count": resolved_alias_count,
        "identity_summary": identity_summary,
        "proxy_committers": [i.to_dict() for i in proxy_committers],
        "suspected_same_person": [i.to_dict() for i in suspected_same_person],
        "shared_accounts": [i.to_dict() for i in shared_accounts],
        "pushed_by_other": [i.to_dict() for i in pushed_by_other],
        "cross_submissions": [i.to_dict() for i in cross_submissions],
        "all_issues": [i.to_dict() for i in all_issues],
    }
