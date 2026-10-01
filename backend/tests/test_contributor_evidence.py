"""Tests for per-contributor file-change evidence and its downstream consumers.

Covers:
  * ``collect_contributor_file_evidence`` / ``enrich_contributors_with_file_evidence``
    (canonical-id folding, filename normalization, top-N ranking, guarded no-ops)
    via a tiny fake DB session — no real database is touched.
  * ``build_gemini_prompt`` surfacing the new file-evidence sections when
    ``top_files_detail`` / per-commit ``notes`` are present.
  * ``_contrib_summary_filter`` — the render-time deterministic fallback that
    keeps the PDF "Contribution Summary" cell rich (naming real files) even when
    the cloud LLM narrative is missing/placeholder.
  * A template smoke test proving ``report.html`` compiles with the full custom
    filter set and that the ownership cell renders real filenames through Jinja.
"""
import os

from src.use_cases.contributor_evidence import (
    collect_contributor_file_evidence,
    enrich_contributors_with_file_evidence,
)
from src.use_cases.get_cloud_report import build_gemini_prompt, _contrib_summary_filter


# ---------------------------------------------------------------------------
# Fake DB session: chainable query that ignores its args and returns preset rows
# shaped like (filename, author_id, changes, complexity, functions).
# ---------------------------------------------------------------------------
class _FakeQuery:
    def __init__(self, rows):
        self._rows = rows

    def join(self, *a, **k):
        return self

    def filter(self, *a, **k):
        return self

    def group_by(self, *a, **k):
        return self

    def all(self):
        return list(self._rows)


class _FakeSession:
    def __init__(self, rows):
        self._rows = rows
        self.query_calls = 0

    def query(self, *a, **k):
        self.query_calls += 1
        return _FakeQuery(self._rows)


class _FakeProject:
    def __init__(self, pid):
        self.id = pid


# ---------------------------------------------------------------------------
# collect_contributor_file_evidence
# ---------------------------------------------------------------------------
def test_collect_folds_canonical_ids_and_normalizes_filenames():
    # raw ids 1 & 2 both resolve to canonical 1; the backslash path and the
    # forward-slash path are the same normalized file and must aggregate.
    rows = [
        ("src/app.py", 1, 3, 5, 2),
        ("src\\app.py", 2, 2, 4, 1),          # backslash -> src/app.py, merges into canonical 1
        ("src/utils/helpers.py", 1, 4, 8, 3),
        ("README.md", 3, 1, 0, 0),
        ("/leading/slash.py", 3, 2, 1, 1),    # leading slash stripped
        (None, 1, 9, 9, 9),                    # falsy filename -> skipped
    ]
    db = _FakeSession(rows)
    canonical_map = {1: 1, 2: 1, 3: 3}

    result = collect_contributor_file_evidence(db, project_id=42, canonical_map=canonical_map)

    assert db.query_calls == 1

    files_1 = result[1]
    by_name_1 = {f["file"]: f for f in files_1}
    # src/app.py aggregated across raw ids 1 & 2 (backslash normalized to match).
    assert by_name_1["src/app.py"]["changes"] == 5      # 3 + 2
    assert by_name_1["src/app.py"]["complexity"] == 9   # 5 + 4
    assert by_name_1["src/app.py"]["functions"] == 3    # 2 + 1
    # Ranked by (changes, complexity) desc: src/app.py (5) before helpers.py (4).
    assert [f["file"] for f in files_1] == ["src/app.py", "src/utils/helpers.py"]
    # None filename never leaks through.
    assert all(f["file"] for f in files_1)

    # Canonical 3: leading slash stripped; ranked by changes desc.
    files_3 = result[3]
    assert [f["file"] for f in files_3] == ["leading/slash.py", "README.md"]
    assert files_3[0]["changes"] == 2


def test_collect_respects_top_n_truncation():
    rows = [
        ("a.py", 1, 5, 0, 0),
        ("b.py", 1, 4, 0, 0),
        ("c.py", 1, 3, 0, 0),
    ]
    db = _FakeSession(rows)
    result = collect_contributor_file_evidence(db, 1, {1: 1}, top_n=2)
    assert [f["file"] for f in result[1]] == ["a.py", "b.py"]
    assert len(result[1]) == 2


