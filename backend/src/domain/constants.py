"""
Domain Constants
================
Centralized configuration values and default parameters used across the system.
"""

DEFAULT_GROUP = "G-00"
DEFAULT_SAMPLING_MODE = "sample"

# Saved repository directory templates
SAVED_REPOS_PATH_TEMPLATE = "./saved_repos/project_{}"
TEMP_REPOS_PATH_TEMPLATE = "./temp_repos/project_{}"

# Git clone limits (bound the synchronous clone in the request path)
CLONE_TIMEOUT_SECONDS = 300          # hard wall-clock cap on a single clone
MAX_REPO_SIZE_BYTES = 50 * 1024 * 1024  # 50 MB cap on the cloned working tree
# Transport protocols permitted for git (HTTPS only — no git://, file://, ssh).
# Passed per-subprocess via GIT_ALLOW_PROTOCOL, never mutated into os.environ.
GIT_ALLOWED_PROTOCOLS = "https"


def normalize_git_url(url: str) -> str:
    """Normalize git repository URL for case-insensitive and suffix-insensitive comparison."""
    return (url or "").strip().rstrip("/").removesuffix(".git").lower()


# Security
PBKDF2_ITERATIONS = 100000

# Cloud AI Model
GEMINI_MODEL = "gemini-flash-latest"

# File Extension to Language Mapping
EXTENSION_TO_LANGUAGE = {
    '.py': 'Python',
    '.js': 'JavaScript',
    '.jsx': 'JavaScript',
    '.ts': 'TypeScript',
    '.tsx': 'TypeScript',
    '.java': 'Java',
    '.cpp': 'C++',
    '.cc': 'C++',
    '.cxx': 'C++',
    '.c': 'C',
    '.h': 'C/C++',
    '.cs': 'C#',
    '.go': 'Go',
    '.rs': 'Rust',
    '.rb': 'Ruby',
    '.php': 'PHP',
    '.swift': 'Swift',
    '.kt': 'Kotlin',
    '.kts': 'Kotlin',
    '.dart': 'Dart',
    '.html': 'HTML',
    '.css': 'CSS',
    '.scss': 'CSS',
    '.sql': 'SQL',
    '.sh': 'Shell'
}

HIGH_CONFIDENCE_THRESHOLD = 60.0

# Plagiarism review statuses that an educator has explicitly cleared.
# Pairs with these statuses are NOT surfaced as active warnings in the UI,
# AI prompt, or PDF report. Keep this frozenset as the single source of truth —
# import it from here in all consumers (detect_similarity, get_cloud_report, etc.).
RESOLVED_PLAGIARISM_STATUSES: frozenset = frozenset({
    "resolved",
    "dismissed",
    "verified clean",
    "clean",
    "no match",
})
