"""
Cloud AI Report Use Case
Generates a final comprehensive project evaluation using Google Gemini API
or AgentRouter (Claude/GPT) based on the structured qualitative analysis data
from the local AI pass.

DATA EGRESS NOTICE
------------------
This module makes outbound HTTPS requests to external AI providers:
  1. AgentRouter (AGENTROUTER_URL, default https://agentrouter.org/v1/chat/completions)
     - Triggered when the stored API key starts with "sk-"
     - Transmits: the full evaluation prompt (contains repo metrics and commit
       data) plus the user's decrypted API key in the Authorization header.
  2. Google Gemini (https://generativelanguage.googleapis.com)
     - Triggered for all other key formats.
     - Transmits: the full evaluation prompt plus the user's Gemini API key.

The AgentRouter destination URL can be overridden via the AGENTROUTER_URL
environment variable to point at a self-hosted or staging endpoint.
No raw API key values are written to logs anywhere in this module.
"""
import os
import json
import io
import base64
import logging
import urllib.request
import urllib.error
import time
from typing import Optional
from pydantic import ValidationError
try:
    from google.api_core.exceptions import GoogleAPIError
except ImportError:
    class GoogleAPIError(Exception):
        pass

from src.domain.constants import GEMINI_MODEL, RESOLVED_PLAGIARISM_STATUSES
from src.domain.contribution_quality import resolve_verdict_band, apply_verdict_band

logger = logging.getLogger(__name__)


def issue_already_merged(issue, canonical_map: dict) -> bool:
    """True when every identity involved in an identity issue now resolves to a
    single canonical contributor — i.e. the educator has already merged these
    accounts, so the 'possible split identity / needs merge' signal is stale and
    must be hidden. `issue` may be a dict or an object exposing `author_ids`."""
    if isinstance(issue, dict):
        author_ids = issue.get("author_ids") or []
    else:
        author_ids = getattr(issue, "author_ids", None) or []
    if len(author_ids) < 2:
        return False
    c_ids = [canonical_map.get(aid) for aid in author_ids if aid in canonical_map]
    return len(c_ids) > 1 and len(set(c_ids)) == 1


def filter_unmerged_issues(issues, canonical_map: dict):
    """Return only the identity issues whose accounts have NOT already been merged.
    With an empty map (no merge info) nothing is filtered."""
    if not canonical_map:
        return list(issues or [])
    return [i for i in (issues or []) if not issue_already_merged(i, canonical_map)]


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
# AgentRouter endpoint — override via AGENTROUTER_URL env var for staging/self-hosted.
AGENTROUTER_URL: str = os.environ.get(
    "AGENTROUTER_URL",
    "https://agentrouter.org/v1/chat/completions"
)

def _build_logo_uri() -> str:
    """Generate base64 SVG data URI for the official Code Lens logo."""
    try:
        import os, base64
        svg_paths = [
            os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "templates", "code_lens_logo_light.svg"),
            os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))), "frontend", "public", "code_lens_logo_light.svg")
        ]
        for p in svg_paths:
            if os.path.exists(p):
                with open(p, "rb") as f:
                    svg_bytes = f.read()
                b64 = base64.b64encode(svg_bytes).decode("utf-8")
                return f"data:image/svg+xml;base64,{b64}"
    except OSError as e:
        logger.exception(f"Logo read error: {e}")
    return ""


