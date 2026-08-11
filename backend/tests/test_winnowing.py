"""
Unit Tests for AST-Based Winnowing Code Similarity Engine
"""

import os
import sys
import tempfile

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.infrastructure.services.winnowing_engine import (
    AstParserService,
    PythonAstNormalizer,
    WinnowingService,
    SimilarityComparator,
    FileCollector,
)


def test_python_ast_normalization_variable_renaming():
    code1 = """
def calculate_sum(a, b):
    result = a + b
    if result > 10:
        return result * 2
    return result
"""
    code2 = """
def compute_total(x, y):
    val = x + y
    if val > 10:
        return val * 2
    return val
"""
    with tempfile.TemporaryDirectory() as tmpdir:
        path1 = os.path.join(tmpdir, "p1.py")
        path2 = os.path.join(tmpdir, "p2.py")

        with open(path1, "w") as f:
            f.write(code1)
        with open(path2, "w") as f:
            f.write(code2)

        parser = AstParserService()
        tokens1 = parser.parse_file(path1, "p1.py")
        tokens2 = parser.parse_file(path2, "p2.py")

        token_list1 = [t.token for t in tokens1]
        token_list2 = [t.token for t in tokens2]

        # Normalized structure should be 100% identical despite variable & function name changes
        assert token_list1 == token_list2


def test_winnowing_fingerprint_generation_and_pairwise_matching():
    code1 = """
def process_data(items):
    out = []
    for item in items:
        if item % 2 == 0:
            out.append(item * 10)
    return out
"""
    # Renamed variables and function name
    code2 = """
def filter_and_scale(elements):
    output = []
    for e in elements:
        if e % 2 == 0:
            output.append(e * 10)
    return output
"""
    # Completely different logic
    code3 = """
import sys

class DataLogger:
    def __init__(self, filename):
        self.filename = filename

    def write_log(self, msg):
        with open(self.filename, 'a') as f:
            f.write(msg)
"""
    with tempfile.TemporaryDirectory() as tmpdir:
        p1_path = os.path.join(tmpdir, "p1.py")
        p2_path = os.path.join(tmpdir, "p2.py")
        p3_path = os.path.join(tmpdir, "p3.py")

        with open(p1_path, "w") as f:
            f.write(code1)
        with open(p2_path, "w") as f:
            f.write(code2)
        with open(p3_path, "w") as f:
            f.write(code3)

        parser = AstParserService()
        winnowing = WinnowingService(k=3, w=2)

        fps1 = winnowing.generate_fingerprints(parser.parse_file(p1_path, "p1.py"))
        fps2 = winnowing.generate_fingerprints(parser.parse_file(p2_path, "p2.py"))
        fps3 = winnowing.generate_fingerprints(parser.parse_file(p3_path, "p3.py"))

        comparator = SimilarityComparator(review_threshold=10.0)
        fingerprints_map = {
            1: fps1,
            2: fps2,
            3: fps3,
        }

        results = comparator.compute_pairwise_similarity(fingerprints_map)

        # Pair (1, 2) should have near 100% similarity score
        match_1_2 = next((r for r in results if (r["project_a_id"] == 1 and r["project_b_id"] == 2)), None)
        assert match_1_2 is not None
        assert match_1_2["similarity_score"] >= 90.0

        # Pair (1, 3) should have low or no flagged similarity
        match_1_3 = next((r for r in results if (r["project_a_id"] == 1 and r["project_b_id"] == 3)), None)
        if match_1_3:
            assert match_1_3["similarity_score"] < 40.0


def test_file_collector_exclusions():
    collector = FileCollector()
    with tempfile.TemporaryDirectory() as tmpdir:
        # Create valid source file
        src_file = os.path.join(tmpdir, "main.py")
        with open(src_file, "w") as f:
            f.write("print('hello')")

        # Create excluded directory and file
        nm_dir = os.path.join(tmpdir, "node_modules")
        os.makedirs(nm_dir)
        with open(os.path.join(nm_dir, "lib.js"), "w") as f:
            f.write("console.log('test')")

        collected = collector.collect_files(tmpdir)
        assert "main.py" in collected
        assert not any("node_modules" in p for p in collected)


if __name__ == "__main__":
    print("Running Winnowing AST tests...")
    test_python_ast_normalization_variable_renaming()
    print("[OK] test_python_ast_normalization_variable_renaming PASSED")
    test_winnowing_fingerprint_generation_and_pairwise_matching()
    print("[OK] test_winnowing_fingerprint_generation_and_pairwise_matching PASSED")
    test_file_collector_exclusions()
    print("[OK] test_file_collector_exclusions PASSED")
    print("ALL WINNOWING ENGINE TESTS PASSED SUCCESSFULLY!")
