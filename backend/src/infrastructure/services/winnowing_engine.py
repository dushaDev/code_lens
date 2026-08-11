"""
Winnowing Code Similarity Detection Engine (AST-Based, Non-AI)
===============================================================
Implements AST parsing, structure normalization, flattening, k-gram shingling,
64-bit hashing, Winnowing fingerprint selection, inverted index pairwise matching,
and side-by-side block reporting.
"""

import ast
import fnmatch
import hashlib
import logging
import os
import re
from collections import defaultdict
from dataclasses import dataclass
from itertools import combinations
from typing import Dict, List, Optional, Set, Tuple

logger = logging.getLogger(__name__)


@dataclass
class TokenMeta:
    token: str
    file_path: str
    line_number: int
    raw_ident: Optional[str] = None


@dataclass
class Fingerprint:
    hash_value: int
    position: int
    file_path: str
    line_number: int
    raw_ident: Optional[str] = None


# =====================================================================
# STEP 1: File Collector (With Robust Framework & Scaffold Filtering)
# =====================================================================
class FileCollector:
    DEFAULT_EXTENSIONS = {
        ".py", ".js", ".ts", ".jsx", ".tsx", ".java", ".kt", ".go", ".rs", ".cs", ".cpp", ".c", ".h"
    }

    DEFAULT_EXCLUDED_DIRS = {
        "node_modules", ".git", ".svn", ".hg", "dist", "build", "out", "target", "vendor",
        "bin", "obj", ".idea", ".vscode", "venv", "env", ".venv", "__pycache__", "coverage",
        "migrations", "static", "public", ".next", ".nuxt", ".svelte-kit", "gen", "generated"
    }

    # Exact filename match (lowercase)
    DEFAULT_EXCLUDED_FILES = {
        # Package & lock files
        "package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "npm-shrinkwrap.json",
        "bun.lockb", "composer.json", "composer.lock", "pom.xml", "build.gradle", "build.gradle.kts",
        "settings.gradle", "settings.gradle.kts", "mvnw", "mvnw.cmd", "gradlew", "gradlew.bat",
        "go.mod", "go.sum", "cargo.toml", "cargo.lock", "requirements.txt", "pyproject.toml",
        "pipfile", "pipfile.lock", "setup.py", "setup.cfg", "alembic.ini", "poetry.lock",
        "pubspec.yaml", "pubspec.lock", "gemfile", "gemfile.lock", "dockerfile", "docker-compose.yml",
        "docker-compose.yaml", ".gitignore", ".env", ".env.example", ".env.local", "readme.md",
        "license", "changelog.md",
        # Framework configs & CLI scaffolding
        "eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", "prettier.config.js",
        "prettier.config.mjs", "prettier.config.cjs", "next.config.js", "next.config.mjs",
        "tailwind.config.js", "tailwind.config.ts", "postcss.config.js", "postcss.config.cjs",
        "vite.config.js", "vite.config.ts", "webpack.config.js", "babel.config.js", "babel.config.json",
        "tsconfig.json", "tsconfig.node.json", "jsconfig.json", "angular.json", "nest-cli.json",
        "gatsby-config.js", "remix.config.js", "vite-env.d.ts", "react-app-env.d.ts", "components.json"
    }

    # Pattern wildcard exclusions for generated code / scaffolding
    DEFAULT_EXCLUDED_PATTERNS = [
        ".eslintrc*", ".prettierrc*", "*.config.*", "*.min.*", "*.bundle.*", "*.map", "*.d.ts",
        "*.generated.*", "*_service_pb2.py", "*.spec.*", "*.test.*", "reportWebVitals.*",
        "setupTests.*", "serviceWorker.*", "service-worker.*"
    ]

    def __init__(
        self,
        allowed_extensions: Optional[Set[str]] = None,
        excluded_dirs: Optional[Set[str]] = None,
    ):
        self.allowed_extensions = allowed_extensions or self.DEFAULT_EXTENSIONS
        self.excluded_dirs = excluded_dirs or self.DEFAULT_EXCLUDED_DIRS

    def is_file_excluded(self, filename: str) -> bool:
        lower_name = filename.lower()
        if lower_name in self.DEFAULT_EXCLUDED_FILES:
            return True
        for pat in self.DEFAULT_EXCLUDED_PATTERNS:
            if fnmatch.fnmatch(lower_name, pat.lower()):
                return True
        return False

    def collect_files(self, project_path: str) -> List[str]:
        """Recursively scan project directory for allowed source files, ignoring scaffolding/configs."""
        collected = []
        if not os.path.exists(project_path):
            logger.warning(f"Project path does not exist: {project_path}")
            return collected

        for root, dirs, files in os.walk(project_path):
            # Prune excluded directories
            dirs[:] = [d for d in dirs if d.lower() not in self.excluded_dirs]

            for file in files:
                if self.is_file_excluded(file):
                    continue
                ext = os.path.splitext(file)[1].lower()
                if ext in self.allowed_extensions:
                    full_path = os.path.join(root, file)
                    rel_path = os.path.relpath(full_path, project_path)
                    collected.append(rel_path)

        collected.sort()
        return collected