def _build_charts(qual_data: Optional[dict], deadline: Optional[str] = None) -> dict:
    """
    Build matplotlib charts (Commit Distribution horizontal bar chart, Lorenz Curve, and Commit Timeline)
    as base64 PNG data URIs. Returns dict with chart URIs.
    """
    if not qual_data:
        return {}

    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import io, base64

        contributors = qual_data.get("contributors", {})
        uri_a = ""
        uri_b = ""

        if len(contributors) >= 2:
            # Chart A: Contributor Commit Share (Horizontal Bar)
            authors = list(contributors.keys())
            commits = [contributors[a]["stats"]["total_project_commits"] for a in authors]
            
            sorted_pairs = sorted(zip(commits, authors))
            sorted_commits, sorted_authors = zip(*sorted_pairs)

            fig_h = max(2.6, len(authors) * 0.42)
            fig, ax = plt.subplots(figsize=(7.2, fig_h), dpi=200)
            bars = ax.barh(sorted_authors, sorted_commits, color="#1f4268", height=0.6)
            ax.set_xlabel("Total Commits", fontsize=9, fontweight="bold", labelpad=6)
            ax.set_title("Quantitative Contributor Share", fontsize=10.5, fontweight="bold", pad=8, color="#1f4268")
            ax.tick_params(axis='both', labelsize=8.5)
            ax.grid(axis='x', linestyle="--", alpha=0.5)

            max_val = max(sorted_commits) if sorted_commits else 1
            for bar in bars:
                w = bar.get_width()
                ax.text(w + (max_val * 0.02), bar.get_y() + bar.get_height()/2, f"{int(w)}",
                        va='center', fontsize=8.5, fontweight='bold', color='#1f4268')
            
            ax.set_xlim(0, max_val * 1.15)
            plt.tight_layout()

            buf_a = io.BytesIO()
            plt.savefig(buf_a, format="png", dpi=200)
            plt.close(fig)
            buf_a.seek(0)
            uri_a = f"data:image/png;base64,{base64.b64encode(buf_a.getvalue()).decode('utf-8')}"

            # Chart B: Lorenz Curve
            sorted_c = sorted(commits)
            total_c = sum(sorted_c)
            if total_c > 0:
                n = len(sorted_c)
                cum_commits = [0] + [sum(sorted_c[:i+1]) / total_c * 100 for i in range(n)]
                cum_people = [i / n * 100 for i in range(n + 1)]

                fig2, ax2 = plt.subplots(figsize=(7.2, 3.2), dpi=200)
                ax2.plot(cum_people, cum_people, color="#9ca3af", linestyle="--", linewidth=2.0, label="Equality Line")
                ax2.plot(cum_people, cum_commits, color="#c5221f", linewidth=2.2, label="Actual Distribution")
                ax2.fill_between(cum_people, cum_commits, cum_people, color="#c5221f", alpha=0.12)
                ax2.set_xlabel("% of Team Members", fontsize=8.5, fontweight="bold")
                ax2.set_ylabel("% of Total Commits", fontsize=8.5, fontweight="bold")
                ax2.set_title("Lorenz Curve (Workload Inequality)", fontsize=10, fontweight="bold", pad=8, color="#1f4268")
                ax2.set_xlim(0, 100)
                ax2.set_ylim(0, 100)
                ax2.tick_params(axis='both', labelsize=8.5)
                ax2.legend(fontsize=7.5, loc="upper left")
                plt.tight_layout()
                buf_b = io.BytesIO()
                plt.savefig(buf_b, format="png", dpi=200)
                plt.close(fig2)
                buf_b.seek(0)
                uri_b = f"data:image/png;base64,{base64.b64encode(buf_b.getvalue()).decode('utf-8')}"

        # Chart C: Commit Activity Timeline Chart
        ps = qual_data.get("project_summary", {})
        timeline = ps.get("commit_timeline", [])
        uri_c = ""
        if timeline and len(timeline) >= 2:
            try:
                dates = [t["date"] for t in timeline]
                counts_t = [t["count"] for t in timeline]

                fig3, ax3 = plt.subplots(figsize=(7.2, 3.0), dpi=200)
                ax3.plot(dates, counts_t, color="#1f4268", marker="o", markersize=3.5, linewidth=1.5, label="Daily Commits")
                ax3.fill_between(dates, counts_t, color="#1f4268", alpha=0.12)
                ax3.set_xlabel("Date", fontsize=8.5, fontweight="bold")
                ax3.set_ylabel("Commits / Day", fontsize=8.5, fontweight="bold")
                ax3.set_title("Commit Activity Timeline & Submission Deadline", fontsize=10, fontweight="bold", pad=8, color="#1f4268")
                
                # Plot submission deadline vertical red line if deadline exists
                deadline_val = deadline or ps.get("deadline") or qual_data.get("deadline")
                if deadline_val and "Not" not in str(deadline_val):
                    try:
                        import datetime
                        if isinstance(deadline_val, (datetime.datetime, datetime.date)):
                            dl_date_str = deadline_val.strftime("%Y-%m-%d")
                        else:
                            dl_date_str = str(deadline_val).strip().split()[0].split("T")[0]

                        from datetime import datetime as dt
                        timeline_dt = [dt.strptime(d, "%Y-%m-%d") for d in dates]
                        dl_dt = dt.strptime(dl_date_str, "%Y-%m-%d")

                        if dl_date_str in dates:
                            dl_idx = dates.index(dl_date_str)
                            ax3.axvline(x=dl_idx, color="#ef4444", linestyle="--", linewidth=2.2, label=f"Deadline ({dl_date_str})", zorder=5)
                        elif dl_dt > timeline_dt[-1]:
                            # Deadline is after last commit — append deadline date to plot
                            dates.append(dl_date_str)
                            counts_t.append(0)
                            dl_idx = len(dates) - 1
                            ax3.axvline(x=dl_idx, color="#ef4444", linestyle="--", linewidth=2.2, label=f"Deadline ({dl_date_str})", zorder=5)
                        elif dl_dt < timeline_dt[0]:
                            # Deadline is before first commit
                            dates.insert(0, dl_date_str)
                            counts_t.insert(0, 0)
                            ax3.axvline(x=0, color="#ef4444", linestyle="--", linewidth=2.2, label=f"Deadline ({dl_date_str})", zorder=5)
                        else:
                            # Deadline is between dates
                            for idx in range(len(timeline_dt) - 1):
                                if timeline_dt[idx] <= dl_dt <= timeline_dt[idx+1]:
                                    ax3.axvline(x=idx + 0.5, color="#ef4444", linestyle="--", linewidth=2.2, label=f"Deadline ({dl_date_str})", zorder=5)
                                    break
                    except (ValueError, TypeError, IndexError) as dl_err:
                        logger.warning(f"Chart C deadline line warning: {dl_err}")

                if len(dates) > 10:
                    step = max(1, len(dates) // 6)
                    ax3.set_xticks(range(0, len(dates), step))
                    ax3.set_xticklabels([dates[i] for i in range(0, len(dates), step)], fontsize=7.5, rotation=25)
                else:
                    ax3.tick_params(axis='x', labelsize=7.5, rotation=25)

                ax3.tick_params(axis='y', labelsize=8.5)
                ax3.grid(True, linestyle="--", alpha=0.5, linewidth=0.8)
                ax3.legend(fontsize=7.5, loc="upper right", framealpha=0.9)
                plt.tight_layout()

                buf_c = io.BytesIO()
                plt.savefig(buf_c, format="png", dpi=200)
                plt.close(fig3)
                buf_c.seek(0)
                uri_c = f"data:image/png;base64,{base64.b64encode(buf_c.getvalue()).decode('utf-8')}"
            except Exception as chart_err:
                # Last-resort boundary to ensure matplotlib plotting errors do not crash other chart generation
                logger.exception(f"Chart C timeline generation failed: {chart_err}")

        return {"commit_bar": uri_a, "lorenz_curve": uri_b, "commit_timeline": uri_c}
    except Exception as e:
        # Last-resort boundary to ensure that any matplotlib error doesn't halt the entire report rendering
        logger.exception(f"Chart generation failed: {e}")
        return {}


def build_gemini_prompt(qual_data: dict, course_name: str, tech_requirements: Optional[str], deadline: Optional[str] = None, canonical_map: Optional[dict] = None) -> str:
    """Build a comprehensive, reader-friendly prompt for Cloud AI evaluation report."""
    project_name = qual_data.get("project_name", "Software Project")
    ps = qual_data.get("project_summary", {})
    contributors = qual_data.get("contributors", {})

    total_commits = ps.get("total_commits", 0) or 0
    sampled_commits = ps.get("sampled_commits", 0) or 0
    coverage_pct = round((sampled_commits / total_commits * 100.0), 1) if total_commits > 0 else 100.0
    low_coverage_warning = (coverage_pct < 25.0) or (sampled_commits < total_commits)
    
    identity_analysis = ps.get("identity_analysis") or {}
    has_proxy = bool(identity_analysis.get("has_proxy_committers") or ps.get("has_proxy_committers"))
    is_single_contributor = False if has_proxy else identity_analysis.get("is_solo_project", len(contributors) <= 1)
    raw_id_count = identity_analysis.get("raw_identity_count", len(contributors))
    canonical_count = identity_analysis.get("canonical_contributor_count", len(contributors))
    
    # Hide identity anomalies for accounts the educator has already merged.
    # `canonical_map` (raw author id -> canonical root id) is supplied live by the
    # caller; with no map, nothing is filtered.
    canonical_map = canonical_map or {}
    suspected_split = filter_unmerged_issues(identity_analysis.get("suspected_same_person", []), canonical_map)
    shared_accs = filter_unmerged_issues(identity_analysis.get("shared_accounts", []), canonical_map)
    pushed_by_other = filter_unmerged_issues(identity_analysis.get("pushed_by_other", []), canonical_map)

    identity_lines = []
    if is_single_contributor:
        identity_lines.append(f"  - Solo Project Status: Single Contributor ({raw_id_count} Git identities -> 1 resolved contributor)")
    else:
        identity_lines.append(f"  - Multi-Contributor Project Status: {raw_id_count} Git identities -> {canonical_count} canonical contributors")

    if suspected_split:
        identity_lines.append("  - Suspected Split Identities (Possible Same Person):")
        for issue in suspected_split:
            members_str = " <-> ".join(issue.get("members", []))
            ev_str = "; ".join(issue.get("evidence", []))
            conf = issue.get("confidence", "MEDIUM")
            identity_lines.append(f"    * [{conf} CONFIDENCE] {members_str}: {ev_str}")

    if shared_accs:
        identity_lines.append("  - Shared Account Anomalies:")
        for issue in shared_accs:
            members_str = ", ".join(issue.get("members", []))
            ev_str = "; ".join(issue.get("evidence", []))
            identity_lines.append(f"    * {members_str}: {ev_str}")

    if pushed_by_other:
        identity_lines.append("  - Committer / Proxy Push Divergence:")
        for issue in pushed_by_other:
            members_str = ", ".join(issue.get("members", []))
            ev_str = "; ".join(issue.get("evidence", []))
            identity_lines.append(f"    * {members_str}: {ev_str}")

    proxy_committers = identity_analysis.get("proxy_committers", [])
    if proxy_committers:
        identity_lines.append("  - Proxy Committer & Co-Author Discrepancies:")
        for issue in proxy_committers:
            members_str = ", ".join(issue.get("members", []))
            ev_str = "; ".join(issue.get("evidence", []))
            conf = issue.get("confidence", "HIGH")
            identity_lines.append(f"    * [{conf} CONFIDENCE] {members_str}: {ev_str}")

    identity_block = "\n".join(identity_lines) if identity_lines else "  No identity anomalies detected."

    effective_deadline = deadline or ps.get("deadline")
    is_deadline_configured = bool(effective_deadline and effective_deadline != "Not specified")

    zero_sampled_contributors = []
    contributor_lines = []
    # Team-average share, for the LLM to reason about under-contribution.
    num_contributors = len(contributors) if contributors else 1
    expected_share_pct = round(100.0 / num_contributors, 1) if num_contributors else 100.0
    for name, cdata in contributors.items():
        stats = cdata.get("stats", cdata)
        tot_commits = stats.get("total_project_commits", "?")
        sampled = stats.get("sampled_commits", 0)
        if sampled == 0:
            zero_sampled_contributors.append(name)
        late = stats.get("late_commits", 0)
        near = stats.get("commits_near_deadline", 0)
        pattern = stats.get("timing_pattern", "unknown")
        quality = stats.get("ai_quality_score", 0)
        substance = stats.get("substance_distribution", {})
        vague_pct = stats.get("vague_message_percentage", 0)
        mismatch_pct = stats.get("message_mismatch_percentage", stats.get("message_diff_mismatch_percentage", 0))

        # Contribution-share + free-rider signal (code-derived, so the LLM's prose
        # reason and its verdict prefix line up with the metrics shown elsewhere).
        score_unverified = bool(stats.get("score_unverified", False))
        free_rider = bool(stats.get("free_rider_suspected", False))
        commit_share_pct = stats.get("commit_share_percentage", 0)
        loc_share_pct = stats.get("loc_share_percentage", 0)
        detected_flags = [f for f in (stats.get("detected_red_flags") or []) if f and str(f).lower() != "none"]
        flags_str = "; ".join(detected_flags) if detected_flags else "None"
        quality_score_display = "Unverified (too few analyzed commits)" if score_unverified else f"{quality}/10"
        
        ownership = stats.get('ownership_areas', [])
        ownership_str = ", ".join(ownership) if ownership else "Unknown"

        # Specific files/modules the person actually changed (code-derived
        # evidence, not just the top folder). Bounded to keep the prompt compact.
        top_files = stats.get('top_files_detail', []) or []
        files_detail_parts = []
        for f in top_files[:5]:
            if not isinstance(f, dict):
                continue
            fname = str(f.get('file', '')).strip()
            if not fname:
                continue
            ch = int(f.get('changes', 0) or 0)
            cx = int(f.get('complexity', 0) or 0)
            seg = f"{fname} ({ch} edit{'s' if ch != 1 else ''}"
            if cx:
                seg += f", complexity {cx}"
            seg += ")"
            files_detail_parts.append(seg)
        files_detail_str = "; ".join(files_detail_parts) if files_detail_parts else "Not available"

        examples = cdata.get('examples', {})
        substantial = examples.get('substantial_commits', [])
        key_commits = " | ".join([e.get('message', '').strip() for e in substantial]) if substantial else "None sampled"

        # What their changes did — prefer the local model's per-commit notes
        # (derived from the diff); fall back to the first line of the message.
        did_parts = []
        for e in substantial[:3]:
            if not isinstance(e, dict):
                continue
            note = (e.get('notes') or '').strip()
            raw_msg = (e.get('message') or '').strip()
            msg = raw_msg.splitlines()[0].strip() if raw_msg else ''
            text = note or msg
            if not text:
                continue
            if len(text) > 140:
                text = text[:137] + "..."
            did_parts.append(text)
        did_str = " | ".join(did_parts) if did_parts else "No per-commit detail sampled"

        # Dominant code-quality signals from the already-computed distributions.
        quality_signals = []
        for dist in (
            stats.get('code_smell_distribution', {}) or {},
            stats.get('architecture_issue_distribution', {}) or {},
        ):
            if not isinstance(dist, dict):
                continue
            for label, cnt in sorted(dist.items(), key=lambda kv: kv[1] or 0, reverse=True):
                if label and str(label).lower() not in ("none", "n/a", "") and cnt:
                    quality_signals.append(f"{label} x{int(cnt)}")
        quality_str = ", ".join(quality_signals[:4]) if quality_signals else "None flagged"

        contributor_lines.append(
            f"  - Contributor: {name}\n"
            f"    * Total Commits: {tot_commits} (Sampled Analyzed: {sampled})\n"
            f"    * Contribution Share: {commit_share_pct}% of commits, {loc_share_pct}% of lines (team average ~{expected_share_pct}%)\n"
            f"    * Free-Rider Flag: {'YES - under-contributing vs the team average' if free_rider else 'No'}\n"
            f"    * Quality Score: {quality_score_display} | Pacing: {pattern}\n"
            f"    * Detected Red Flags: {flags_str}\n"
            f"    * Code Ownership Areas: {ownership_str}\n"
            f"    * Files & Modules Changed: {files_detail_str}\n"
            f"    * What Their Changes Did: {did_str}\n"
            f"    * Key Substantial Commits: {key_commits}\n"
            f"    * Code Quality Signals: {quality_str}\n"
            f"    * Substance Breakdown: Substantial={substance.get('substantial', 0)}, Moderate={substance.get('moderate', 0)}, Trivial={substance.get('trivial', 0)}\n"
            f"    * Quality Flags: Vague Messages={vague_pct}%, Message-Diff Mismatch={mismatch_pct}%\n"
            f"    * Deadline Flags: Late Commits={late}, Near-Deadline Commits={near}"
        )

    contributors_block = "\n\n".join(contributor_lines) if contributor_lines else "  No contributor data."

    red_flags = ps.get("red_flags", [])
    red_flags_block = "\n".join(f"  - {f}" for f in red_flags) if red_flags else "  None"
    resurrection_flags = ps.get("code_resurrection_flags", [])
    resurrection_block = (
        "\n".join(f"  - Author {r.get('author', '?')}: {r.get('reason', '')}" for r in resurrection_flags)
        if resurrection_flags else "  None"
    )

    tech_block = f"\nExpected Tech Stack: {tech_requirements}" if tech_requirements else ""
    deadline_block = f"\nCourse Submission Deadline: {effective_deadline if is_deadline_configured else 'Not specified (Pacing not tracked)'}"

    # Read Gini from project_summary — always populated by get_qualitative_analysis.
    # Do not re-compute here; get_qualitative_analysis is the single source of truth.
    gini_coeff = ps.get("gini_coefficient", "N/A")
    if is_single_contributor:
        gini_coeff = "N/A (Single Contributor Project)"

    zero_sampled_block = ", ".join(zero_sampled_contributors) if zero_sampled_contributors else "None"

    plag_summary = ps.get("plagiarism_summary", {})
    plagiarism_block = ""
    if plag_summary.get("has_scan"):
        status = plag_summary.get("status", "")
        # Only include if the alert is not explicitly resolved/dismissed
        if status.lower() not in RESOLVED_PLAGIARISM_STATUSES:
            max_sim = plag_summary.get("max_similarity_score", 0)
            target = plag_summary.get("matched_project_name", "Unknown Project")
            blocks = plag_summary.get("matched_blocks_count", 0)
            plagiarism_block = (
                f"\n=== PLAGIARISM / CODE SIMILARITY ALERT ===\n"
                f"  - Status: {status} (Unresolved)\n"
                f"  - Max Similarity Score: {max_sim}%\n"
                f"  - Matched Project: {target} ({blocks} shared AST blocks)\n"
            )

    prompt = f"""You are a senior academic integrity and software engineering assessment officer.

Your task is to analyze the provided commit activity payload for a student software project and produce a **highly readable, executive-ready, student-by-student evaluation report** for the university course lecturer.

=== PRE-COMPUTED EVALUATION CONTEXT & FLAGS ===
- Total Project Commits: {total_commits} | Sampled Analyzed Commits: {sampled_commits}
- Analysis Coverage: {coverage_pct}%
- Low Coverage Warning Flag: {low_coverage_warning} (Coverage < 25% or partial sampling)
- Single Contributor Project: {is_single_contributor}
- Deadline Configured: {is_deadline_configured}
- Contributors with 0 Sampled Commits: {zero_sampled_block}

=== CONTRIBUTOR IDENTITY & AUTHENTICITY SIGNALS ===
{identity_block}

=== CALIBRATION & HONESTY RULES (STRICT COMPLIANCE REQUIRED) ===
1. ABSENCE OF SAMPLED EVIDENCE IS NOT CLEARANCE: Never report unsampled contributors or unsampled commits as "verified clean" nor as "misconduct". Nor report missing sample data as evidence of misconduct. State unanalyzed work clearly as "Unverified (0 commits sampled)".
2. PROVISIONAL CONCLUSIONS ON LOW COVERAGE: When Low Coverage Warning Flag is True, state all project-level and student-level conclusions as provisional pending further commit sampling.
3. SINGLE CONTRIBUTOR GINI RULE: If Single Contributor Project is True, Gini inequality coefficient is NOT APPLICABLE. Never describe a single contributor project as having "balanced teamwork" or "equal distribution". State that single contributor status means workload distribution is not evaluated.
4. NO DEADLINE RULE: If Deadline Configured is False, do NOT praise or criticize submission pacing or deadline compliance. State explicitly: "Pacing not tracked (no deadline configured)".
5. ZERO HALLUCINATED METRICS: Do not invent any numbers, commit counts, or percentages not present in the payload.
6. CONTRIBUTOR AUTHENTICITY & SPLIT IDENTITIES: Name similarity, matching usernames, and shared accounts are DECISION-SUPPORT SIGNALS, NOT PROOF of wrongdoing. Never assert academic misconduct from identity signals alone; state findings objectively as "possible split identity detected, requires lecturer verification".
7. SOLO PROJECT WORKLOAD RULE: If Single Contributor Project is True (or is_solo_project is True) AND there are NO proxy committers, explicitly state: "Single-contributor submission — NOT a group project; work distribution and teamwork metrics are not applicable (N/A)."
8. PROXY COMMITTER & CO-AUTHOR RULE: If Proxy Committer Discrepancies are flagged or a student has 0 direct commits and is flagged as a co-author, evaluate that student's verdict as "Unverified (Co-author, 0 direct commits pushed)". Explicitly note that they were acknowledged via Git 'Co-authored-by' metadata but pushed 0 standalone commits, requiring educator interview. Never assert misconduct, but clearly flag extreme workload disparity.

=== PROJECT & COURSE CONTEXT ===
Course: {course_name}
Project: {project_name}{tech_block}{deadline_block}
Sampling Mode: {ps.get('sampling_mode', 'sample')} ({sampled_commits} of {total_commits} total commits analyzed)
Date Range: {ps.get('date_range', 'N/A')}
{plagiarism_block}
=== AGGREGATED METRICS & SIGNALS ===
- Work Pacing Pattern: {ps.get('overall_pacing', 'N/A') if is_deadline_configured else 'Pacing not tracked (no deadline configured)'}
- Gini Inequality Coefficient: {gini_coeff}
- Language Distribution: {json.dumps(ps.get('language_distribution', {}))}
- Folder Structure & Modularity: {json.dumps(ps.get('folder_structure', {}))}
- README & Documentation Quality: {json.dumps(ps.get('readme_quality', {}))}
- Peer Review Summary: {json.dumps(ps.get('peer_review_summary', {}))}
- Detected Code Smells: {json.dumps(ps.get('code_smell_distribution', {}))}
- Detected Architecture Issues: {json.dumps(ps.get('architecture_issue_distribution', {}))}
- Commit Type Distribution: {json.dumps(ps.get('type_distribution', {}))}
- Substance Breakdown: {json.dumps(ps.get('substance_distribution', {}))}
- Substantial-to-Trivial Ratio: {ps.get('substantial_to_trivial_ratio', 'N/A')}
- Vague Commit Message Rate: {ps.get('vague_message_percentage', 0)}%
- Message-Diff Mismatch Rate: {ps.get('message_mismatch_percentage', ps.get('message_diff_mismatch_percentage', 0))}%
- Security Risk Commits: {ps.get('security_risk_commits', 0)}
- Late Commits (Post-Deadline): {ps.get('commits_after_deadline', 0) if is_deadline_configured else 0}
- Near-Deadline Commits (within 48h): {ps.get('commits_within_48h_of_deadline', 0) if is_deadline_configured else 0}

=== DETECTED RED FLAGS ===
{red_flags_block}

=== POTENTIAL CODE RESURRECTION & OWNERSHIP TRANSFERS ===
{resurrection_block}

=== INDIVIDUAL CONTRIBUTOR STATS ===
{contributors_block}

=== OUTPUT FORMAT INSTRUCTIONS ===
You must respond with ONLY valid, parseable JSON. Do not include markdown code blocks (like ```json), just the raw JSON object.
The JSON must strictly conform to the following schema:

{{
  "executive_summary": "3-4 sentence overview of project health, collaboration, pacing, and overall quality. No emojis.",
  "work_distribution_and_fairness": "Explain the Gini coefficient and pacing in plain language. If single contributor, state that teamwork metrics are N/A. No emojis.",
  "student_evaluations": [
    {{
      "student_name": "Name",
      "commits_summary": "TERSE table phrase (~12 words max, e.g., '34 total (4 sampled)')",
      "contribution_areas": "2-4 concrete sentences describing what THIS student actually built, grounded in their 'Files & Modules Changed', 'What Their Changes Did', and 'Code Ownership Areas'. You MUST cite specific files or modules by name and say what was implemented in them (e.g., 'Built the auth layer in src/auth/login.py and session_manager.py — added token refresh and two login endpoints; also refactored the API router in routers.py.'). FORBIDDEN: generic filler such as 'worked on the frontend', 'contributed to the project', or 'made various changes' — every sentence must reference a concrete file, module, or feature from the evidence. If no file evidence is available, summarize concretely from the Key Substantial Commits instead. No emojis.",
      "substance_breakdown": "TERSE table phrase (~12 words max, e.g., 'Substantial: 2, Moderate: 2, Trivial: 0')",
      "pacing_and_deadlines": "TERSE table phrase (~12 words max, e.g., 'Pacing not tracked (no deadline)')",
      "quality_and_integrity_signals": "TERSE table phrase (~12 words max, e.g., '0% vague, 0% mismatch, Quality 10/10')",
      "verdict": "MUST start with EXACTLY 'High Quality - ', 'Moderate Quality - ', 'Poor Quality - ', or 'Unverified - ', followed by a 1-sentence reason. Use 'Unverified - ' only for contributors whose Quality Score is shown as Unverified (too few analyzed commits). No emojis."
    }}
  ],
  "academic_integrity_anomalies": "Detail any red flags, code resurrection cases, sudden dumps, and MUST explicitly detail any PLAGIARISM / CODE SIMILARITY ALERTS if present. No emojis.",
  "contributor_authenticity": "1-2 sentences summarizing contributor identity authenticity and whether any split identities or shared accounts were flagged. If none or single contributor, state cleanly. No emojis.",
  "overall_project_quality_score": "Score from 0/10 to 10/10 with a bold justification. No emojis.",
  "actionable_recommendations": [
    "Recommendation 1",
    "Recommendation 2",
    "Recommendation 3"
  ]
}}

STRICT TABLE CELL CONSTRAINT:
The fields `commits_summary`, `substance_breakdown`, `pacing_and_deadlines`, and `quality_and_integrity_signals` inside `student_evaluations` MUST be short, terse table-cell phrases (~12 words max each). Put all long narrative explanations only in `executive_summary`, `work_distribution_and_fairness`, and `academic_integrity_anomalies`.

VERDICT PREFIX REQUIREMENT:
Every student `verdict` MUST start with EXACTLY one of the following prefixes (Quality wording; higher = better):
- `High Quality - ` (strong, balanced, clean contribution)
- `Moderate Quality - ` (some contribution or quality concerns; use this for suspected free-riders who still have analyzed work)
- `Poor Quality - ` (serious contribution or quality concerns)
- `Unverified - ` (too few analyzed commits to assess — the contributors whose Quality Score reads "Unverified")
Do NOT use "Risk" wording. A contributor whose Free-Rider Flag is YES must NOT be labelled 'High Quality'.

Ensure every student in the contributor stats is represented as a row in the `student_evaluations` array.
Use clear language. Do not use any emojis anywhere in the output."""

    return prompt


def _call_agentrouter_api(prompt: str, api_key: str, meta: Optional[dict] = None) -> str:
    import json
    import urllib.request
    import urllib.error

    # DATA EGRESS: sends evaluation prompt + decrypted API key to AGENTROUTER_URL.
    # See module-level EGRESS NOTICE for full details.
    url = AGENTROUTER_URL

    models_to_try = [
        "claude-opus-4-8",
        "claude-opus-5",
        "gpt-5.6-sol",
        "claude-3-5-sonnet-20241022",
        "claude-3-5-sonnet",
        "gpt-4o",
        "gpt-4o-mini"
    ]

    last_err = None
    last_exc = None
    no_channel_count = 0
    for idx, model in enumerate(models_to_try, 1):
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": "You are a senior academic integrity and software engineering assessment officer."},
                {"role": "user", "content": prompt}
            ],
            "temperature": 0.35,
            "max_tokens": 4096
        }
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key.strip()}",
                "User-Agent": "CodeLens-Backend/1.0"
            },
            method="POST"
        )
        try:
            import time
            start_t = time.time()
            with urllib.request.urlopen(req, timeout=60) as resp:
                elapsed = round(time.time() - start_t, 2)
                raw_bytes = resp.read()
                print(f"[CLOUD-REPORT-LOG] [AGENTROUTER] Model '{model}' SUCCESS (HTTP {resp.status}, took {elapsed}s). Response size: {len(raw_bytes)} bytes.")
                result = json.loads(raw_bytes.decode("utf-8"))
                choices = result.get("choices", [])
                if choices and choices[0].get("message", {}).get("content"):
                    text_content = choices[0]["message"]["content"]
                    print(f"[CLOUD-REPORT-LOG] [AGENTROUTER] Successfully extracted text content ({len(text_content)} chars).")
                    if meta is not None:
                        meta["provider"] = "AgentRouter (Claude / GPT)"
                        meta["model"] = model
                    return text_content
                else:
                    print(f"[CLOUD-REPORT-LOG] [AGENTROUTER] Warning: Model '{model}' returned empty choices or message content.")
        except urllib.error.HTTPError as e:
            last_exc = e
            err_body = e.read().decode("utf-8", errors="ignore")
            logger.warning(f"Model '{model}' FAILED with HTTP {e.code}: {err_body[:200]}")
            if e.code in (401, 403):
                raise ValueError(f"AgentRouter Auth Error (HTTP {e.code}): Invalid API key or token expired.") from e
            if e.code == 429:
                raise ValueError(f"AgentRouter Quota Exceeded (HTTP 429): Token balance exhausted.") from e
            if e.code == 503 and ("无可用渠道" in err_body or "channel" in err_body.lower()):
                no_channel_count += 1
                last_err = f"Model {model} has no active channel on AgentRouter."
                continue
            last_err = f"Model {model} failed (HTTP {e.code}): {err_body}"
        except (urllib.error.URLError, ConnectionError, TimeoutError, json.JSONDecodeError, ValueError) as e:
            last_exc = e
            logger.exception(f"Exception for model '{model}': {e}")
            last_err = str(e)

    if no_channel_count == len(models_to_try):
        print(f"[CLOUD-REPORT-LOG] [AGENTROUTER] Error: All {len(models_to_try)} models returned 503 (no channel).")
        raise ValueError("AgentRouter error: No active routing channels available for the selected models. Please try again later.")

    logger.error(f"All model attempts failed. Last error: {last_err}")
    if last_exc:
        raise RuntimeError(f"AgentRouter API error: {last_err or 'Failed to get completion.'}") from last_exc
    else:
        raise RuntimeError(f"AgentRouter API error: {last_err or 'Failed to get completion.'}")


