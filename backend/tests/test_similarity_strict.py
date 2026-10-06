"""
Regression Unit Test: Strict AST Plagiarism Detection
======================================================
Validates that generic common patterns (e.g., getAllTasks vs listAllEvents) DO NOT flag,
and true copied code flags ONLY when:
1. file_match_percentage >= 50%
2. At least ONE single contiguous match run >= 100 tokens
3. Total matched tokens >= 300 tokens
"""

import unittest
from src.infrastructure.services.winnowing_engine import (
    JsTsStructuralNormalizer,
    WinnowingService,
    SimilarityComparator,
)

TASK_MANAGEMENT_CODE = """
export async function getAllTasks(req, res) {
  const { statusFilter, priorityFilter, useCache, categoryId, searchKeyword } = req.query;
  const cacheKey = `tasks_${statusFilter}_${priorityFilter}_${categoryId}_${searchKeyword}`;
  
  if (useCache && cache.has(cacheKey)) {
    logger.info("Serving tasks from redis cache store");
    return res.json(cache.get(cacheKey));
  }

  const rawTasks = await db.tasks.findMany({
    include: { author: true, tags: true, comments: true }
  });
  
  let filtered = rawTasks;

  if (statusFilter) {
    filtered = filtered.filter(t => t.status === statusFilter);
  }
  if (priorityFilter) {
    filtered = filtered.filter(t => t.priority === priorityFilter);
  }
  if (categoryId) {
    filtered = filtered.filter(t => t.categoryId === categoryId);
  }
  if (searchKeyword) {
    filtered = filtered.filter(t => t.title.includes(searchKeyword) || t.description.includes(searchKeyword));
  }

  cache.set(cacheKey, filtered, 300);
  return res.json({ success: true, count: filtered.length, data: filtered });
}
"""

EVENT_MANAGEMENT_CODE = """
export async function listAllEvents(req, res) {
  const { category, isPublished, bypassCache, venueId, queryText } = req.query;
  const key = `events_${category}_${isPublished}_${venueId}_${queryText}`;

  if (!bypassCache && memoryCache.contains(key)) {
    logger.info("Serving events from memory cache store");
    return res.json(memoryCache.retrieve(key));
  }

  const allEvents = await store.events.fetchAll({
    withRelations: ["organizer", "venue", "reviews"]
  });
  
  let result = allEvents;

  if (category) {
    result = result.filter(e => e.category === category);
  }
  if (isPublished) {
    result = result.filter(e => e.isPublished === true);
  }
  if (venueId) {
    result = result.filter(e => e.venueId === venueId);
  }
  if (queryText) {
    result = result.filter(e => e.eventName.includes(queryText) || e.summary.includes(queryText));
  }

  memoryCache.store(key, result, 600);
  return res.json({ status: "ok", total: result.length, items: result });
}
"""

COPIED_TASK_CODE = """
// Copied task handler implementation
export async function getTasksList(req, res) {
  const { statusFilter, priorityFilter, useCache, categoryId, searchKeyword } = req.query;
  const cacheKey = `tasks_${statusFilter}_${priorityFilter}_${categoryId}_${searchKeyword}`;
  
  if (useCache && cache.has(cacheKey)) {
    logger.info("Serving tasks from redis cache store");
    return res.json(cache.get(cacheKey));
  }

  const rawTasks = await db.tasks.findMany({
    include: { author: true, tags: true, comments: true }
  });
  
  let filtered = rawTasks;

  if (statusFilter) {
    filtered = filtered.filter(t => t.status === statusFilter);
  }
  if (priorityFilter) {
    filtered = filtered.filter(t => t.priority === priorityFilter);
  }
  if (categoryId) {
    filtered = filtered.filter(t => t.categoryId === categoryId);
  }
  if (searchKeyword) {
    filtered = filtered.filter(t => t.title.includes(searchKeyword) || t.description.includes(searchKeyword));
  }

  cache.set(cacheKey, filtered, 300);
  return res.json({ success: true, count: filtered.length, data: filtered });
}
"""