def test_collect_uses_raw_id_when_not_in_canonical_map():
    # Empty map -> raw author id is kept as its own canonical bucket.
    db = _FakeSession([("x.py", 7, 2, 0, 0)])
    result = collect_contributor_file_evidence(db, 1, canonical_map={})
    assert 7 in result
    assert result[7][0]["file"] == "x.py"


def test_collect_returns_empty_on_query_error():
    class _BoomSession:
        def query(self, *a, **k):
            raise RuntimeError("boom")

    assert collect_contributor_file_evidence(_BoomSession(), 1, {}) == {}


# ---------------------------------------------------------------------------
# enrich_contributors_with_file_evidence
# ---------------------------------------------------------------------------
def test_enrich_attaches_top_files_detail_by_canonical_id():
    rows = [
        ("src/auth/login.py", 1, 8, 12, 3),
        ("src/api/routers.py", 1, 3, 4, 1),
        ("README.md", 3, 2, 0, 0),
    ]
    db = _FakeSession(rows)
    qual_data = {
        "contributors": {
            "Alice": {"canonical_author_id": 1, "stats": {"ownership_areas": ["src"]}},
            "Bob": {"author_id": 3, "stats": {}},              # falls back to author_id
            "Carol": {"canonical_author_id": 99, "stats": {}},  # no evidence -> untouched
        }
    }

    enrich_contributors_with_file_evidence(db, _FakeProject(42), qual_data, {1: 1, 3: 3})

    alice_files = qual_data["contributors"]["Alice"]["stats"]["top_files_detail"]
    assert [f["file"] for f in alice_files] == ["src/auth/login.py", "src/api/routers.py"]
    assert alice_files[0]["changes"] == 8

    bob_files = qual_data["contributors"]["Bob"]["stats"]["top_files_detail"]
    assert [f["file"] for f in bob_files] == ["README.md"]

    assert "top_files_detail" not in qual_data["contributors"]["Carol"]["stats"]


def test_enrich_creates_stats_dict_when_missing():
    db = _FakeSession([("main.py", 1, 4, 0, 0)])
    qual_data = {"contributors": {"Solo": {"canonical_author_id": 1}}}  # no 'stats' key
    enrich_contributors_with_file_evidence(db, _FakeProject(1), qual_data, {1: 1})
    assert qual_data["contributors"]["Solo"]["stats"]["top_files_detail"][0]["file"] == "main.py"


def test_enrich_is_a_noop_on_bad_input():
    db = _FakeSession([("a.py", 1, 1, 0, 0)])

    # No 'contributors' key -> untouched.
    qd = {"foo": "bar"}
    enrich_contributors_with_file_evidence(db, _FakeProject(1), qd, {1: 1})
    assert qd == {"foo": "bar"}

    # Project without an id -> nothing attached.
    qd2 = {"contributors": {"A": {"canonical_author_id": 1, "stats": {}}}}
    enrich_contributors_with_file_evidence(db, _FakeProject(None), qd2, {1: 1})
    assert "top_files_detail" not in qd2["contributors"]["A"]["stats"]

    # None qual_data must not raise.
    enrich_contributors_with_file_evidence(db, _FakeProject(1), None, {1: 1})


# ---------------------------------------------------------------------------
# build_gemini_prompt: new file-evidence sections
# ---------------------------------------------------------------------------
def test_build_gemini_prompt_includes_file_evidence_sections():
    qual_data = {
        "project_name": "Demo",
        "project_summary": {"total_commits": 10, "sampled_commits": 4},
        "contributors": {
            "Alice": {
                "canonical_author_id": 1,
                "stats": {
                    "total_project_commits": 10,
                    "sampled_commits": 4,
                    "ownership_areas": ["src"],
                    "top_files_detail": [
                        {"file": "src/auth/login.py", "changes": 8, "complexity": 12, "functions": 3},
                    ],
                    "code_smell_distribution": {"Long Method": 2},
                },
                "examples": {
                    "substantial_commits": [
                        {"message": "Add login", "notes": "Implemented token refresh and two login endpoints"},
                    ],
                },
            }
        },
    }

    prompt = build_gemini_prompt(qual_data, "CS101", None)

    assert "Files & Modules Changed:" in prompt
    assert "src/auth/login.py (8 edits, complexity 12)" in prompt
    assert "What Their Changes Did:" in prompt
    assert "Implemented token refresh and two login endpoints" in prompt
    assert "Code Quality Signals:" in prompt
    assert "Long Method x2" in prompt
    # Schema hardening: generic filler is explicitly forbidden.
    assert "FORBIDDEN" in prompt


