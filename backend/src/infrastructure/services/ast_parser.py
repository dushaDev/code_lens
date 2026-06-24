"""
AST Parser Service (Phase 3 - Qualitative Intelligence Layer)

DESIGN CONSTRAINT: We never store the raw AST in the database.
We parse in-memory, extract only numerical metrics + a structural hash,
and immediately discard the AST object.
"""
import hashlib
from dataclasses import dataclass
from typing import Optional

try:
    from tree_sitter import Language, Parser, Node
    import tree_sitter_python as tsp
    _PYTHON_LANGUAGE = Language(tsp.language())
    _PYTHON_PARSER = Parser(_PYTHON_LANGUAGE)
    _TREE_SITTER_AVAILABLE = True
except Exception:
    _TREE_SITTER_AVAILABLE = False

# Nodes that each contribute +1 to cyclomatic complexity
_COMPLEXITY_NODE_TYPES = frozenset({
    "if_statement",
    "elif_clause",
    "for_statement",
    "while_statement",
    "except_clause",
    "with_statement",
    "conditional_expression",   # ternary: x if cond else y
    "boolean_operator",         # and / or branch
    "assert_statement",
})

# Nodes that represent a callable scope (function or method)
_FUNCTION_NODE_TYPES = frozenset({
    "function_definition",
    "async_function_def",
})

# Node types to skip entirely when building the fingerprint
# (variable names, string literals, numbers, comments — we want structure only)
_IGNORE_FOR_FINGERPRINT = frozenset({
    "identifier",
    "string",
    "integer",
    "float",
    "comment",
    "string_content",
    "escape_sequence",
})


@dataclass
class ASTMetrics:
    complexity_score: int
    function_count: int
    ast_fingerprint: str


def _walk(node: "Node", complexity: list, functions: list, fp_parts: list) -> None:
    """
    Single recursive traversal of the parse tree.
    Accumulates complexity delta, function count, and fingerprint tokens.
    Error nodes are counted as complexity +1 so syntax errors don't crash us.
    """
    node_type = node.type

    # Error recovery: syntax error nodes are opaque — just note them
    if node_type == "ERROR":
        complexity[0] += 1
        fp_parts.append("ERROR")
        return

    if node_type in _COMPLEXITY_NODE_TYPES:
        complexity[0] += 1

    if node_type in _FUNCTION_NODE_TYPES:
        functions[0] += 1

    if node_type not in _IGNORE_FOR_FINGERPRINT:
        fp_parts.append(node_type)

    for child in node.children:
        _walk(child, complexity, functions, fp_parts)


def parse_python(source_code: str) -> Optional[ASTMetrics]:
    """
    Parse Python source code and return lightweight AST metrics.

    Returns None if tree-sitter is not available or source_code is empty.
    The AST object is local to this function and discarded after traversal.
    """
    if not _TREE_SITTER_AVAILABLE:
        return None
    if not source_code or not source_code.strip():
        return None

    try:
        # Encode to bytes (tree-sitter requires bytes)
        source_bytes = source_code.encode("utf-8", errors="replace")
        # tree-sitter uses error recovery by default — syntax errors produce
        # ERROR nodes instead of raising exceptions
        tree = _PYTHON_PARSER.parse(source_bytes)

        complexity = [1]   # Base complexity = 1 (entry point)
        functions = [0]
        fp_parts: list[str] = []

        _walk(tree.root_node, complexity, functions, fp_parts)

        # Build fingerprint: SHA-256 of the ordered sequence of structural node types
        fingerprint_input = " ".join(fp_parts)
        ast_fingerprint = hashlib.sha256(fingerprint_input.encode()).hexdigest()[:32]

        # AST is now garbage-collected — we only keep the 3 extracted metrics
        return ASTMetrics(
            complexity_score=complexity[0],
            function_count=functions[0],
            ast_fingerprint=ast_fingerprint,
        )

    except Exception:
        # Never let AST parsing crash the extraction pipeline
        return None


def build_ast_tree(source_code: str) -> Optional[dict]:
    """
    Build a simplified JSON-serialisable AST tree for the real-time API endpoint.
    Used ONLY in the on-demand /api/v1/files/{id}/ast endpoint.

    Returns a simplified tree dict (not the raw tree-sitter object) so it is
    safe to serialise and return to the frontend.
    """
    if not _TREE_SITTER_AVAILABLE:
        return None
    if not source_code or not source_code.strip():
        return None

    try:
        source_bytes = source_code.encode("utf-8", errors="replace")
        tree = _PYTHON_PARSER.parse(source_bytes)
        return _node_to_dict(tree.root_node, source_bytes, depth=0, max_depth=12)
    except Exception:
        return None


def _node_to_dict(node: "Node", source: bytes, depth: int, max_depth: int) -> dict:
    """
    Recursively convert a tree-sitter node to a lightweight dict.
    Skips anonymous punctuation tokens (brackets, colons, etc.) to keep the
    tree readable for the frontend.
    """
    node_dict: dict = {
        "type": node.type,
        "start": node.start_point,   # (row, col)
        "end": node.end_point,
        "is_error": node.type == "ERROR",
    }

    # For leaf nodes, include the literal text (capped at 120 chars)
    if node.child_count == 0:
        text = source[node.start_byte:node.end_byte].decode("utf-8", errors="replace")
        node_dict["text"] = text[:120]

    if depth < max_depth and node.child_count > 0:
        children = []
        for child in node.children:
            # Skip pure punctuation anonymous nodes to reduce noise
            if not child.is_named and child.type in {
                ":", ",", "(", ")", "[", "]", "{", "}", ".", ";", "->", "=", "+=", "-=",
            }:
                continue
            children.append(_node_to_dict(child, source, depth + 1, max_depth))
        if children:
            node_dict["children"] = children

    return node_dict
