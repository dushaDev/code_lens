"""
Cloud AI Report Use Case
Generates a final comprehensive project evaluation using Google Gemini API
based on the structured qualitative analysis data from the local AI pass.
"""
import json
import io
import base64
from typing import Optional
from src.domain.metrics import calculate_gini, get_gini_status


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
    except Exception as e:
        print(f"[CLOUD-REPORT-LOG] Logo read error: {e}")
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
                ax3.plot(dates, counts_t, color="#1f4268", marker="o", markersize=5.5, linewidth=3.2, label="Daily Commits")
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
                    except Exception as dl_err:
                        print(f"[CLOUD-REPORT-LOG] Chart C deadline line warning: {dl_err}")

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
                plt.close(fig3)
                buf_c.seek(0)
                uri_c = f"data:image/png;base64,{base64.b64encode(buf_c.getvalue()).decode('utf-8')}"
            except Exception as chart_err:
                print(f"[CLOUD-REPORT-LOG] [USE-CASE] Chart C timeline warning: {chart_err}")

        return {"commit_bar": uri_a, "lorenz_curve": uri_b, "commit_timeline": uri_c}
    except Exception as e:
        print(f"[CLOUD-REPORT-LOG] [USE-CASE] Chart generation warning: {e}")
        return {}


def build_gemini_prompt(qual_data: dict, course_name: str, tech_requirements: Optional[str], deadline: Optional[str] = None) -> str:
    """Build a comprehensive, reader-friendly prompt for Cloud AI evaluation report."""
    project_name = qual_data.get("project_name", "Software Project")
    ps = qual_data.get("project_summary", {})
    contributors = qual_data.get("contributors", {})

    total_commits = ps.get("total_commits", 0) or 0
    sampled_commits = ps.get("sampled_commits", 0) or 0
    coverage_pct = round((sampled_commits / total_commits * 100.0), 1) if total_commits > 0 else 100.0
    low_coverage_warning = (coverage_pct < 25.0) or (sampled_commits < total_commits)
    is_single_contributor = (len(contributors) == 1)
    effective_deadline = deadline or ps.get("deadline")
    is_deadline_configured = bool(effective_deadline and effective_deadline != "Not specified")

    zero_sampled_contributors = []
    contributor_lines = []
    for name, cdata in contributors.items():
        stats = cdata.get("stats", cdata)
        tot_commits = stats.get("total_project_commits", "?")
        sampled = stats.get("sampled_commits", 0)
        if sampled == 0:
            zero_sampled_contributors.append(name)
        late = stats.get("late_commits", 0)
        near = stats.get("commits_near_deadline", 0)
        pattern = stats.get("timing_pattern", "unknown")
        risk = stats.get("ai_risk_score", 0)
        substance = stats.get("substance_distribution", {})
        vague_pct = stats.get("vague_message_percentage", 0)
        mismatch_pct = stats.get("message_mismatch_percentage", stats.get("message_diff_mismatch_percentage", 0))
        
        contributor_lines.append(
            f"  - Contributor: {name}\n"
            f"    * Total Commits: {tot_commits} (Sampled Analyzed: {sampled})\n"
            f"    * Risk Score: {risk}/10 | Pacing: {pattern}\n"
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

    # Calculate Gini on the fly if it is missing or "N/A" for backward compatibility
    gini_coeff = ps.get("gini_coefficient")
    if is_single_contributor:
        gini_coeff = "N/A (Single Contributor Project)"
    elif not gini_coeff or gini_coeff == "N/A":
        contrib_commit_counts = []
        for name, cdata in contributors.items():
            stats = cdata.get("stats", cdata)
            tot_commits = stats.get("total_project_commits")
            if tot_commits is not None:
                contrib_commit_counts.append(tot_commits)
        
        if contrib_commit_counts and sum(contrib_commit_counts) > 0:
            gini_val = calculate_gini(contrib_commit_counts)
            gini_status = get_gini_status(gini_val)
            gini_coeff = f"{gini_val} ({gini_status})"
        else:
            gini_coeff = "0.0 (Low Risk (Well Distributed))"

    zero_sampled_block = ", ".join(zero_sampled_contributors) if zero_sampled_contributors else "None"

    prompt = f"""You are a senior academic integrity and software engineering assessment officer.

Your task is to analyze the provided commit activity payload for a student software project and produce a **highly readable, executive-ready, student-by-student evaluation report** for the university course lecturer.

=== PRE-COMPUTED EVALUATION CONTEXT & FLAGS ===
- Total Project Commits: {total_commits} | Sampled Analyzed Commits: {sampled_commits}
- Analysis Coverage: {coverage_pct}%
- Low Coverage Warning Flag: {low_coverage_warning} (Coverage < 25% or partial sampling)
- Single Contributor Project: {is_single_contributor}
- Deadline Configured: {is_deadline_configured}
- Contributors with 0 Sampled Commits: {zero_sampled_block}

=== CALIBRATION & HONESTY RULES (STRICT COMPLIANCE REQUIRED) ===
1. ABSENCE OF SAMPLED EVIDENCE IS NOT CLEARANCE: Never report unsampled contributors or unsampled commits as "verified clean" nor as "misconduct". Nor report missing sample data as evidence of misconduct. State unanalyzed work clearly as "Unverified (0 commits sampled)".
2. PROVISIONAL CONCLUSIONS ON LOW COVERAGE: When Low Coverage Warning Flag is True, state all project-level and student-level conclusions as provisional pending further commit sampling.
3. SINGLE CONTRIBUTOR GINI RULE: If Single Contributor Project is True, Gini inequality coefficient is NOT APPLICABLE. Never describe a single contributor project as having "balanced teamwork" or "equal distribution". State that single contributor status means workload distribution is not evaluated.
4. NO DEADLINE RULE: If Deadline Configured is False, do NOT praise or criticize submission pacing or deadline compliance. State explicitly: "Pacing not tracked (no deadline configured)".
5. ZERO HALLUCINATED METRICS: Do not invent any numbers, commit counts, or percentages not present in the payload.

=== PROJECT & COURSE CONTEXT ===
Course: {course_name}
Project: {project_name}{tech_block}{deadline_block}
Sampling Mode: {ps.get('sampling_mode', 'sample')} ({sampled_commits} of {total_commits} total commits analyzed)
Date Range: {ps.get('date_range', 'N/A')}

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
  "work_distribution_and_fairness": "Explain the Gini coefficient and pacing in plain language. No emojis.",
  "student_evaluations": [
    {{
      "student_name": "Name",
      "commits_summary": "TERSE table phrase (~12 words max, e.g., '34 total (4 sampled)')",
      "substance_breakdown": "TERSE table phrase (~12 words max, e.g., 'Substantial: 2, Moderate: 2, Trivial: 0')",
      "pacing_and_deadlines": "TERSE table phrase (~12 words max, e.g., 'Pacing not tracked (no deadline)')",
      "quality_and_integrity_signals": "TERSE table phrase (~12 words max, e.g., '0% vague, 0% mismatch, Risk 0/10')",
      "verdict": "MUST start with EXACTLY 'Low Risk - ', 'Moderate Risk - ', or 'High Risk - ', followed by a 1-sentence reason. No emojis."
    }}
  ],
  "academic_integrity_anomalies": "Detail any red flags, code resurrection cases, sudden dumps, etc. No emojis.",
  "overall_project_risk_score": "Score from 0/10 to 10/10 with a bold justification. No emojis.",
  "actionable_recommendations": [
    "Recommendation 1",
    "Recommendation 2",
    "Recommendation 3"
  ]
}}

STRICT TABLE CELL CONSTRAINT:
The fields `commits_summary`, `substance_breakdown`, `pacing_and_deadlines`, and `quality_and_integrity_signals` inside `student_evaluations` MUST be short, terse table-cell phrases (~12 words max each). Put all long narrative explanations only in `executive_summary`, `work_distribution_and_fairness`, and `academic_integrity_anomalies`.

VERDICT PREFIX REQUIREMENT:
Every student `verdict` MUST start with EXACTLY one of the following prefixes:
- `Low Risk - `
- `Moderate Risk - `
- `High Risk - `

Ensure every student in the contributor stats is represented as a row in the `student_evaluations` array.
Use clear language. Do not use any emojis anywhere in the output."""

    return prompt


def _call_agentrouter_api(prompt: str, api_key: str) -> str:
    import json
    import urllib.request
    import urllib.error

    url = "https://agentrouter.org/v1/chat/completions"
    masked_prefix = api_key.strip()[:8] + "..." if len(api_key.strip()) > 8 else "***"
    print(f"[CLOUD-REPORT-LOG] [AGENTROUTER] Initializing AgentRouter request. Key prefix: '{masked_prefix}'")

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
    no_channel_count = 0
    for idx, model in enumerate(models_to_try, 1):
        print(f"[CLOUD-REPORT-LOG] [AGENTROUTER] Attempt {idx}/{len(models_to_try)}: Trying model '{model}' at {url}...")
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
                "User-Agent": "codex_cli_rs/0.101.0 (x86_64-pc-windows-msvc)",
                "Originator": "codex_cli_rs",
                "Version": "0.101.0"
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
                    return text_content
                else:
                    print(f"[CLOUD-REPORT-LOG] [AGENTROUTER] Warning: Model '{model}' returned empty choices or message content.")
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="ignore")
            print(f"[CLOUD-REPORT-LOG] [AGENTROUTER] Model '{model}' FAILED with HTTP {e.code}: {err_body[:200]}")
            if e.code in (401, 403):
                raise ValueError(f"AgentRouter Auth Error (HTTP {e.code}): Invalid API key or token expired.")
            if e.code == 429:
                raise ValueError(f"AgentRouter Quota Exceeded (HTTP 429): Token balance exhausted.")
            if e.code == 503 and ("无可用渠道" in err_body or "channel" in err_body.lower()):
                no_channel_count += 1
                last_err = f"Model {model} has no active channel on AgentRouter."
                continue
            last_err = f"Model {model} failed (HTTP {e.code}): {err_body}"
        except Exception as e:
            print(f"[CLOUD-REPORT-LOG] [AGENTROUTER] Exception for model '{model}': {type(e).__name__}: {str(e)}")
            last_err = str(e)

    if no_channel_count == len(models_to_try):
        print(f"[CLOUD-REPORT-LOG] [AGENTROUTER] Error: All {len(models_to_try)} models returned 503 (no channel).")
        raise ValueError("AgentRouter error: No active routing channels available for the selected models. Please try again later.")

    print(f"[CLOUD-REPORT-LOG] [AGENTROUTER] All model attempts failed. Last error: {last_err}")
    raise RuntimeError(f"AgentRouter API error: {last_err or 'Failed to get completion.'}")


