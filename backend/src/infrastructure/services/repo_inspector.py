import os
import logging
from typing import Optional, Any, Dict
from src.use_cases.interfaces import IRepoInspector

logger = logging.getLogger(__name__)

IGNORE_DIRS = frozenset({
    'node_modules', '__pycache__', 'venv', 'env', 'build', 'dist',
    'target', '.git', '.idea', '.vscode', '.gradle', 'ios', 'android'
})

class RepoInspector(IRepoInspector):
    def inspect_folder_structure(self, repo_path: Optional[str], ai_service: Optional[Any] = None) -> Dict[str, Any]:
        return inspect_folder_structure(repo_path, ai_service)

    def inspect_readme_quality(self, repo_path: Optional[str]) -> Dict[str, Any]:
        return inspect_readme_quality(repo_path)

    def inspect_repository(self, repo_path: Optional[str], ai_service: Optional[Any] = None) -> Dict[str, Any]:
        return inspect_repository(repo_path, ai_service)


def inspect_folder_structure(repo_path: Optional[str], ai_service: Optional[Any] = None) -> Dict[str, Any]:
    """
    Inspects the directory structure of a repository, calculates modularity,
    builds a 3-level tree structure, and optionally uses AI service to select
    architectural folders.
    """
    top_dirs = []
    tot_files = 0
    tot_dirs = 0
    has_tests = False
    tree_structure = {}
    filtered_ai_folders = []

    if not repo_path or not os.path.exists(repo_path) or not os.path.isdir(repo_path):
        return {
            "top_level_directories": [],
            "total_directories": 0,
            "total_files": 0,
            "has_tests_dir": False,
            "modularity_score": "Monolithic (Flat)",
            "tree_structure": {},
            "filtered_ai_folders": []
        }

    try:
        all_rel_dirs = []
        for root, dirs, files in os.walk(repo_path):
            dirs[:] = [d for d in dirs if not d.startswith('.') and d not in IGNORE_DIRS]
            tot_dirs += len(dirs)
            tot_files += len(files)

            rel_root = os.path.relpath(root, repo_path)
            if rel_root == ".":
                top_dirs = list(dirs)
                for d in dirs[:8]:
                    tree_structure[d] = {"dirs": {}, "files": []}
            else:
                parts = rel_root.split(os.sep)
                if len(parts) == 1 and parts[0] in tree_structure:
                    # Level 2 directory
                    for d in dirs[:4]:
                        tree_structure[parts[0]]["dirs"][d] = []
                    tree_structure[parts[0]]["files"] = [f for f in files if not f.startswith('.')][:3]
                elif len(parts) == 2 and parts[0] in tree_structure and parts[1] in tree_structure[parts[0]]["dirs"]:
                    # Level 3 directory/files
                    tree_structure[parts[0]]["dirs"][parts[1]] = [f for f in files if not f.startswith('.')][:3]

            for d in dirs:
                if d.lower() in ('test', 'tests', '__tests__', 'spec', 'specs'):
                    has_tests = True

            if rel_root != ".":
                all_rel_dirs.append(rel_root.replace("\\", "/"))

        if ai_service and hasattr(ai_service, "filter_important_folders"):
            try:
                filtered_ai_folders = ai_service.filter_important_folders(all_rel_dirs or top_dirs)[:10]
            except Exception as ai_err:
                logger.warning(f"AI folder filtering fallback: {ai_err}")
                filtered_ai_folders = top_dirs[:10]
        else:
            filtered_ai_folders = top_dirs[:10]

        modularity = "Monolithic (Flat)"
        if len(top_dirs) >= 3 or has_tests:
            modularity = "High Modularity (Structured Directories)"
        elif len(top_dirs) >= 1:
            modularity = "Moderate Modularity"

        return {
            "top_level_directories": top_dirs[:8],
            "total_directories": tot_dirs,
            "total_files": tot_files,
            "has_tests_dir": has_tests,
            "modularity_score": modularity,
            "tree_structure": tree_structure,
            "filtered_ai_folders": filtered_ai_folders
        }
    except Exception as e:
        logger.warning(f"Error inspecting folder structure at '{repo_path}': {e}")
        return {
            "top_level_directories": top_dirs[:8],
            "total_directories": tot_dirs,
            "total_files": tot_files,
            "has_tests_dir": has_tests,
            "modularity_score": "Monolithic (Flat)",
            "tree_structure": tree_structure,
            "filtered_ai_folders": filtered_ai_folders
        }


def inspect_readme_quality(repo_path: Optional[str]) -> Dict[str, Any]:
    """
    Evaluates README presence, size, and architectural/setup documentation quality.
    """
    if not repo_path or not os.path.exists(repo_path) or not os.path.isdir(repo_path):
        return {"has_readme": False, "documentation_score": "Missing (0/10)"}

    readme_file = None
    try:
        for fname in os.listdir(repo_path):
            if fname.lower().startswith('readme'):
                readme_file = os.path.join(repo_path, fname)
                break
    except Exception as e:
        logger.warning(f"Error scanning directory for README at '{repo_path}': {e}")

    if readme_file and os.path.isfile(readme_file):
        size_kb = round(os.path.getsize(readme_file) / 1024.0, 2)
        has_setup = False
        has_arch = False

        try:
            with open(readme_file, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read().lower()
                if any(k in content for k in ['install', 'setup', 'run', 'build', 'usage', 'getting started']):
                    has_setup = True
                if any(k in content for k in ['architecture', 'design', 'structure', 'api', 'component', 'overview']):
                    has_arch = True
        except Exception as readme_err:
            logger.warning(f"Failed to read README file at '{readme_file}': {readme_err}")

        if size_kb > 2.0 and has_setup and has_arch:
            doc_score = "Comprehensive (9/10)"
        elif size_kb > 0.5 or has_setup:
            doc_score = "Basic (5/10)"
        else:
            doc_score = "Minimal (3/10)"

        return {
            "has_readme": True,
            "readme_size_kb": size_kb,
            "has_setup_guide": has_setup,
            "has_architecture_doc": has_arch,
            "documentation_score": doc_score
        }
    else:
        return {"has_readme": False, "documentation_score": "Missing (0/10)"}


def inspect_repository(repo_path: Optional[str], ai_service: Optional[Any] = None) -> Dict[str, Any]:
    """Inspects both folder structure and README quality for a repository."""
    return {
        "folder_structure": inspect_folder_structure(repo_path, ai_service),
        "readme_quality": inspect_readme_quality(repo_path)
    }
