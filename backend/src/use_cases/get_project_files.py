import os
from typing import Dict, Any, List
from src.use_cases.interfaces import IProjectRepository

def build_dir_tree(dir_path: str, root_dir: str) -> Dict[str, Any]:
    ignore_dirs = {
        ".git", "node_modules", "venv", ".venv", "__pycache__", "dist",
        "build", ".next", ".idea", ".vscode", "coverage"
    }
    
    basename = os.path.basename(dir_path.rstrip("/\\")) or "root"
    node = {
        "name": basename,
        "path": os.path.relpath(dir_path, root_dir).replace("\\", "/"),
        "type": "directory",
        "children": []
    }
    
    try:
        entries = sorted(os.listdir(dir_path))
    except Exception:
        return node

    for entry in entries:
        if entry.startswith('.') or entry in ignore_dirs:
            continue
        full = os.path.join(dir_path, entry)
        rel = os.path.relpath(full, root_dir).replace("\\", "/")
        
        if os.path.isdir(full):
            node["children"].append(build_dir_tree(full, root_dir))
        else:
            node["children"].append({
                "name": entry,
                "path": rel,
                "type": "file",
                "size": os.path.getsize(full) if os.path.exists(full) else 0
            })
            
    return node


class GetProjectFileTreeUseCase:
    def __init__(self, project_repo: IProjectRepository):
        self.project_repo = project_repo

    def execute(self, project_id: int) -> Dict[str, Any]:
        project = self.project_repo.get_by_id(project_id)
        if not project:
            raise ValueError(f"Project with ID {project_id} not found.")

        if not project.store_local_copy:
            raise ValueError("Local project copy was not requested when this project was created. Turn on 'Keep Local Project Copy' and re-sync.")

        local_path = project.local_saved_path
        if not local_path or not os.path.exists(local_path):
            raise FileNotFoundError("Local project files not found on server disk. Please re-sync the project.")

        tree = build_dir_tree(local_path, local_path)
        return {
            "project_id": project_id,
            "project_name": project.name,
            "tree": tree
        }


class GetProjectFileContentUseCase:
    def __init__(self, project_repo: IProjectRepository):
        self.project_repo = project_repo

    def execute(self, project_id: int, file_path: str) -> Dict[str, Any]:
        project = self.project_repo.get_by_id(project_id)
        if not project:
            raise ValueError(f"Project with ID {project_id} not found.")

        if not project.store_local_copy:
            raise ValueError("Local project copy is disabled for this project.")

        local_path = project.local_saved_path
        if not local_path or not os.path.exists(local_path):
            raise FileNotFoundError("Local project files not found on server disk. Please re-sync the project.")

        # Path Traversal Prevention
        target_abs = os.path.abspath(os.path.join(local_path, file_path))
        base_abs = os.path.abspath(local_path)
        if os.path.commonpath([target_abs, base_abs]) != base_abs:
            raise PermissionError("Access denied: Invalid file path.")

        if not os.path.exists(target_abs) or not os.path.isfile(target_abs):
            raise FileNotFoundError(f"File '{file_path}' not found on server disk.")

        try:
            with open(target_abs, 'r', encoding='utf-8', errors='replace') as f:
                content = f.read()
        except Exception as e:
            raise RuntimeError(f"Could not read file: {str(e)}")

        return {
            "project_id": project_id,
            "file_path": file_path,
            "content": content
        }