# ---------------------------------------------------------------------------
# _contrib_summary_filter: render-time deterministic fallback
# ---------------------------------------------------------------------------
def test_contrib_summary_prefers_cloud_narrative():
    cdata = {"stats": {"top_files_detail": [{"file": "x.py", "changes": 1}]}, "examples": {}}
    assert _contrib_summary_filter(cdata, "Real cloud narrative.") == "Real cloud narrative."


def test_contrib_summary_falls_back_to_files_on_placeholder():
    cdata = {
        "stats": {
            "top_files_detail": [
                {"file": "src/auth/login.py", "changes": 8},
                {"file": "src/api/routers.py", "changes": 3},
            ],
            "substance_distribution": {"substantial": 2},
        },
        "examples": {"substantial_commits": [{"notes": "Implemented token refresh"}]},
    }
    out = _contrib_summary_filter(cdata, "N/A")
    assert "src/auth/login.py (8 edits)" in out
    assert "src/api/routers.py (3 edits)" in out
    assert "Implemented token refresh" in out
    assert "2 substantial commits sampled" in out
    assert out.endswith(".")


def test_contrib_summary_falls_back_to_folders_without_files():
    cdata = {"stats": {"ownership_areas": ["assets", "(root)"]}, "examples": {}}
    out = _contrib_summary_filter(cdata, "")
    assert "Worked mainly in assets/, (root)" in out


def test_contrib_summary_html_escapes_output():
    cdata = {"stats": {"top_files_detail": [{"file": "a<b>.py", "changes": 1}]}, "examples": {}}
    out = _contrib_summary_filter(cdata, None)
    assert "&lt;" in out and "&gt;" in out
    assert "<b>" not in out


def test_contrib_summary_empty_evidence_message():
    assert _contrib_summary_filter({"stats": {}, "examples": {}}, None) == (
        "No sampled contribution detail available."
    )


# ---------------------------------------------------------------------------
# Template smoke: report.html compiles with the full filter set; the ownership
# cell renders real filenames through Jinja (env config mirrors render_pdf_report:
# FileSystemLoader, autoescape off).
# ---------------------------------------------------------------------------
def test_report_template_compiles_and_renders_contrib_summary_cell():
    from jinja2 import Environment, FileSystemLoader

    templates_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "templates"
    )
    env = Environment(loader=FileSystemLoader(templates_dir))
    # Every custom filter report.html references. Jinja validates filter names at
    # COMPILE time, so get_template() below fails if any of these is missing.
    env.filters["md"] = lambda x: x if x is not None else ""
    env.filters["contrib_summary"] = _contrib_summary_filter
    env.filters["verdict_style"] = lambda x: {}
    env.filters["lang_color"] = lambda x: "#000000"
    env.filters["sev"] = lambda x: {}
    env.filters["quality_meta"] = lambda x: {}
    env.filters["gini_meta"] = lambda x: {}
    env.filters["plag_meta"] = lambda x: {}

    # Whole real template compiles with our filter set (regression guard against a
    # template referencing an unregistered filter).
    assert env.get_template("report.html") is not None

    # The ownership cell's filter renders through Jinja and names the real file.
    cell = env.from_string("{{ c | contrib_summary(llm) }}").render(
        c={"stats": {"top_files_detail": [{"file": "src/main.py", "changes": 5}]}, "examples": {}},
        llm="N/A",
    )
    assert "src/main.py (5 edits)" in cell
