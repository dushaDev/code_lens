"""
Cloud AI Report Use Case
Generates a final comprehensive project evaluation using Google Gemini API
based on the structured qualitative analysis data from the local AI pass.
"""
import json
from typing import Optional


def build_gemini_prompt(qual_data: dict, course_name: str, tech_requirements: Optional[str], deadline: Optional[str] = None) -> str:
    """Build a comprehensive, reader-friendly prompt for Cloud AI evaluation report."""
    project_name = qual_data.get("project_name", "Unknown Project")
    ps = qual_data.get("project_summary", {})
    contributors = qual_data.get("contributors", {})

    # Summarise contributor data compactly but with rich details
    contributor_lines = []
    for name, cdata in contributors.items():
        stats = cdata.get("stats", cdata)
        tot_commits = stats.get("total_project_commits", "?")
        sampled = stats.get("sampled_commits", "?")
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
            f"    * AI Risk Score: {risk}/10 | Pacing: {pattern}\n"
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
    effective_deadline = deadline or ps.get('deadline', 'Not specified')
    deadline_block = f"\nCourse Submission Deadline: {effective_deadline}"
    # Calculate Gini on the fly if it is missing or "N/A" for backward compatibility
    gini_coeff = ps.get("gini_coefficient")
    if not gini_coeff or gini_coeff == "N/A":
        contrib_commit_counts = []
        for name, cdata in contributors.items():
            stats = cdata.get("stats", cdata)
            tot_commits = stats.get("total_project_commits")
            if tot_commits is not None:
                contrib_commit_counts.append(tot_commits)
        
        if contrib_commit_counts and sum(contrib_commit_counts) > 0:
            n = len(contrib_commit_counts)
            s_counts = sorted(contrib_commit_counts)
            tot = sum(s_counts)
            if n > 1 and tot > 0:
                idx_sum = sum((i + 1) * val for i, val in enumerate(s_counts))
                gini_val = max(0.0, round((2 * idx_sum) / (n * tot) - (n + 1) / n, 3))
            else:
                gini_val = 0.0
            
            gini_status = (
                "Low Risk (Well Distributed)" if gini_val < 0.3
                else "Medium Risk (Slightly Unequal)" if gini_val < 0.5
                else "High Risk (Inequal / Free-rider Risk)"
            )
            gini_coeff = f"{gini_val} ({gini_status})"
        else:
            gini_coeff = "0.0 (Low Risk (Well Distributed))"

    prompt = f"""You are a senior academic integrity and software engineering assessment officer.

Your task is to analyze the provided commit activity payload for a student software project and produce a **highly readable, executive-ready, student-by-student evaluation report** for the university course lecturer.

=== PROJECT & COURSE CONTEXT ===
Course: {course_name}
Project: {project_name}{tech_block}{deadline_block}
Sampling Mode: {ps.get('sampling_mode', 'sample')} ({ps.get('sampled_commits', '?')} of {ps.get('total_commits', '?')} total commits analyzed)
Date Range: {ps.get('date_range', 'N/A')}

=== AGGREGATED METRICS & SIGNALS ===
- Work Pacing Pattern: {ps.get('overall_pacing', 'N/A')}
- Gini Inequality Coefficient (Contribution Distribution): {gini_coeff}
- Commit Type Distribution: {json.dumps(ps.get('type_distribution', {}))}
- Substance Breakdown: {json.dumps(ps.get('substance_distribution', {}))}
- Substantial-to-Trivial Ratio: {ps.get('substantial_to_trivial_ratio', 'N/A')}
- Vague Commit Message Rate: {ps.get('vague_message_percentage', 0)}%
- Message-Diff Mismatch Rate: {ps.get('message_mismatch_percentage', ps.get('message_diff_mismatch_percentage', 0))}%
- Security Risk Commits: {ps.get('security_risk_commits', 0)}
- Late Commits (Post-Deadline): {ps.get('commits_after_deadline', 0)}
- Near-Deadline Commits (within 48h): {ps.get('commits_within_48h_of_deadline', 0)}

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
      "commits_summary": "Total (Sampled)",
      "substance_breakdown": "Substantial: X, Moderate: Y, Trivial: Z",
      "pacing_and_deadlines": "Summary of pacing/late commits",
      "quality_and_integrity_signals": "Message quality, vague %, diff mismatch %, risk score",
      "verdict": "Concise 1-sentence assessment and risk rating. No emojis."
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
        if text.startswith("```json"):
            text = text[7:]
        elif text.startswith("```"):
            text = text[3:]
        if text.endswith("```"):
            text = text[:-3]
        return text.strip()

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

def render_pdf_report(report_data, course_name: str, project_name: str, date: str) -> bytes:
    """Render the parsed Pydantic model to a PDF using Jinja2 and xhtml2pdf (pure Python)."""
    from jinja2 import Environment, FileSystemLoader
    from xhtml2pdf import pisa
    from io import BytesIO
    import markdown as md
    import os
    
    templates_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "templates")
    env = Environment(loader=FileSystemLoader(templates_dir))
    
    def md_filter(text):
        return md.markdown(str(text) or "", extensions=["extra"])
        
    env.filters["md"] = md_filter
    
    template = env.get_template("report.html")
    html_content = template.render(
        report=report_data,
        course_name=course_name,
        project_name=project_name,
        date=date
    )
    
    result = BytesIO()
    pdf = pisa.pisaDocument(BytesIO(html_content.encode("utf-8")), result)
    if pdf.err:
        raise RuntimeError(f"PDF rendering error: {pdf.err}")
    return result.getvalue()

