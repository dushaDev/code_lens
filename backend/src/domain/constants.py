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

# Security
PBKDF2_ITERATIONS = 100000

# Cloud AI Model
GEMINI_MODEL = "gemini-2.5-flash"

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
