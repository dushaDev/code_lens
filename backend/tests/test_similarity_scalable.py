import time
import unittest
from datetime import datetime, timedelta
from typing import Dict, List

from src.infrastructure.services.winnowing_engine import (
    Fingerprint,
    JsTsStructuralNormalizer,
    SimilarityComparator,
    WinnowingService,
)
from src.use_cases.detect_similarity import (
    DisjointSetUnion,
    detect_similarity_clusters,
)

SAMPLE_CODE_ORIGINAL = """
function processUserOrders(orders) {
  if (!orders || orders.length === 0) {
    return { status: "empty", count: 0, items: [] };
  }
  let validOrders = orders.filter(o => o.status === "ACTIVE" && o.totalAmount > 0);
  let totalRevenue = validOrders.reduce((sum, item) => sum + item.totalAmount, 0);
  let sortedOrders = validOrders.sort((a, b) => b.createdAt - a.createdAt);
  return { status: "processed", count: sortedOrders.length, revenue: totalRevenue, data: sortedOrders };
}
"""

SAMPLE_CODE_COPY = """
function processUserOrders(ordersList) {
  if (!ordersList || ordersList.length === 0) {
    return { status: "empty", count: 0, items: [] };
  }
  let activeList = ordersList.filter(item => item.status === "ACTIVE" && item.totalAmount > 0);
  let revSum = activeList.reduce((acc, obj) => acc + obj.totalAmount, 0);
  let sortedItems = activeList.sort((x, y) => y.createdAt - x.createdAt);
  return { status: "processed", count: sortedItems.length, revenue: revSum, data: sortedItems };
}
"""

SAMPLE_CODE_UNIQUE = """
function calculateMatrixDeterminant(matrix) {
  if (matrix.length !== matrix[0].length) {
    throw new Error("Matrix must be square");
  }
  let n = matrix.length;
  if (n === 1) return matrix[0][0];
  if (n === 2) return matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0];
  let det = 0;
  for (let i = 0; i < n; i++) {
    det += Math.pow(-1, i) * matrix[0][i] * calculateMatrixDeterminant(getMinor(matrix, 0, i));
  }
  return det;
}
"""