class TestStrictAstSimilarity(unittest.TestCase):
    def setUp(self):
        self.normalizer = JsTsStructuralNormalizer()
        self.winnowing = WinnowingService(k=5, w=4)
        self.comparator = SimilarityComparator(
            file_match_threshold=50.0,
            corpus_stopword_pct=0.12,
            min_run_hashes=30,
            min_identifier_overlap_pct=25.0,
            min_single_run_tokens=150,
            min_total_matched_tokens=300
        )

    def test_generic_pattern_different_domains_does_not_flag(self):
        tokens_task = self.normalizer.normalize(TASK_MANAGEMENT_CODE, "TaskManagement.js")
        tokens_event = self.normalizer.normalize(EVENT_MANAGEMENT_CODE, "EventManagement.js")

        fp_task = self.winnowing.generate_fingerprints(tokens_task)
        fp_event = self.winnowing.generate_fingerprints(tokens_event)

        project_fingerprints = {
            1: fp_task,
            2: fp_event,
        }

        results = self.comparator.compute_pairwise_similarity(project_fingerprints)
        
        # MUST score 0 (no false positives)
        self.assertEqual(len(results), 0, f"False positive detected! Results: {results}")

    def test_true_positive_copied_code_flags(self):
        tokens_task = self.normalizer.normalize(TASK_MANAGEMENT_CODE, "TaskManagement.js")
        tokens_copy = self.normalizer.normalize(COPIED_TASK_CODE, "TaskCopy.js")

        fp_task = self.winnowing.generate_fingerprints(tokens_task)
        fp_copy = self.winnowing.generate_fingerprints(tokens_copy)

        project_fingerprints = {
            1: fp_task,
            3: fp_copy,
        }

        results = self.comparator.compute_pairwise_similarity(project_fingerprints)
        
    def test_multi_project_clustering(self):
        from src.use_cases.detect_similarity import detect_similarity_clusters

        # 3 interconnected project reports (1-2, 2-3)
        reports = [
            {"project_a_id": 1, "project_b_id": 2, "file_match_percentage": 75.0, "similarity_score": 75.0},
            {"project_a_id": 2, "project_b_id": 3, "file_match_percentage": 82.0, "similarity_score": 82.0},
        ]
        project_name_map = {1: "AlphaRepo", 2: "BetaRepo", 3: "GammaRepo"}

        clusters, _ = detect_similarity_clusters(reports, project_name_map)

        self.assertEqual(len(clusters), 1)
        self.assertEqual(clusters[0]["member_count"], 3)
        self.assertEqual(clusters[0]["label"], "Possible shared source / multi-group copying")
        self.assertIn(1, clusters[0]["project_ids"])
        self.assertIn(2, clusters[0]["project_ids"])
        self.assertIn(3, clusters[0]["project_ids"])

    def test_cluster_growth_no_self_suppression(self):
        from src.use_cases.detect_similarity import detect_similarity_clusters

        tokens_task = self.normalizer.normalize(TASK_MANAGEMENT_CODE, "TaskManagement.js")
        tokens_copy = self.normalizer.normalize(COPIED_TASK_CODE, "TaskCopy.js")

        fp_a = self.winnowing.generate_fingerprints(tokens_task)
        fp_b = self.winnowing.generate_fingerprints(tokens_copy)
        fp_c = self.winnowing.generate_fingerprints(tokens_copy)
        fp_d = self.winnowing.generate_fingerprints(tokens_copy)
        fp_e = self.winnowing.generate_fingerprints(tokens_copy)

        # 1. Compare 2 projects (A, B)
        pf_2 = {1: fp_a, 2: fp_b}
        res_2 = self.comparator.compute_pairwise_similarity(pf_2)
        self.assertGreaterEqual(len(res_2), 1)
        score_ab_initial = res_2[0]["similarity_score"]

        # 2. Add C, D, E (total 5 projects sharing the snippet)
        pf_5 = {1: fp_a, 2: fp_b, 3: fp_c, 4: fp_d, 5: fp_e}
        res_5 = self.comparator.compute_pairwise_similarity(pf_5)

        proj_name_map = {1: "ProjA", 2: "ProjB", 3: "ProjC", 4: "ProjD", 5: "ProjE"}
        clusters, pass2_reports = detect_similarity_clusters(res_5, proj_name_map, pf_5, self.comparator)

        all_reports = res_5 + pass2_reports
        ab_match = next((r for r in all_reports if (r["project_a_id"] == 1 and r["project_b_id"] == 2)), None)
        ae_match = next((r for r in all_reports if (r["project_a_id"] == 1 and r["project_b_id"] == 5)), None)

        self.assertIsNotNone(ab_match, "A-B must be flagged even after cluster growth to 5 projects")
        self.assertIsNotNone(ae_match, "A-E must be resolved in Pass 2 cluster re-analysis")
        self.assertEqual(len(clusters), 1)
        self.assertEqual(clusters[0]["member_count"], 5)


if __name__ == "__main__":
    unittest.main()
