"""Server-side weighted score computation — never trust LLM arithmetic."""

WEIGHTS = {
    "ghost_signals": 0.30,
    "scam_signals": 0.25,
    "toxic_culture": 0.20,
    "market_reality": 0.25,
}


def compute_ghost_score(category_scores: dict) -> int:
    """Compute weighted composite ghost score from category scores.

    Formula: ghost_signals * 0.30 + scam_signals * 0.25 + toxic_culture * 0.20 + market_reality * 0.25
    Each category is clamped to 0-100. Missing categories default to 0.
    """
    total = 0.0
    for category, weight in WEIGHTS.items():
        raw = category_scores.get(category, 0)
        clamped = max(0, min(100, raw))
        total += clamped * weight
    return round(total)


def score_to_recommendation(ghost_score: int) -> str:
    """Map ghost score to recommendation string.

    0-30: apply_confidently, 31-60: apply_with_caution, 61-100: likely_fake
    """
    if ghost_score <= 30:
        return "apply_confidently"
    if ghost_score <= 60:
        return "apply_with_caution"
    return "likely_fake"