class TestScalableSimilarityArchitecture(unittest.TestCase):
    def setUp(self):
        self.normalizer = JsTsStructuralNormalizer()
        self.winnowing = WinnowingService(k=5, w=4)
        self.comparator = SimilarityComparator(
            file_match_threshold=50.0,
            corpus_stopword_pct=0.12,
            min_run_hashes=10,
            min_single_run_tokens=50,
            min_total_matched_tokens=100
        )

    def test_complete_coverage_late_submission_guarantee(self):
        """10b: Late project submission must trigger complete pairwise comparison against all early projects."""
        tokens_orig = self.normalizer.normalize(SAMPLE_CODE_ORIGINAL, "Original.js")
        tokens_copy = self.normalizer.normalize(SAMPLE_CODE_COPY, "LateCopy.js")

        fp_early_1 = self.winnowing.generate_fingerprints(tokens_orig)
        fp_early_2 = self.winnowing.generate_fingerprints(self.normalizer.normalize(SAMPLE_CODE_UNIQUE, "Unique.js"))
        fp_late_3 = self.winnowing.generate_fingerprints(tokens_copy)

        # Step 1: Early projects (1 & 2)
        pf_early = {1: fp_early_1, 2: fp_early_2}
        res_early = self.comparator.compute_pairwise_similarity(pf_early)

        # Step 2: Late project 3 submitted. Enqueue comparison against ALL existing projects (1 & 2)
        pf_all = {1: fp_early_1, 2: fp_early_2, 3: fp_late_3}
        res_all = self.comparator.compute_pairwise_similarity(pf_all)

        # Match 1-3 MUST be detected
        match_1_3 = next((r for r in res_all if (r["project_a_id"] == 1 and r["project_b_id"] == 3)), None)
        self.assertIsNotNone(match_1_3, "Late submission (3) must match early project (1)")
        self.assertGreaterEqual(match_1_3["similarity_score"], 50.0)

    def test_origin_likelihood_timestamp_ranking(self):
        """10a & PART 2: Cluster origin likelihood ranks project with earliest submission timestamp."""
        now = datetime.utcnow()
        time_map = {
            1: now - timedelta(hours=10), # Earliest (Original)
            2: now - timedelta(hours=5),  # Copy
            3: now - timedelta(hours=1),  # Copy
        }
        reports = [
            {"project_a_id": 1, "project_b_id": 2, "file_match_percentage": 85.0, "similarity_score": 85.0},
            {"project_a_id": 2, "project_b_id": 3, "file_match_percentage": 80.0, "similarity_score": 80.0},
        ]
        name_map = {1: "FirstSubmittedRepo", 2: "SecondRepo", 3: "ThirdRepo"}

        clusters, _ = detect_similarity_clusters(reports, name_map, project_time_map=time_map)

        self.assertEqual(len(clusters), 1)
        self.assertEqual(clusters[0]["probable_origin"]["id"], 1)
        self.assertEqual(clusters[0]["probable_origin"]["name"], "FirstSubmittedRepo")
        self.assertTrue(clusters[0]["probable_origin"]["is_probable_origin"])

    def test_cluster_as_one_unit_suppression_at_scale(self):
        """10d: Cluster growing to 10+ projects does NOT self-suppress as boilerplate."""
        tokens_orig = self.normalizer.normalize(SAMPLE_CODE_ORIGINAL, "Original.js")
        tokens_copy = self.normalizer.normalize(SAMPLE_CODE_COPY, "Copy.js")

        fp_orig = self.winnowing.generate_fingerprints(tokens_orig)
        fp_copy = self.winnowing.generate_fingerprints(tokens_copy)

        # 12 projects in 1 cluster sharing the copied code
        pf = {1: fp_orig}
        for pid in range(2, 13):
            pf[pid] = fp_copy

        # Build cluster_map where projects 1..12 are in Cluster 100
        cluster_map = {pid: 100 for pid in range(1, 13)}

        # Run similarity with cluster_map
        results = self.comparator.compute_pairwise_similarity(pf, cluster_map=cluster_map)

        # Hashes MUST NOT be suppressed as stopwords; matches MUST survive
        self.assertGreater(len(results), 0, "Cluster of 12 projects must NOT self-suppress as boilerplate")
        self.assertGreaterEqual(results[0]["similarity_score"], 50.0)

    def test_inverted_index_matching_scale_performance(self):
        """10c: Scale test across 500 simulated project fingerprint sets verifying fast linear inverted-index matching."""
        tokens_orig = self.normalizer.normalize(SAMPLE_CODE_ORIGINAL, "Original.js")
        fp_orig = self.winnowing.generate_fingerprints(tokens_orig)

        # Generate 500 project fingerprint sets (10 projects share fp_orig, 490 have distinct unique code)
        pf: Dict[int, List[Fingerprint]] = {}
        for pid in range(1, 501):
            if pid % 50 == 0:
                pf[pid] = fp_orig
            else:
                unique_code = f"function uniqueServiceMethod_{pid}() {{ return {pid} * 42 + Math.random(); }}"
                tokens_u = self.normalizer.normalize(unique_code, f"Unique_{pid}.js")
                pf[pid] = self.winnowing.generate_fingerprints(tokens_u)

        t0 = time.time()
        results = self.comparator.compute_pairwise_similarity(pf)
        elapsed = time.time() - t0

        # Performance assertion: 500 projects compared via inverted index in under 1.0 seconds
        self.assertLess(elapsed, 1.0, f"500-project inverted index comparison should take < 1s, took {elapsed:.2f}s")


if __name__ == "__main__":
    unittest.main()
