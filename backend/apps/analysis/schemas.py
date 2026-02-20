"""Pydantic models for request/response validation.

These replace DRF serializers. Used for:
- Validating incoming API request bodies
- Validating LLM response JSON
- Defining response shapes
"""

from typing import Literal

from pydantic import BaseModel, Field, model_validator


class AnalyzeRequest(BaseModel):
    """Validates incoming POST /api/v1/analyze/ body from extension."""

    url: str = ""
    job_title: str = Field(min_length=1, max_length=255)
    company_name: str = Field(min_length=1, max_length=255)
    description: str = Field(min_length=1, max_length=12000)
    requirements: str | None = None
    salary_text: str | None = None
    posting_date: str | None = None
    source: Literal["dom_extraction", "manual_paste"]
    device_fingerprint: str = Field(min_length=1)

    @model_validator(mode="after")
    def validate_url_and_coerce_requirements(self):
        """Require url for dom_extraction; coerce None requirements to empty string."""
        if self.source == "dom_extraction" and not self.url:
            raise ValueError("url is required for dom_extraction source")
        if self.requirements is None:
            self.requirements = ""
        return self


class FeedbackRequest(BaseModel):
    """Validates incoming POST /api/v1/feedback/ body from extension."""

    analysis_id: str = Field(min_length=1, max_length=36)
    feedback_type: Literal["confirmed_real", "confirmed_fake"]
    device_fingerprint: str = Field(min_length=1)


class CategoryScores(BaseModel):
    """Per-category scores from LLM (each 0-100, independent)."""

    ghost_signals: int = Field(ge=0, le=100)
    scam_signals: int = Field(ge=0, le=100)
    toxic_culture: int = Field(ge=0, le=100)
    market_reality: int = Field(ge=0, le=100)


class RedFlag(BaseModel):
    """A single red flag detected by the LLM."""

    category: Literal["ghost_signals", "scam_signals", "toxic_culture", "market_reality"]
    signal: str
    severity: Literal["low", "medium", "high"]
    explanation: str


class LLMResponse(BaseModel):
    """Validates structured JSON output from LLM."""

    category_scores: CategoryScores
    red_flags: list[RedFlag]
    recommendation: str
    signals_checked: int = Field(ge=0)