def generate_cloud_report(qual_data: dict, api_key: str, course_name: str, tech_requirements: Optional[str] = None, deadline: Optional[str] = None):
    """
    Call Cloud AI (AgentRouter Claude / GPT or Google Gemini) with the qualitative analysis data and return the parsed Pydantic model.
    """
    from src.infrastructure.api.schemas import CloudReportData
    import re
    
    clean_key = api_key.strip()
    key_prefix = clean_key[:8] + "..." if len(clean_key) > 8 else "***"
    provider_type = "AgentRouter" if clean_key.startswith("sk-") else "Google Gemini"
    
    print(f"[CLOUD-REPORT-LOG] [USE-CASE] Starting generate_cloud_report. Provider: '{provider_type}', Key prefix: '{key_prefix}', Course: '{course_name}'")
    prompt = build_gemini_prompt(qual_data, course_name, tech_requirements, deadline=deadline)
    print(f"[CLOUD-REPORT-LOG] [USE-CASE] Built prompt successfully ({len(prompt)} characters).")

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
            return _call_agentrouter_api(prompt, clean_key)

        print("[CLOUD-REPORT-LOG] [GEMINI] Key is Google Gemini style. Initializing google.generativeai...")
        try:
            import google.generativeai as genai
        except ImportError:
            print("[CLOUD-REPORT-LOG] [GEMINI] ERROR: google-generativeai package not installed.")
            raise RuntimeError("google-generativeai package not installed. Run: pip install google-generativeai")

        genai.configure(api_key=clean_key)
        model_candidates = [
            "gemini-2.0-flash",
            "gemini-2.0-flash-lite",
            "gemini-1.5-flash-latest",
            "gemini-1.5-pro-latest",
            "gemma-4-26b-a4b-it",
            "gemini-2.5-flash",
            "gemini-2.5-pro",
            "gemini-1.5-flash",
            "gemini-1.5-pro"
        ]

        last_error = None
        quota_error = None
        for idx, model_name in enumerate(model_candidates, 1):
            print(f"[CLOUD-REPORT-LOG] [GEMINI] Attempt {idx}/{len(model_candidates)}: Calling model '{model_name}'...")
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
                    return response.text
                else:
                    print(f"[CLOUD-REPORT-LOG] [GEMINI] Model '{model_name}' returned empty response text.")
            except Exception as e:
                error_msg = str(e)
                print(f"[CLOUD-REPORT-LOG] [GEMINI] Model '{model_name}' FAILED: {error_msg[:200]}")
                if "API_KEY_INVALID" in error_msg or "API key not valid" in error_msg or ("400" in error_msg and "key" in error_msg.lower()):
                    raise ValueError("Invalid Gemini API key. Please update your key in Settings.")
                if "QUOTA_EXCEEDED" in error_msg or "quota" in error_msg.lower() or "429" in error_msg:
                    quota_error = "Gemini API quota exceeded (HTTP 429). Please check your Google AI Studio quota or switch to an active key."
                    continue
                last_error = error_msg

        if quota_error:
            print("[CLOUD-REPORT-LOG] [GEMINI] Raising quota exceeded exception.")
            raise ValueError(quota_error)

        print(f"[CLOUD-REPORT-LOG] [GEMINI] All Gemini candidates failed. Last error: {last_error}")
        raise RuntimeError(f"Cloud AI API error: {last_error or 'All model candidates failed.'}")

    last_parse_error = None
    for attempt in range(1, 4):
        print(f"[CLOUD-REPORT-LOG] [USE-CASE] Cloud AI LLM call attempt {attempt}/3...")
        raw_output = _call_model()
        cleaned_json = _clean_json_output(raw_output)
        print(f"[CLOUD-REPORT-LOG] [USE-CASE] Attempt {attempt}: Received raw output. Cleaned JSON length: {len(cleaned_json)} chars.")
        try:
            parsed_data = json.loads(cleaned_json)
            print(f"[CLOUD-REPORT-LOG] [USE-CASE] Attempt {attempt}: Successfully parsed JSON object with keys: {list(parsed_data.keys())}")
            report_data = CloudReportData(**parsed_data)
            print(f"[CLOUD-REPORT-LOG] [USE-CASE] Attempt {attempt}: Successfully validated Pydantic CloudReportData model!")
            return report_data
        except Exception as e:
            print(f"[CLOUD-REPORT-LOG] [USE-CASE] Attempt {attempt}: JSON/Pydantic validation failed: {type(e).__name__}: {str(e)}")
            last_parse_error = e
            continue
            
    print(f"[CLOUD-REPORT-LOG] [USE-CASE] ERROR: All 3 parse attempts failed.")
    raise RuntimeError(f"Cloud AI failed to return valid JSON after 3 attempts. Last error: {last_parse_error}")


