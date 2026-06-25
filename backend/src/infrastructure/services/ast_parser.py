"""
AST Parser Service (Phase 3 - Qualitative Intelligence Layer)

Supports: Python, JavaScript, TypeScript, Java, Kotlin, Dart, C, C++, Go,
          Rust, Ruby, C#, Swift, Scala, Bash, Lua, PHP, HTML, CSS

DESIGN CONSTRAINT: We never store the raw AST in the database.
We parse in-memory, extract only numerical metrics + a structural hash,
and immediately discard the AST object.
"""
import hashlib
from dataclasses import dataclass
from typing import Optional

from tree_sitter import Language, Parser, Node

# ---------------------------------------------------------------------------
# Language registry — lazy-loaded to avoid import cost for unused languages
# ---------------------------------------------------------------------------

def _load_languages() -> dict:
    """
    Build the registry of (Language, complexity_nodes, function_nodes) per language.
    Each entry is loaded only if the grammar package is installed.
    Missing packages are silently skipped so the server still starts.
    """
    registry: dict[str, dict] = {}

    def _register(name: str, loader, complexity_nodes: frozenset, function_nodes: frozenset):
        try:
            lang = Language(loader())
            registry[name] = {
                "lang": lang,
                "parser": Parser(lang),
                "complexity": complexity_nodes,
                "functions": function_nodes,
            }
        except Exception:
            pass  # grammar not installed — skip

    # --- Python ---
    try:
        import tree_sitter_python as tsp
        _register(
            "python", tsp.language,
            complexity_nodes=frozenset({
                "if_statement", "elif_clause", "for_statement", "while_statement",
                "except_clause", "with_statement", "conditional_expression",
                "boolean_operator", "assert_statement",
            }),
            function_nodes=frozenset({"function_definition", "async_function_def"}),
        )
    except ImportError:
        pass

    # --- JavaScript ---
    try:
        import tree_sitter_javascript as tsjs
        _register(
            "javascript", tsjs.language,
            complexity_nodes=frozenset({
                "if_statement", "for_statement", "for_in_statement", "while_statement",
                "do_statement", "switch_case", "catch_clause", "ternary_expression",
                "logical_expression",
            }),
            function_nodes=frozenset({
                "function_declaration", "function", "arrow_function",
                "method_definition", "generator_function_declaration",
            }),
        )
    except ImportError:
        pass

    # --- TypeScript (shares JS grammar base) ---
    try:
        import tree_sitter_typescript as tsts
        _register(
            "typescript", tsts.language_typescript,
            complexity_nodes=frozenset({
                "if_statement", "for_statement", "for_in_statement", "while_statement",
                "do_statement", "switch_case", "catch_clause", "ternary_expression",
                "logical_expression",
            }),
            function_nodes=frozenset({
                "function_declaration", "function", "arrow_function",
                "method_definition", "generator_function_declaration",
            }),
        )
        _register(
            "tsx", tsts.language_tsx,
            complexity_nodes=frozenset({
                "if_statement", "for_statement", "for_in_statement", "while_statement",
                "do_statement", "switch_case", "catch_clause", "ternary_expression",
                "logical_expression",
            }),
            function_nodes=frozenset({
                "function_declaration", "function", "arrow_function",
                "method_definition",
            }),
        )
    except ImportError:
        pass

    # --- Java ---
    try:
        import tree_sitter_java as tsjava
        _register(
            "java", tsjava.language,
            complexity_nodes=frozenset({
                "if_statement", "for_statement", "enhanced_for_statement",
                "while_statement", "do_statement", "catch_clause",
                "switch_block_statement_group", "ternary_expression",
            }),
            function_nodes=frozenset({
                "method_declaration", "constructor_declaration",
            }),
        )
    except ImportError:
        pass

    # --- Kotlin ---
    try:
        import tree_sitter_kotlin as tsk
        _register(
            "kotlin", tsk.language,
            complexity_nodes=frozenset({
                "if_expression", "when_expression", "when_entry",
                "for_statement", "while_statement", "do_while_statement",
                "catch_block", "boolean_literal",
            }),
            function_nodes=frozenset({
                "function_declaration", "anonymous_function", "lambda_literal",
            }),
        )
    except ImportError:
        pass

    # --- Dart ---
    try:
        import tree_sitter_dart as tsd
        _register(
            "dart", tsd.language,
            complexity_nodes=frozenset({
                "if_statement", "for_statement", "while_statement", "do_statement",
                "catch_clause", "switch_statement_case", "conditional_expression",
            }),
            function_nodes=frozenset({
                "function_declaration", "method_signature", "function_expression",
            }),
        )
    except ImportError:
        pass

    # --- C ---
    try:
        import tree_sitter_c as tsc
        _register(
            "c", tsc.language,
            complexity_nodes=frozenset({
                "if_statement", "for_statement", "while_statement", "do_statement",
                "case_statement", "conditional_expression",
            }),
            function_nodes=frozenset({"function_definition"}),
        )
    except ImportError:
        pass

    # --- C++ ---
    try:
        import tree_sitter_cpp as tscpp
        _register(
            "cpp", tscpp.language,
            complexity_nodes=frozenset({
                "if_statement", "for_statement", "for_range_loop",
                "while_statement", "do_statement", "case_statement",
                "catch_clause", "conditional_expression",
            }),
            function_nodes=frozenset({
                "function_definition", "lambda_expression",
            }),
        )
    except ImportError:
        pass

    # --- Go ---
    try:
        import tree_sitter_go as tsgo
        _register(
            "go", tsgo.language,
            complexity_nodes=frozenset({
                "if_statement", "for_statement", "expression_case",
                "type_case_clause", "select_statement", "communication_case",
            }),
            function_nodes=frozenset({
                "function_declaration", "method_declaration", "func_literal",
            }),
        )
    except ImportError:
        pass

    # --- Rust ---
    try:
        import tree_sitter_rust as tsr
        _register(
            "rust", tsr.language,
            complexity_nodes=frozenset({
                "if_expression", "for_expression", "while_expression",
                "match_expression", "match_arm", "loop_expression",
                "if_let_expression", "while_let_expression",
            }),
            function_nodes=frozenset({
                "function_item", "closure_expression",
            }),
        )
    except ImportError:
        pass

    # --- Ruby ---
    try:
        import tree_sitter_ruby as tsrb
        _register(
            "ruby", tsrb.language,
            complexity_nodes=frozenset({
                "if", "elsif", "unless", "for", "while", "until",
                "case", "when", "rescue",
            }),
            function_nodes=frozenset({
                "method", "singleton_method", "lambda",
            }),
        )
    except ImportError:
        pass

    # --- C# ---
    try:
        import tree_sitter_c_sharp as tscs
        _register(
            "csharp", tscs.language,
            complexity_nodes=frozenset({
                "if_statement", "for_statement", "foreach_statement",
                "while_statement", "do_statement", "switch_statement",
                "switch_section", "catch_clause", "conditional_expression",
            }),
            function_nodes=frozenset({
                "method_declaration", "constructor_declaration",
                "operator_declaration", "local_function_statement",
                "anonymous_method_expression", "lambda_expression",
            }),
        )
    except ImportError:
        pass

    # --- Swift ---
    try:
        import tree_sitter_swift as tssw
        _register(
            "swift", tssw.language,
            complexity_nodes=frozenset({
                "if_statement", "for_statement", "while_statement",
                "repeat_while_statement", "guard_statement",
                "switch_statement", "catch_clause",
            }),
            function_nodes=frozenset({
                "function_declaration", "initializer_declaration",
                "lambda_literal",
            }),
        )
    except ImportError:
        pass

    # --- Scala ---
    try:
        import tree_sitter_scala as tssc
        _register(
            "scala", tssc.language,
            complexity_nodes=frozenset({
                "if_expression", "for_expression", "while_expression",
                "match_expression", "case_clause", "try_expression",
            }),
            function_nodes=frozenset({
                "function_definition", "val_definition",
            }),
        )
    except ImportError:
        pass

    # --- Bash ---
    try:
        import tree_sitter_bash as tsbash
        _register(
            "bash", tsbash.language,
            complexity_nodes=frozenset({
                "if_statement", "for_statement", "while_statement",
                "case_statement", "case_item",
            }),
            function_nodes=frozenset({
                "function_definition",
            }),
        )
    except ImportError:
        pass

    # --- Lua ---
    try:
        import tree_sitter_lua as tslua
        _register(
            "lua", tslua.language,
            complexity_nodes=frozenset({
                "if_statement", "for_statement", "while_statement",
                "repeat_statement",
            }),
            function_nodes=frozenset({
                "function_declaration", "function_definition",
            }),
        )
    except ImportError:
        pass

    # --- PHP ---
    try:
        import tree_sitter_php as tsphp
        _register(
            "php", tsphp.language_php,
            complexity_nodes=frozenset({
                "if_statement", "for_statement", "foreach_statement",
                "while_statement", "do_statement", "match_expression",
                "catch_clause", "switch_statement",
            }),
            function_nodes=frozenset({
                "function_definition", "method_declaration",
                "arrow_function",
            }),
        )
    except ImportError:
        pass

    # --- HTML (structural fingerprinting only; no cyclomatic complexity) ---
    try:
        import tree_sitter_html as tshtml
        _register(
            "html", tshtml.language,
            complexity_nodes=frozenset(),   # No branching logic in HTML
            function_nodes=frozenset(),
        )
    except ImportError:
        pass

    # --- CSS (structural fingerprinting only) ---
    try:
        import tree_sitter_css as tscss
        _register(
            "css", tscss.language,
            complexity_nodes=frozenset(),   # No branching logic in CSS
            function_nodes=frozenset(),
        )
    except ImportError:
        pass

    return registry