def generate_cloud_report(qual_data: dict, api_key: str, course_name: str, tech_requirements: Optional[str] = None, deadline: Optional[str] = None, canonical_map: Optional[dict] = None):
    """
    Call Cloud AI (AgentRouter Claude / GPT or Google Gemini) with the qualitative analysis data and return the parsed Pydantic model.
    """
    from src.domain.entities import CloudReportEntity, IdentityIssueEntity, StudentReportEntity
    import re
    
    clean_key = api_key.strip()
    provider_type = "AgentRouter" if clean_key.startswith("sk-") else "Google Gemini"

    # Records the provider + exact model that actually served the request, so the
    # report can state its real method instead of a hardcoded guess. Populated by
    # _call_model / _call_agentrouter_api on the successful attempt.
    call_meta: dict = {}

    prompt = build_gemini_prompt(qual_data, course_name, tech_requirements, deadline=deadline, canonical_map=canonical_map)
    logger.info(f"Built prompt successfully ({len(prompt)} characters).")

    def _clean_json_output(text: str) -> str:
        text = text.strip()
        # Use regex to extract the exact JSON block between { and } 
        # to bypass any conversational preamble or backticks entirely.
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            return match.group(0)
        return text

    def _call_model() -> str:
        if clean_key.startswith("sk-"):
            print("[CLOUD-REPORT-LOG] [USE-CASE] Key starts with 'sk-', routing request to AgentRouter API handler.")
            return _call_agentrouter_api(prompt, clean_key, call_meta)

        logger.info("Key is Google Gemini style. Initializing google.generativeai...")
        try:
            import google.generativeai as genai
        except ImportError:
            logger.error("ERROR: google-generativeai package not installed.")
            raise RuntimeError("google-generativeai package not installed. Run: pip install google-generativeai")

        genai.configure(api_key=clean_key)
        model_candidates = [
            "gemini-2.0-flash",
            "gemini-2.0-flash-lite",
            "gemini-1.5-flash-latest",
            "gemini-1.5-pro-latest",
            "gemma-4-26b-a4b-it",
            GEMINI_MODEL,
            "gemini-2.5-pro",
            "gemini-1.5-flash",
            "gemini-1.5-pro"
        ]

        last_error = None
        last_exc = None
        quota_error = None
        for idx, model_name in enumerate(model_candidates, 1):
            logger.info(f"Attempt {idx}/{len(model_candidates)}: Calling model '{model_name}'...")
            try:
                model = genai.GenerativeModel(model_name)
                response = model.generate_content(
                    prompt,
                    generation_config=genai.GenerationConfig(
                        temperature=0.35,
                        max_output_tokens=4096,
                        response_mime_type="application/json",
                    )
                )
                if response and response.text:
                    print(f"[CLOUD-REPORT-LOG] [GEMINI] Model '{model_name}' SUCCESS. Returned {len(response.text)} characters.")
                    call_meta["provider"] = "Google Gemini"
                    call_meta["model"] = model_name
                    return response.text
                else:
                    logger.warning(f"Model '{model_name}' returned empty response text.")
            except (GoogleAPIError, ConnectionError, TimeoutError, ValueError) as e:
                last_exc = e
                error_msg = str(e)
                logger.warning(f"Model '{model_name}' FAILED: {error_msg[:200]}")
                if "API_KEY_INVALID" in error_msg or "API key not valid" in error_msg or ("400" in error_msg and "key" in error_msg.lower()):
                    raise ValueError("Invalid Gemini API key. Please update your key in Settings.") from e
                if "QUOTA_EXCEEDED" in error_msg or "quota" in error_msg.lower() or "429" in error_msg:
                    quota_error = "Gemini API quota exceeded (HTTP 429). Please check your Google AI Studio quota or switch to an active key."
                    continue
                last_error = error_msg

        if quota_error:
            logger.warning("Raising quota exceeded exception.")
            if last_exc:
                raise ValueError(quota_error) from last_exc
            else:
                raise ValueError(quota_error)

        logger.error(f"All Gemini candidates failed. Last error: {last_error}")
        if last_exc:
            raise RuntimeError(f"Cloud AI API error: {last_error or 'All model candidates failed.'}") from last_exc
        else:
            raise RuntimeError(f"Cloud AI API error: {last_error or 'All model candidates failed.'}")

    last_parse_error = None
    for attempt in range(1, 4):
        logger.info(f"Cloud AI LLM call attempt {attempt}/3...")
        raw_output = _call_model()
        cleaned_json = _clean_json_output(raw_output)
        print(f"[CLOUD-REPORT-LOG] [USE-CASE] Attempt {attempt}: Received raw output. Cleaned JSON length: {len(cleaned_json)} chars.")
        try:
            parsed_data = json.loads(cleaned_json)
            report_data = CloudReportEntity.from_dict(parsed_data)
            report_data.generation_provider = call_meta.get("provider")
            report_data.generation_model = call_meta.get("model")

            # Populate identity signals metadata from qual_data if available
            ps = qual_data.get("project_summary", {}) if qual_data else {}
            ia = ps.get("identity_analysis") or {}
            if report_data.is_solo_project is None:
                report_data.is_solo_project = ia.get("is_solo_project", len(qual_data.get("contributors", {})) <= 1 if qual_data else False)

            if not report_data.suspected_identity_issues:
                all_issues = ia.get("all_issues", [])
                if all_issues:
                    report_data.suspected_identity_issues = [
                        IdentityIssueEntity(**issue) if isinstance(issue, dict) else issue
                        for issue in filter_unmerged_issues(all_issues, canonical_map or {})
                    ]

            # Reconcile each per-student verdict against the computed metrics, so the
            # categorical label can never contradict the free-rider flag / quality score
            # shown elsewhere in the report. The LLM only authors the prose reason; the
            # band (High/Moderate/Poor/Unverified Quality) is decided in pure domain code.
            if report_data.student_evaluations and qual_data:
                contrib_lookup = {}
                for c_key, c_data in (qual_data.get("contributors", {}) or {}).items():
                    c_stats = c_data.get("stats", c_data) if isinstance(c_data, dict) else {}
                    aliases = [c_key]
                    if isinstance(c_data, dict):
                        aliases.append(c_data.get("author_name"))
                    for alias in aliases:
                        if alias:
                            contrib_lookup[str(alias).strip().lower()] = c_stats
                for row in report_data.student_evaluations:
                    name_key = str(row.student_name or "").strip().lower()
                    c_stats = contrib_lookup.get(name_key)
                    if c_stats is None and " (" in name_key:
                        # collision key like "name (email)" — fall back to the bare name
                        c_stats = contrib_lookup.get(name_key.split(" (", 1)[0].strip())
                    if not isinstance(c_stats, dict) or not c_stats:
                        continue
                    band = resolve_verdict_band(
                        quality_score=int(c_stats.get("ai_quality_score", 0) or 0),
                        free_rider_suspected=bool(c_stats.get("free_rider_suspected", False)),
                        score_unverified=bool(c_stats.get("score_unverified", False)),
                    )
                    row.verdict = apply_verdict_band(row.verdict, band)

                # Ensure non-committing co-authors are represented in student_evaluations
                existing_names = {str(row.student_name or "").strip().lower() for row in report_data.student_evaluations}
                for c_key, c_data in (qual_data.get("contributors", {}) or {}).items():
                    if isinstance(c_data, dict) and c_data.get("is_co_author_only"):
                        c_name = c_data.get("author_name") or c_key
                        if c_name.strip().lower() not in existing_names:
                            from src.domain.entities import StudentReportEntity
                            report_data.student_evaluations.append(
                                StudentReportEntity(
                                    student_name=c_name,
                                    commits_summary="0 commits (Co-author)",
                                    substance_breakdown="0 direct changes",
                                    pacing_and_deadlines="No commits pushed",
                                    quality_and_integrity_signals="Proxy committer: tagged via Co-authored-by in commit messages",
                                    contribution_areas="None (code proxy-committed)",
                                    verdict="Unverified (Co-author, 0 direct commits pushed)"
                                )
                            )

            print(f"[CLOUD-REPORT-LOG] [USE-CASE] Attempt {attempt}: Successfully validated Pydantic CloudReportData model!")
            return report_data
        except (json.JSONDecodeError, ValidationError) as e:
            print(f"[CLOUD-REPORT-LOG] [USE-CASE] Attempt {attempt}: JSON/Pydantic validation failed: {type(e).__name__}: {str(e)}")
            last_parse_error = e
            continue
            
    logger.error("ERROR: All 3 parse attempts failed.")
    raise RuntimeError(f"Cloud AI failed to return valid JSON after 3 attempts. Last error: {last_parse_error}") from last_parse_error