# =====================================================================
# STEP 2 & 3: AST Normalization & Token Stream Extraction (Specific)
# =====================================================================
class PythonAstNormalizer(ast.NodeVisitor):
    """Walks Python AST and extracts structural tokens with property/operator specificity."""

    def __init__(self, file_path: str):
        self.file_path = file_path
        self.tokens: List[TokenMeta] = []

    def _add_token(self, token_name: str, node: ast.AST, raw_ident: Optional[str] = None):
        lineno = getattr(node, "lineno", 1)
        self.tokens.append(TokenMeta(token=token_name, file_path=self.file_path, line_number=lineno, raw_ident=raw_ident))

    def generic_visit(self, node: ast.AST):
        node_type = type(node).__name__
        if node_type not in ("Module", "Pass", "Load", "Store", "Del"):
            self._add_token(node_type, node)
        super().generic_visit(node)

    def visit_Attribute(self, node: ast.Attribute):
        self._add_token(f"PROP:{node.attr}", node, raw_ident=node.attr)
        self.generic_visit(node)

    def visit_Name(self, node: ast.Name):
        self._add_token("VAR", node, raw_ident=node.id)

    def visit_FunctionDef(self, node: ast.FunctionDef):
        self._add_token("FUNC_DEF", node, raw_ident=node.name)
        self.generic_visit(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef):
        self._add_token("FUNC_DEF", node, raw_ident=node.name)
        self.generic_visit(node)

    def visit_ClassDef(self, node: ast.ClassDef):
        self._add_token("CLASS_DEF", node, raw_ident=node.name)
        self.generic_visit(node)

    def visit_Compare(self, node: ast.Compare):
        for op in node.ops:
            op_name = type(op).__name__
            self._add_token(f"OP:{op_name}", node)
        self.generic_visit(node)

    def visit_Constant(self, node: ast.Constant):
        if isinstance(node.value, str):
            self._add_token("STR", node)
        elif isinstance(node.value, (int, float, complex)):
            self._add_token("NUM", node)
        else:
            self._add_token("CONST", node)