# Build once at module import — all subsequent calls use the cached dict
_REGISTRY = _load_languages()

# ---------------------------------------------------------------------------
# File-extension → language name map
# ---------------------------------------------------------------------------
EXTENSION_TO_LANGUAGE: dict[str, str] = {
    # Python
    ".py":   "python",
    # JavaScript
    ".js":   "javascript",
    ".mjs":  "javascript",
    ".cjs":  "javascript",
    ".jsx":  "javascript",
    # TypeScript
    ".ts":   "typescript",
    ".tsx":  "tsx",
    # Java
    ".java": "java",
    # Kotlin
    ".kt":   "kotlin",
    ".kts":  "kotlin",
    # Dart
    ".dart": "dart",
    # C
    ".c":    "c",
    ".h":    "c",
    # C++
    ".cc":   "cpp",
    ".cpp":  "cpp",
    ".cxx":  "cpp",
    ".hpp":  "cpp",
    ".hxx":  "cpp",
    # Go
    ".go":   "go",
    # Rust
    ".rs":   "rust",
    # Ruby
    ".rb":   "ruby",
    ".erb":  "ruby",
    # C#
    ".cs":   "csharp",
    # Swift
    ".swift": "swift",
    # Scala
    ".scala": "scala",
    ".sc":    "scala",
    # Bash / Shell
    ".sh":   "bash",
    ".bash": "bash",
    ".zsh":  "bash",
    # Lua
    ".lua":  "lua",
    # PHP
    ".php":  "php",
    ".phtml": "php",
    # HTML
    ".html": "html",
    ".htm":  "html",
    # CSS
    ".css":  "css",
    ".scss": "css",
    ".sass": "css",
}


