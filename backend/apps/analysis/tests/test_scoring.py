"""Unit tests for server-side scoring functions. No DB needed — pure arithmetic."""

from apps.analysis.services.scoring import compute_ghost_score, score_to_recommendation


class TestComputeGhostScore:
    def test_all_zero(self):
        scores = {"ghost_signals": 0, "scam_signals": 0, "toxic_culture": 0, "market_reality": 0}
        assert compute_ghost_score(scores) == 0

    def test_all_hundred(self):
        scores = {"ghost_signals": 100, "scam_signals": 100, "toxic_culture": 100, "market_reality": 100}
        assert compute_ghost_score(scores) == 100

    def test_formula_correctness(self):
        scores = {"ghost_signals": 80, "scam_signals": 60, "toxic_culture": 40, "market_reality": 50}
        # 80*0.30 + 60*0.25 + 40*0.20 + 50*0.25 = 24 + 15 + 8 + 12.5 = 59.5 → round to 60
        assert compute_ghost_score(scores) == 60

    def test_boundary_30(self):
        scores = {"ghost_signals": 30, "scam_signals": 30, "toxic_culture": 30, "market_reality": 30}
        assert compute_ghost_score(scores) == 30

    def test_boundary_31(self):
        scores = {"ghost_signals": 31, "scam_signals": 31, "toxic_culture": 31, "market_reality": 31}
        assert compute_ghost_score(scores) == 31

    def test_boundary_60(self):
        scores = {"ghost_signals": 60, "scam_signals": 60, "toxic_culture": 60, "market_reality": 60}
        assert compute_ghost_score(scores) == 60

    def test_boundary_61(self):
        scores = {"ghost_signals": 61, "scam_signals": 61, "toxic_culture": 61, "market_reality": 61}
        assert compute_ghost_score(scores) == 61

    def test_missing_categories_default_to_zero(self):
        scores = {"ghost_signals": 100}
        # 100*0.30 = 30
        assert compute_ghost_score(scores) == 30

    def test_empty_dict(self):
        assert compute_ghost_score({}) == 0

    def test_clamping_over_100(self):
        scores = {"ghost_signals": 200, "scam_signals": 0, "toxic_culture": 0, "market_reality": 0}
        # Clamped to 100 → 100*0.30 = 30
        assert compute_ghost_score(scores) == 30

    def test_clamping_negative(self):
        scores = {"ghost_signals": -10, "scam_signals": 50, "toxic_culture": 50, "market_reality": 50}
        # -10 clamped to 0 → 0*0.30 + 50*0.25 + 50*0.20 + 50*0.25 = 0 + 12.5 + 10 + 12.5 = 35
        assert compute_ghost_score(scores) == 35


class TestScoreToRecommendation:
    def test_zero(self):
        assert score_to_recommendation(0) == "apply_confidently"

    def test_30(self):
        assert score_to_recommendation(30) == "apply_confidently"

    def test_31(self):
        assert score_to_recommendation(31) == "apply_with_caution"

    def test_60(self):
        assert score_to_recommendation(60) == "apply_with_caution"

    def test_61(self):
        assert score_to_recommendation(61) == "likely_fake"

    def test_100(self):
        assert score_to_recommendation(100) == "likely_fake"
