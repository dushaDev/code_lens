"""
Shared author identity utilities for use cases.
Zero DB/framework imports — depends only on the IAuthorRepository interface.
"""
from typing import Dict, List


def build_canonical_map(author_repo, authors) -> Dict[int, int]:
    """
    Walk each author's canonical_author_id chain and return a flat mapping:
        { raw_author_id -> canonical_root_id }

    Uses a visited-set to prevent infinite loops on malformed data.
    This is the single authoritative implementation of the canonical walk —
    do NOT inline this loop in any other use case.
    """
    canonical_id_map: Dict[int, int] = {}
    for a in authors:
        curr_id = a.id
        visited: set = set()
        while curr_id is not None and curr_id not in visited:
            visited.add(curr_id)
            author = author_repo.get_by_id(curr_id)
            if not author or author.canonical_author_id is None:
                break
            curr_id = author.canonical_author_id
        canonical_id_map[a.id] = curr_id or a.id
    return canonical_id_map