def get_language_for_file(filename: str) -> Optional[str]:
    """Return the language name for a filename, or None if unsupported."""
    if "." not in filename:
        return None
    ext = "." + filename.rsplit(".", 1)[-1].lower()
    return EXTENSION_TO_LANGUAGE.get(ext)


def supported_languages() -> list[str]:
    """Return the list of languages that have their grammar package installed."""
    return sorted(_REGISTRY.keys())


# ---------------------------------------------------------------------------
# Node types to skip when building the fingerprint
# (variable names, literals, comments — we want structure only)
# ---------------------------------------------------------------------------
_IGNORE_FOR_FINGERPRINT = frozenset({
    "identifier", "type_identifier", "field_identifier",
    "string", "string_literal", "string_content",
    "integer", "number", "float", "char_literal",
    "comment", "line_comment", "block_comment",
    "escape_sequence",
})


# ---------------------------------------------------------------------------
# Core traversal
# ---------------------------------------------------------------------------

def _walk(node: Node, complexity: list, functions: list, fp_parts: list,
          complexity_types: frozenset, function_types: frozenset) -> None:
    node_type = node.type

    if node_type == "ERROR":
        complexity[0] += 1
        fp_parts.append("ERROR")
        return

    if node_type in complexity_types:
        complexity[0] += 1
    if node_type in function_types:
        functions[0] += 1
    if node_type not in _IGNORE_FOR_FINGERPRINT:
        fp_parts.append(node_type)

    for child in node.children:
        _walk(child, complexity, functions, fp_parts, complexity_types, function_types)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