def render_pdf_report(
    report_data,
    course_name: str,
    project_name: str,
    date: str,
    qual_data: Optional[dict] = None,
    group_no: Optional[str] = None,
    lecturer_name: Optional[str] = None,
    git_url: Optional[str] = None,
    deadline: Optional[str] = None
) -> bytes:
    """Render the parsed Pydantic model to a PDF using Jinja2 and xhtml2pdf (pure Python)."""
    from jinja2 import Environment, FileSystemLoader
    from xhtml2pdf import pisa
    from io import BytesIO
    import markdown as md
    import os
    
    # Fallback for empty or placeholder course / project names
    clean_course = (course_name or "").strip()
    if not clean_course or clean_course in ("Unknown Course", "Course Name"):
        clean_course = "General Course"
        
    clean_project = (project_name or "").strip()
    if not clean_project or clean_project in ("Unknown Project", "Project Name"):
        clean_project = "Software Project Submission"
        
    # Sort student evaluations so Low Risk is at top (rank 1), Moderate Risk middle (rank 2), High Risk bottom (rank 3)
    def _risk_rank(item):
        v = ""
        name = ""
        if isinstance(item, dict):
            v = str(item.get("verdict", "") or "")
            name = str(item.get("student_name", "") or "")
        else:
            v = str(getattr(item, "verdict", "") or "")
            name = str(getattr(item, "student_name", "") or "")
        v_lower = v.lower()
        if "low" in v_lower or "strong" in v_lower or "solid" in v_lower or "good" in v_lower:
            r = 1
        elif "moderate" in v_lower or "medium" in v_lower or "fair" in v_lower or "minor" in v_lower:
            r = 2
        else:
            r = 3
        return (r, name)

    if hasattr(report_data, "student_evaluations") and report_data.student_evaluations:
        try:
            report_data.student_evaluations = sorted(report_data.student_evaluations, key=_risk_rank)
        except Exception as e:
            print(f"[CLOUD-REPORT-LOG] Warning sorting student_evaluations: {e}")

    charts = _build_charts(qual_data, deadline=deadline) if qual_data else {}
    logo_uri = _build_logo_uri()
    
    templates_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "templates")
    env = Environment(loader=FileSystemLoader(templates_dir))
    
    def md_filter(text):
        return md.markdown(str(text) or "", extensions=["extra"])
        
    def verdict_style(verdict_text):
        v = (verdict_text or "").strip()
        if v.startswith("Low Risk"):
            return "background-color: #e6f4ea; color: #137333; font-weight: bold;"
        elif v.startswith("Moderate Risk"):
            return "background-color: #fef7e0; color: #b06000; font-weight: bold;"
        elif v.startswith("High Risk"):
            return "background-color: #fce8e6; color: #c5221f; font-weight: bold;"
        return "background-color: #f8f9fa; color: #3c4043;"
        
    colors = ['#2b5c8f', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#374151']
    def lang_color_filter(idx):
        try:
            return colors[int(idx) % len(colors)]
        except Exception:
            return '#2b5c8f'

    env.filters["md"] = md_filter
    env.filters["verdict_style"] = verdict_style
    env.filters["lang_color"] = lang_color_filter
    
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