def _contrib_summary_filter(cdata, llm_value=None):
    """Contribution Summary cell for the ownership table. Prefer the cloud
    LLM's narrative; when it is missing or a placeholder ('N/A', 'No narrative
    summary generated.'), synthesize a deterministic sentence from the
    contributor's code-derived evidence — the specific files they changed
    (``top_files_detail``), what their commits did (per-commit ``notes``,
    falling back to messages), and their substance mix — so the cell is never
    blank/'N/A' and names real files even without the cloud LLM. Runs at
    render time, so it also enriches already-cached reports without
    re-invoking the cloud LLM.

    Module-level (closes over nothing but its args + stdlib) so it can be
    unit-tested directly; registered as the ``contrib_summary`` Jinja filter
    inside :func:`render_pdf_report`.
    """
    v = (llm_value or "").strip()
    if v and v.lower() not in ("n/a", "na", "none", "no narrative summary generated."):
        return v
    stats = cdata.get("stats", cdata) if isinstance(cdata, dict) else {}
    examples = cdata.get("examples", {}) if isinstance(cdata, dict) else {}
    areas = stats.get("ownership_areas") or []
    top_files = stats.get("top_files_detail") or []
    substantial = examples.get("substantial_commits") or []
    parts = []

    # Prefer the specific files changed (code-derived) over the bare folder.
    file_segs = []
    for f in top_files[:4]:
        if not isinstance(f, dict):
            continue
        fname = str(f.get("file", "")).strip()
        if not fname:
            continue
        ch = int(f.get("changes", 0) or 0)
        file_segs.append(f"{fname} ({ch} edit{'s' if ch != 1 else ''})" if ch else fname)
    if file_segs:
        parts.append("Changed " + ", ".join(file_segs))
    elif areas:
        pretty = ", ".join((a + "/") if a != "(root)" else a for a in areas[:4])
        parts.append(f"Worked mainly in {pretty}")

    # What those changes did — prefer per-commit notes, fall back to messages.
    did = []
    for e in substantial[:3]:
        if not isinstance(e, dict):
            continue
        note = (e.get("notes") or "").strip()
        raw_msg = (e.get("message") or "").strip()
        msg = raw_msg.splitlines()[0].strip() if raw_msg else ""
        text = note or msg
        if text:
            did.append(text if len(text) <= 80 else text[:77] + "...")
    if did:
        parts.append("including " + "; ".join(did))

    # Compact substance tail.
    sub = stats.get("substance_distribution") or {}
    s_cnt = sub.get("substantial", 0) if isinstance(sub, dict) else 0
    if s_cnt:
        parts.append(f"{s_cnt} substantial commit{'s' if s_cnt != 1 else ''} sampled")

    if parts:
        text = "; ".join(parts)
        text = text[0].upper() + text[1:] + "."
    else:
        tot = stats.get("total_project_commits")
        text = (f"Limited sampled detail ({tot} commit(s) recorded; see contribution share above)."
                if tot else "No sampled contribution detail available.")
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def render_pdf_report(
    report_data,
    course_name: str,
    project_name: str,
    date: str,
    qual_data: Optional[dict] = None,
    group_no: Optional[str] = None,
    lecturer_name: Optional[str] = None,
    git_url: Optional[str] = None,
    deadline: Optional[str] = None,
    canonical_map: Optional[dict] = None
) -> bytes:
    """Render the parsed Pydantic model to a PDF using Jinja2 and xhtml2pdf (pure Python)."""
    from jinja2 import Environment, FileSystemLoader
    from xhtml2pdf import pisa
    from io import BytesIO
    import markdown as md
    import os
    import re

    # Hide identity anomaly / "needs merge" suggestions for accounts already
    # merged in the DB. Merge only sets canonical_author_id and does NOT
    # regenerate cached reports, so a cached report_data / qual_data can still
    # carry stale issues — filter against the live canonical map at render time.
    if canonical_map:
        if getattr(report_data, "suspected_identity_issues", None):
            report_data.suspected_identity_issues = filter_unmerged_issues(
                report_data.suspected_identity_issues, canonical_map
            )
        try:
            _ia = (qual_data or {}).get("project_summary", {}).get("identity_analysis")
            if _ia and _ia.get("all_issues"):
                _ia["all_issues"] = filter_unmerged_issues(_ia["all_issues"], canonical_map)
        except (AttributeError, TypeError):
            pass
    
    # Fallback for empty or placeholder course / project names
    clean_course = (course_name or "").strip()
    if not clean_course or clean_course in ("Unknown Course", "Course Name"):
        clean_course = "General Course"
        
    clean_project = (project_name or "").strip()
    if not clean_project or clean_project in ("Unknown Project", "Project Name"):
        clean_project = "Software Project Submission"
        
    # Sort student evaluations so High Quality is at top (rank 1), Moderate Quality middle (rank 2), Poor Quality bottom (rank 3)
    def _quality_rank(item):
        v = ""
        name = ""
        if isinstance(item, dict):
            v = str(item.get("verdict", "") or "")
            name = str(item.get("student_name", "") or "")
        else:
            v = str(getattr(item, "verdict", "") or "")
            name = str(getattr(item, "student_name", "") or "")
        v_lower = v.lower()
        # rank 1 = best (top). "low risk" is legacy wording for a good contributor;
        # "high risk"/"poor"/"unverified" fall through to rank 3 (bottom).
        if "high quality" in v_lower or "low risk" in v_lower or "strong" in v_lower or "solid" in v_lower or "good" in v_lower:
            r = 1
        elif "moderate" in v_lower or "medium" in v_lower or "fair" in v_lower or "minor" in v_lower:
            r = 2
        else:
            r = 3
        return (r, name)

    if hasattr(report_data, "student_evaluations") and report_data.student_evaluations:
        try:
            report_data.student_evaluations = sorted(report_data.student_evaluations, key=_quality_rank)
        except (TypeError, AttributeError) as e:
            logger.warning(f"Warning sorting student_evaluations: {e}")

    charts = _build_charts(qual_data, deadline=deadline) if qual_data else {}
    logo_uri = _build_logo_uri()
    
    templates_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "templates")
    env = Environment(loader=FileSystemLoader(templates_dir))
    
    def md_filter(text):
        return md.markdown(str(text) or "", extensions=["extra"])
        
    def verdict_style(verdict_text):
        v = (verdict_text or "").strip().lower()
        green = "background-color: #e6f4ea; color: #137333; font-weight: bold;"
        amber = "background-color: #fef7e0; color: #b06000; font-weight: bold;"
        red = "background-color: #fce8e6; color: #c5221f; font-weight: bold;"
        gray = "background-color: #f8f9fa; color: #3c4043;"
        # Quality wording (current; higher = better).
        if v.startswith("high quality"):
            return green
        if v.startswith("moderate quality"):
            return amber
        if v.startswith("poor quality"):
            return red
        if v.startswith("unverified"):
            return gray
        # Legacy Risk wording (older cached reports, opposite polarity): Low Risk = good.
        if v.startswith("low risk"):
            return green
        if v.startswith("moderate risk"):
            return amber
        if v.startswith("high risk"):
            return red
        return gray
        
    colors = ['#0284c7', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#374151']
    def lang_color_filter(idx):
        try:
            return colors[int(idx) % len(colors)]
        except (ValueError, TypeError, IndexError) as e:
            logger.warning(f"Error resolving language color index '{idx}': {e}")
            return '#0284c7'

    # Shared severity palette — xhtml2pdf-safe inline style strings reused by the
    # scorecard cells, the coverage / reliability banners, and callout boxes.
    _SEV = {
        "ok":     "background-color: #e6f4ea; border: 1px solid #ceedd5; color: #137333;",
        "warn":   "background-color: #fef7e0; border: 1px solid #ffeeba; color: #b06000;",
        "danger": "background-color: #fce8e6; border: 1px solid #fad2cf; color: #c5221f;",
        "muted":  "background-color: #f1f3f4; border: 1px solid #dcdfe1; color: #3c4043;",
    }
    _SEV_BG = {"ok": "#e6f4ea", "warn": "#fef7e0", "danger": "#fce8e6", "muted": "#f1f3f4"}
    _SEV_FG = {"ok": "#137333", "warn": "#b06000", "danger": "#c5221f", "muted": "#3c4043"}

    def sev_filter(level):
        return _SEV.get(str(level or "").strip().lower(), _SEV["muted"])

    def quality_meta_filter(text):
        """Parse a '8/10 (High Quality) ...' quality string into a small dict for the
        scorecard and the final quality box (score, band label, severity + colors)."""
        m = re.search(r"\d+", str(text or ""))
        score = int(m.group(0)) if m else 5
        if score >= 8:
            band, key = "High", "ok"
        elif score >= 5:
            band, key = "Moderate", "warn"
        else:
            band, key = "Poor", "danger"
        return {"score": score, "band": band, "sev": key, "bg": _SEV_BG[key], "fg": _SEV_FG[key]}

    def gini_meta_filter(text):
        """Parse a '0.42 (Uneven ...)' Gini string into value / label / severity."""
        s = str(text or "")
        m = re.search(r"[0-9]*\.?[0-9]+", s)
        try:
            value = float(m.group(0)) if m else 0.0
        except (ValueError, TypeError):
            value = 0.0
        lm = re.search(r"\(([^)]+)\)", s)
        if lm:
            label = lm.group(1)
        else:
            label = "Balanced" if value < 0.3 else ("Uneven" if value < 0.5 else "Highly uneven")
        key = "ok" if value < 0.3 else ("warn" if value < 0.5 else "danger")
        return {"value": value, "label": label, "sev": key, "bg": _SEV_BG[key], "fg": _SEV_FG[key]}

    def plag_meta_filter(score):
        """Map a similarity score (0-100) to a severity style for the plagiarism box."""
        try:
            s = float(score)
        except (ValueError, TypeError):
            s = 0.0
        key = "danger" if s > 50 else ("warn" if s > 25 else "ok")
        return {"sev": key, "style": _SEV[key]}

    env.filters["md"] = md_filter
    env.filters["contrib_summary"] = _contrib_summary_filter
    env.filters["verdict_style"] = verdict_style
    env.filters["lang_color"] = lang_color_filter
    env.filters["sev"] = sev_filter
    env.filters["quality_meta"] = quality_meta_filter
    env.filters["gini_meta"] = gini_meta_filter
    env.filters["plag_meta"] = plag_meta_filter
    
    grp = group_no or (qual_data.get("group_no") if qual_data else None) or (qual_data.get("project_summary", {}).get("group_no") if qual_data else None)
    repo_url = git_url or (qual_data.get("git_url") if qual_data else None) or (qual_data.get("project_summary", {}).get("git_url") if qual_data else None)
    
    template = env.get_template("report.html")
    html_content = template.render(
        report=report_data,
        course_name=clean_course,
        project_name=clean_project,
        group_no=grp,
        git_url=repo_url,
        date=date,
        charts=charts,
        qual_data=qual_data or {},
        logo_uri=logo_uri,
        lecturer_name=lecturer_name or "Course Lecturer"
    )
    
    result = BytesIO()
    pdf = pisa.pisaDocument(BytesIO(html_content.encode("utf-8")), result)
    if pdf.err:
        raise RuntimeError(f"PDF rendering error: {pdf.err}")
    return result.getvalue()