@dataclass
class ASTMetrics:
    complexity_score: int
    function_count: int
    ast_fingerprint: str


def parse_source(source_code: str, language: str) -> Optional[ASTMetrics]:
    """
    Parse source code for the given language and return lightweight AST metrics.

    - The AST object is local to this function and discarded after traversal.
    - Syntax errors are handled via tree-sitter's built-in error recovery.
    - Returns None if the language is unsupported or source_code is empty.
    """
    if not source_code or not source_code.strip():
        return None

    entry = _REGISTRY.get(language)
    if entry is None:
        return None

    try:
        source_bytes = source_code.encode("utf-8", errors="replace")
        tree = entry["parser"].parse(source_bytes)

        complexity = [1]   # base complexity = 1
        functions = [0]
        fp_parts: list[str] = []

        _walk(
            tree.root_node, complexity, functions, fp_parts,
            entry["complexity"], entry["functions"]
        )

        fingerprint_input = " ".join(fp_parts)
        ast_fingerprint = hashlib.sha256(fingerprint_input.encode()).hexdigest()[:32]

        return ASTMetrics(
            complexity_score=complexity[0],
            function_count=functions[0],
            ast_fingerprint=ast_fingerprint,
        )
    except Exception:
        return None


def build_ast_tree(source_code: str, language: str) -> Optional[dict]:
    """
    Build a simplified JSON-serialisable AST tree for the real-time API endpoint.
    Used ONLY for the on-demand GET /api/v1/files/{id}/ast endpoint.
    The AST object is discarded after conversion.
    """
    if not source_code or not source_code.strip():
        return None

    entry = _REGISTRY.get(language)
    if entry is None:
        return None

    try:
        source_bytes = source_code.encode("utf-8", errors="replace")
        tree = entry["parser"].parse(source_bytes)
        return _node_to_dict(tree.root_node, source_bytes, depth=0, max_depth=12)
    except Exception:
        return None


def _node_to_dict(node: Node, source: bytes, depth: int, max_depth: int) -> dict:
    """Recursively convert a tree-sitter node to a lightweight dict."""
    node_dict: dict = {
        "type": node.type,
        "start": node.start_point,
        "end": node.end_point,
        "is_error": node.type == "ERROR",
    }

    if node.child_count == 0:
        text = source[node.start_byte:node.end_byte].decode("utf-8", errors="replace")
        node_dict["text"] = text[:120]

    if depth < max_depth and node.child_count > 0:
        children = []
        for child in node.children:
            if not child.is_named and child.type in {
                ":", ",", "(", ")", "[", "]", "{", "}", ".", ";", "->", "=",
                "+=", "-=", "*=", "/=", "=>", "@",
            }:
                continue
            children.append(_node_to_dict(child, source, depth + 1, max_depth))
        if children:
            node_dict["children"] = children

    return node_dict