class JsTsStructuralNormalizer:
    """JS/TS structural AST tokenizer with property access and operator specificity."""

    KEYWORDS = {
        "if": "IF",
        "else": "ELSE",
        "for": "FOR",
        "while": "WHILE",
        "do": "DO",
        "switch": "SWITCH",
        "case": "CASE",
        "default": "DEFAULT",
        "function": "FUNC",
        "return": "RETURN",
        "const": "VAR_DECL",
        "let": "VAR_DECL",
        "var": "VAR_DECL",
        "class": "CLASS",
        "import": "IMPORT",
        "export": "EXPORT",
        "async": "ASYNC",
        "await": "AWAIT",
        "try": "TRY",
        "catch": "CATCH",
        "finally": "FINALLY",
        "throw": "THROW",
        "new": "NEW",
        "this": "THIS",
        "yield": "YIELD",
    }

    TOKEN_SPEC = [
        ("COMMENT", r"//.*|/\*[\s\S]*?\*/"),
        ("STR", r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|`(?:\\.|[^`\\])*`'),
        ("NUM", r"\b\d+(?:\.\d+)?\b"),
        ("IDENT", r"\b[A-Za-z_$][A-Za-z0-9_$]*\b"),
        ("OP", r"===|!==|==|!=|=>|<=|>=|\+\+|--|\&\&|\|\||[+\-*/%&=><!]"),
        ("PUNCT", r"[{}()\[\];,.]"),
        ("NEWLINE", r"\n"),
        ("SKIP", r"[ \t\r]+"),
    ]

    def normalize(self, code_content: str, file_path: str) -> List[TokenMeta]:
        tokens: List[TokenMeta] = []
        master_pattern = "|".join(f"(?P<{pair[0]}>{pair[1]})" for pair in self.TOKEN_SPEC)
        line_num = 1
        prev_token_type = ""

        for match in re.finditer(master_pattern, code_content):
            kind = match.lastgroup
            val = match.group()

            if kind == "NEWLINE":
                line_num += 1
            elif kind == "SKIP" or kind == "COMMENT":
                line_num += val.count("\n")
            elif kind == "STR":
                line_num += val.count("\n")
                tokens.append(TokenMeta(token="STR", file_path=file_path, line_number=line_num))
                prev_token_type = "STR"
            elif kind == "NUM":
                tokens.append(TokenMeta(token="NUM", file_path=file_path, line_number=line_num))
                prev_token_type = "NUM"
            elif kind == "IDENT":
                if val in self.KEYWORDS:
                    tok_str = self.KEYWORDS[val]
                    tokens.append(TokenMeta(token=tok_str, file_path=file_path, line_number=line_num))
                    prev_token_type = tok_str
                else:
                    if prev_token_type == ".":
                        tok_str = f"PROP:{val}"
                    else:
                        tok_str = "VAR"
                    tokens.append(TokenMeta(token=tok_str, file_path=file_path, line_number=line_num, raw_ident=val))
                    prev_token_type = tok_str
            elif kind == "OP":
                tok_str = f"OP:{val}"
                tokens.append(TokenMeta(token=tok_str, file_path=file_path, line_number=line_num))
                prev_token_type = tok_str
            elif kind == "PUNCT":
                tokens.append(TokenMeta(token=val, file_path=file_path, line_number=line_num))
                prev_token_type = val

        return tokens


# =====================================================================
# STEP 4: Flatten AST into Token Sequence per Project
# =====================================================================
class AstParserService:
    def __init__(self):
        self.js_normalizer = JsTsStructuralNormalizer()

    def parse_file(self, full_file_path: str, rel_file_path: str) -> List[TokenMeta]:
        try:
            with open(full_file_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
        except OSError as e:
            logger.warning(f"Could not read file {rel_file_path}: {e}", exc_info=e)
            return []

        ext = os.path.splitext(rel_file_path)[1].lower()

        if ext == ".py":
            try:
                tree = ast.parse(content, filename=rel_file_path)
                visitor = PythonAstNormalizer(file_path=rel_file_path)
                visitor.visit(tree)
                return visitor.tokens
            except SyntaxError as se:
                logger.warning(f"Python Syntax Error in {rel_file_path}: {se}. Skipping.")
                return []
            except Exception as ex:
                logger.exception(f"Failed to parse Python AST for {rel_file_path}: {ex}. Skipping.", exc_info=ex)
                return []
        else:
            # JS, TS, JSX, TSX structural AST normalization
            return self.js_normalizer.normalize(content, rel_file_path)


# =====================================================================
# STEP 5, 6, 7: K-Grams, Hashing & Winnowing Algorithm
# =====================================================================
class WinnowingService:
    def __init__(self, k: int = 5, w: int = 4):
        self.k = k  # K-gram size
        self.w = w  # Winnow window size

    def _hash_kgram(self, kgram_tokens: List[str]) -> int:
        """64-bit integer hash of k-gram sequence."""
        data = "-".join(kgram_tokens).encode("utf-8")
        digest = hashlib.sha256(data).hexdigest()
        return int(digest[:15], 16)

    def generate_fingerprints(self, token_sequence: List[TokenMeta]) -> List[Fingerprint]:
        """Generates k-grams, hashes them, and applies Winnowing filter."""
        if len(token_sequence) < self.k:
            return []

        raw_hashes: List[Tuple[int, int, str, int, Optional[str]]] = []
        for i in range(len(token_sequence) - self.k + 1):
            kgram = [t.token for t in token_sequence[i : i + self.k]]
            h_val = self._hash_kgram(kgram)
            anchor_token = token_sequence[i]
            raw_hashes.append(
                (h_val, i, anchor_token.file_path, anchor_token.line_number, anchor_token.raw_ident)
            )

        if not raw_hashes:
            return []

        fingerprints: List[Fingerprint] = []
        min_pos = -1

        for i in range(len(raw_hashes) - self.w + 1):
            window = raw_hashes[i : i + self.w]
            min_in_win = min(window, key=lambda x: (x[0], -x[1]))

            if min_in_win[1] != min_pos:
                min_pos = min_in_win[1]
                fingerprints.append(
                    Fingerprint(
                        hash_value=min_in_win[0],
                        position=min_in_win[1],
                        file_path=min_in_win[2],
                        line_number=min_in_win[3],
                        raw_ident=min_in_win[4],
                    )
                )

        return fingerprints


# =====================================================================
# STEP 8, 9, 10: Inverted Index, Corpus Stopword Filtering, Run Merging & Re-Scoring
# =====================================================================
@dataclass
class MatchDetail:
    file_a: str
    line_a: int
    file_b: str
    line_b: int
    hash_value: int


class SimilarityComparator:
    def __init__(
        self,
        file_match_threshold: float = 50.0,  # 50% Hard File Match Threshold
        high_confidence_threshold: float = 70.0,
        corpus_stopword_pct: float = 0.12,   # 12% Corpus Stopword Suppression
        min_run_hashes: int = 30,            # Minimum 30 k-grams (>= 150 contiguous tokens per block)
        one_to_many_limit: int = 3,
        min_identifier_overlap_pct: float = 25.0,  # Semantic Divergence Check
        min_single_run_tokens: int = 150,    # At least ONE single match run >= 150 tokens
        min_total_matched_tokens: int = 300,  # Total matched tokens >= 300
    ):
        self.file_match_threshold = file_match_threshold
        self.high_confidence_threshold = high_confidence_threshold
        self.corpus_stopword_pct = corpus_stopword_pct
        self.min_run_hashes = min_run_hashes
        self.one_to_many_limit = one_to_many_limit
        self.min_identifier_overlap_pct = min_identifier_overlap_pct
        self.min_single_run_tokens = min_single_run_tokens
        self.min_total_matched_tokens = min_total_matched_tokens

    def compute_pairwise_similarity(
        self,
        project_fingerprints: Dict[int, List[Fingerprint]],
    ) -> List[Dict]:
        """
        Computes pairwise similarity enforcing strict false-positive reduction:
        1. 50% File-Level Match Threshold
        2. At least ONE single contiguous match run >= 100 tokens
        3. Total matched tokens >= 300 tokens
        4. Structural Specificity
        5. Corpus-Wide Pattern Suppression
        6. Semantic Divergence Identifier Check
        """
        total_projects = len(project_fingerprints)
        if total_projects < 2:
            return []

        # -------------------------------------------------------------
        # STEP 4: Corpus-Wide Common Pattern Suppression
        # -------------------------------------------------------------
        hash_project_occurrence: Dict[int, Set[int]] = {}
        for proj_id, fp_list in project_fingerprints.items():
            for fp in fp_list:
                if fp.hash_value not in hash_project_occurrence:
                    hash_project_occurrence[fp.hash_value] = set()
                hash_project_occurrence[fp.hash_value].add(proj_id)

        stopword_threshold = max(2, int(total_projects * self.corpus_stopword_pct))
        stopword_hashes: Set[int] = {
            h for h, proj_set in hash_project_occurrence.items()
            if len(proj_set) > stopword_threshold
        }

        filtered_project_fp: Dict[int, List[Fingerprint]] = {}
        project_valid_hash_counts: Dict[int, int] = {}

        for proj_id, fp_list in project_fingerprints.items():
            valid_fps = [fp for fp in fp_list if fp.hash_value not in stopword_hashes]
            filtered_project_fp[proj_id] = valid_fps
            project_valid_hash_counts[proj_id] = len(set(fp.hash_value for fp in valid_fps))

    def _evaluate_pair_direct(
        self,
        p1: int,
        p2: int,
        fps1: List[Fingerprint],
        fps2: List[Fingerprint],
        file_match_threshold: Optional[float] = None,
        min_run_hashes: Optional[int] = None,
        min_single_run_tokens: Optional[int] = None,
        min_total_matched_tokens: Optional[int] = None,
    ) -> Optional[Dict]:
        """Directly evaluates pairwise similarity between two project fingerprint streams with custom thresholds."""
        thresh = file_match_threshold if file_match_threshold is not None else self.file_match_threshold
        run_h_thresh = min_run_hashes if min_run_hashes is not None else self.min_run_hashes
        single_tokens_thresh = min_single_run_tokens if min_single_run_tokens is not None else self.min_single_run_tokens
        total_tokens_thresh = min_total_matched_tokens if min_total_matched_tokens is not None else self.min_total_matched_tokens

        count1 = len(set(fp.hash_value for fp in fps1))
        count2 = len(set(fp.hash_value for fp in fps2))
        min_count = min(count1, count2)

        if min_count < 5:
            return None

        # One-to-Many Sanity Check
        p2_hash_counts: Dict[int, int] = defaultdict(int)
        for fp in fps2:
            p2_hash_counts[fp.hash_value] += 1

        p1_hash_counts: Dict[int, int] = defaultdict(int)
        for fp in fps1:
            p1_hash_counts[fp.hash_value] += 1

        clean_fps1 = [
            fp for fp in fps1
            if p2_hash_counts[fp.hash_value] < self.one_to_many_limit
            and p1_hash_counts[fp.hash_value] < self.one_to_many_limit
        ]
        clean_fps2 = [
            fp for fp in fps2
            if p2_hash_counts[fp.hash_value] < self.one_to_many_limit
            and p1_hash_counts[fp.hash_value] < self.one_to_many_limit
        ]

        fp1_by_hash = defaultdict(list)
        for idx, fp in enumerate(clean_fps1):
            fp1_by_hash[fp.hash_value].append((idx, fp))

        fp2_by_hash = defaultdict(list)
        for idx, fp in enumerate(clean_fps2):
            fp2_by_hash[fp.hash_value].append((idx, fp))

        matching_pairs = []
        for h_val, list1 in fp1_by_hash.items():
            if h_val in fp2_by_hash:
                for idx1, fp1 in list1:
                    for idx2, fp2 in fp2_by_hash[h_val]:
                        matching_pairs.append((idx1, idx2, fp1, fp2))

        if not matching_pairs:
            return None

        matching_pairs.sort(key=lambda x: (x[0], x[1]))

        match_runs = []
        visited_pairs = set()

        for i, (idx1, idx2, fp1, fp2) in enumerate(matching_pairs):
            if (idx1, idx2) in visited_pairs:
                continue

            run_fps_a = [fp1]
            run_fps_b = [fp2]
            visited_pairs.add((idx1, idx2))

            curr1, curr2 = idx1, idx2
            while True:
                next1, next2 = curr1 + 1, curr2 + 1
                if next1 < len(clean_fps1) and next2 < len(clean_fps2):
                    n_fp1 = clean_fps1[next1]
                    n_fp2 = clean_fps2[next2]
                    if (
                        n_fp1.hash_value == n_fp2.hash_value
                        and n_fp1.file_path == fp1.file_path
                        and n_fp2.file_path == fp2.file_path
                    ):
                        run_fps_a.append(n_fp1)
                        run_fps_b.append(n_fp2)
                        visited_pairs.add((next1, next2))
                        curr1, curr2 = next1, next2
                        continue
                break

            if len(run_fps_a) >= run_h_thresh:
                idents_a = set(fp.raw_ident for fp in run_fps_a if fp.raw_ident)
                idents_b = set(fp.raw_ident for fp in run_fps_b if fp.raw_ident)

                ident_overlap = 100.0
                if idents_a and idents_b:
                    shared = idents_a.intersection(idents_b)
                    min_idents = min(len(idents_a), len(idents_b))
                    ident_overlap = (len(shared) / min_idents) * 100.0 if min_idents > 0 else 100.0

                if idents_a and idents_b and ident_overlap < self.min_identifier_overlap_pct:
                    continue

                match_runs.append({
                    "file_a": fp1.file_path,
                    "start_line_a": run_fps_a[0].line_number,
                    "end_line_a": run_fps_a[-1].line_number,
                    "file_b": fp2.file_path,
                    "start_line_b": run_fps_b[0].line_number,
                    "end_line_b": run_fps_b[-1].line_number,
                    "run_length_hashes": len(run_fps_a),
                    "token_span": len(run_fps_a) * 5,
                    "ident_overlap": round(ident_overlap, 1),
                    "hashes": [fp.hash_value for fp in run_fps_a],
                })

        if not match_runs:
            return None

        surviving_unique_hashes = set()
        for r in match_runs:
            for h in r["hashes"]:
                surviving_unique_hashes.add(h)

        surviving_token_count = len(surviving_unique_hashes)
        file_match_percentage = (surviving_token_count / min_count) * 100.0

        max_run_hashes = max(r["run_length_hashes"] for r in match_runs)
        max_run_tokens = max(r["token_span"] for r in match_runs)
        total_matched_tokens = surviving_token_count * 5

        if (
            file_match_percentage >= thresh
            and max_run_tokens >= single_tokens_thresh
            and total_matched_tokens >= total_tokens_thresh
        ):
            avg_ident_overlap = round(sum(r["ident_overlap"] for r in match_runs) / len(match_runs), 1)

            block_highlights = []
            for r in match_runs[:30]:
                block_highlights.append({
                    "file_a": r["file_a"],
                    "line_a": r["start_line_a"],
                    "end_line_a": r["end_line_a"],
                    "file_b": r["file_b"],
                    "line_b": r["start_line_b"],
                    "end_line_b": r["end_line_b"],
                    "run_length": r["run_length_hashes"],
                    "token_span": r["token_span"],
                    "ident_overlap": r["ident_overlap"],
                })

            return {
                "project_a_id": p1,
                "project_b_id": p2,
                "similarity_score": round(file_match_percentage, 2),
                "file_match_percentage": round(file_match_percentage, 2),
                "identifier_overlap_percentage": avg_ident_overlap,
                "matched_hashes_count": surviving_token_count,
                "total_matched_tokens": total_matched_tokens,
                "total_match_runs": len(match_runs),
                "max_contiguous_run_hashes": max_run_hashes,
                "max_contiguous_run_tokens": max_run_tokens,
                "confidence_level": (
                    "HIGH" if file_match_percentage >= self.high_confidence_threshold else "MEDIUM"
                ),
                "matched_blocks": block_highlights,
            }

        return None

    def reanalyze_cluster_pairs(
        self,
        cluster_project_ids: List[int],
        project_fingerprints: Dict[int, List[Fingerprint]],
        existing_flagged_pairs: Set[Tuple[int, int]],
    ) -> List[Dict]:
        """
        Pass 2: Re-runs pairwise comparison for all project pairs in the SAME cluster
        WITHOUT applying corpus-wide frequency suppression to cluster-internal hashes.
        Uses a lower cluster-membership threshold (e.g. 30.0% match, >= 60 tokens)
        to detect transitive connections between cluster members (e.g. A and E).
        """
        additional_reports = []
        cluster_ids = sorted(list(set(cluster_project_ids)))

        for p1, p2 in combinations(cluster_ids, 2):
            pair_key = (min(p1, p2), max(p1, p2))
            if pair_key in existing_flagged_pairs:
                continue

            fps1 = project_fingerprints.get(p1, [])
            fps2 = project_fingerprints.get(p2, [])
            if not fps1 or not fps2:
                continue

            # Pass 2: Evaluate raw fingerprints directly without corpus stopword filter
            report = self._evaluate_pair_direct(
                p1, p2, fps1, fps2,
                file_match_threshold=30.0,
                min_run_hashes=12,  # ~60 tokens
                min_single_run_tokens=60,
                min_total_matched_tokens=150,
            )

            if report:
                additional_reports.append(report)
                existing_flagged_pairs.add(pair_key)

        return additional_reports

    def compute_pairwise_similarity(
        self,
        project_fingerprints: Dict[int, List[Fingerprint]],
        cluster_map: Optional[Dict[int, int]] = None,
    ) -> List[Dict]:
        """
        Computes pairwise similarity enforcing strict false-positive reduction:
        1. 50% File-Level Match Threshold
        2. At least ONE single contiguous match run >= 150 tokens
        3. Total matched tokens >= 300 tokens
        4. Structural Specificity
        5. Cluster-as-One-Unit Corpus-Wide Pattern Suppression
        6. Semantic Divergence Identifier Check
        """
        total_projects = len(project_fingerprints)
        if total_projects < 2:
            return []

        proj_ids = list(project_fingerprints.keys())

        # -------------------------------------------------------------
        # STEP 4A: Inverted Index Pre-Pass to Protect Contiguous Match Runs (>= 10 hashes)
        # -------------------------------------------------------------
        raw_hash_to_projects = defaultdict(set)
        for proj_id, fp_list in project_fingerprints.items():
            for fp in fp_list:
                raw_hash_to_projects[fp.hash_value].add(proj_id)

        raw_candidate_counts = defaultdict(int)
        for proj_set in raw_hash_to_projects.values():
            if len(proj_set) >= 2:
                proj_list = sorted(list(proj_set))
                for i in range(len(proj_list)):
                    for j in range(i + 1, len(proj_list)):
                        raw_candidate_counts[(proj_list[i], proj_list[j])] += 1

        raw_candidates = [
            pair for pair, count in raw_candidate_counts.items()
            if count >= 10
        ]

        protected_hashes: Set[int] = set()

        for p1, p2 in raw_candidates:
            fps1 = project_fingerprints.get(p1, [])
            fps2 = project_fingerprints.get(p2, [])
            if not fps1 or not fps2:
                continue

            fp1_by_hash = defaultdict(list)
            for idx, fp in enumerate(fps1):
                fp1_by_hash[fp.hash_value].append(idx)

            fp2_by_hash = defaultdict(list)
            for idx, fp in enumerate(fps2):
                fp2_by_hash[fp.hash_value].append(idx)

            matching_pairs = []
            for h_val, list1 in fp1_by_hash.items():
                if h_val in fp2_by_hash:
                    for idx1 in list1:
                        for idx2 in fp2_by_hash[h_val]:
                            matching_pairs.append((idx1, idx2, h_val))

            if not matching_pairs:
                continue

            matching_pairs.sort(key=lambda x: (x[0], x[1]))
            visited_pairs = set()

            for idx1, idx2, h_val in matching_pairs:
                if (idx1, idx2) in visited_pairs:
                    continue

                run_hashes = [h_val]
                visited_pairs.add((idx1, idx2))
                curr1, curr2 = idx1, idx2

                while True:
                    next1, next2 = curr1 + 1, curr2 + 1
                    if next1 < len(fps1) and next2 < len(fps2):
                        n_fp1 = fps1[next1]
                        n_fp2 = fps2[next2]
                        if (
                            n_fp1.hash_value == n_fp2.hash_value
                            and n_fp1.file_path == fps1[curr1].file_path
                            and n_fp2.file_path == fps2[curr2].file_path
                        ):
                            run_hashes.append(n_fp1.hash_value)
                            visited_pairs.add((next1, next2))
                            curr1, curr2 = next1, next2
                            continue
                    break

                if len(run_hashes) >= 10:
                    for h in run_hashes:
                        protected_hashes.add(h)

        # -------------------------------------------------------------
        # STEP 4B: Cluster-As-One-Unit Common Pattern Suppression
        # -------------------------------------------------------------
        hash_unit_occurrence: Dict[int, Set[int]] = {}
        for proj_id, fp_list in project_fingerprints.items():
            unit_id = cluster_map.get(proj_id, proj_id) if cluster_map else proj_id
            for fp in fp_list:
                if fp.hash_value not in hash_unit_occurrence:
                    hash_unit_occurrence[fp.hash_value] = set()
                hash_unit_occurrence[fp.hash_value].add(unit_id)

        all_units = set(cluster_map.values()) if cluster_map else set(proj_ids)
        for pid in proj_ids:
            if not cluster_map or pid not in cluster_map:
                all_units.add(pid)
        total_units = max(1, len(all_units))

        stopword_threshold = max(2, int(total_units * self.corpus_stopword_pct))
        stopword_hashes: Set[int] = {
            h for h, unit_set in hash_unit_occurrence.items()
            if h not in protected_hashes and len(unit_set) > stopword_threshold
        }

        filtered_project_fp: Dict[int, List[Fingerprint]] = {}
        for proj_id, fp_list in project_fingerprints.items():
            valid_fps = [fp for fp in fp_list if fp.hash_value not in stopword_hashes]
            filtered_project_fp[proj_id] = valid_fps

        # -------------------------------------------------------------
        # STEP 5: Inverted Index Pairwise Candidate Discovery (O(N) Scaling)
        # -------------------------------------------------------------
        hash_to_projects = defaultdict(set)
        for proj_id, fp_list in filtered_project_fp.items():
            for fp in fp_list:
                hash_to_projects[fp.hash_value].add(proj_id)

        candidate_pair_counts = defaultdict(int)
        for proj_set in hash_to_projects.values():
            if len(proj_set) >= 2:
                proj_list = sorted(list(proj_set))
                for i in range(len(proj_list)):
                    for j in range(i + 1, len(proj_list)):
                        candidate_pair_counts[(proj_list[i], proj_list[j])] += 1

        candidate_pairs = [
            pair for pair, count in candidate_pair_counts.items()
            if count >= 10
        ]

        results = []

        for p1, p2 in candidate_pairs:
            fps1 = filtered_project_fp.get(p1, [])
            fps2 = filtered_project_fp.get(p2, [])

            if not fps1 or not fps2:
                continue

            report = self._evaluate_pair_direct(p1, p2, fps1, fps2)
            if report:
                results.append(report)

        results.sort(key=lambda r: r["similarity_score"], reverse=True)
        return results

