"""Tests for AI analyzer service — parsing, code-fence stripping, retry logic, fallback."""

import json
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from apps.analysis.schemas import LLMResponse
from apps.analysis.services.ai_analyzer import (
    AnalysisUnavailableError,
    _build_user_prompt,
    _parse_llm_response,
    _strip_code_fences,
    _try_provider,
    analyze_job_listing,
)

# Valid LLM JSON that passes Pydantic validation
VALID_LLM_JSON = json.dumps({
    "category_scores": {"ghost_signals": 70, "scam_signals": 50, "toxic_culture": 40, "market_reality": 60},
    "red_flags": [
        {
            "category": "ghost_signals",
            "signal": "Posting is 90 days old",
            "severity": "high",
            "explanation": "Jobs open this long are often ghost jobs.",
        }
    ],
    "recommendation": "apply_with_caution",
    "signals_checked": 12,
})


class TestStripCodeFences:
    def test_plain_json_unchanged(self):
        raw = '{"key": "value"}'
        assert _strip_code_fences(raw) == '{"key": "value"}'

    def test_json_code_fence(self):
        raw = '```json\n{"key": "value"}\n```'
        assert _strip_code_fences(raw) == '{"key": "value"}'

    def test_plain_code_fence_no_language(self):
        raw = '```\n{"key": "value"}\n```'
        assert _strip_code_fences(raw) == '{"key": "value"}'

    def test_code_fence_with_surrounding_whitespace(self):
        raw = '  ```json\n{"key": "value"}\n```  '
        assert _strip_code_fences(raw) == '{"key": "value"}'

    def test_multiline_json_in_fence(self):
        inner = '{\n  "category_scores": {\n    "ghost_signals": 70\n  }\n}'
        raw = f"```json\n{inner}\n```"
        result = _strip_code_fences(raw)
        assert json.loads(result)["category_scores"]["ghost_signals"] == 70

    def test_no_fences_returns_as_is(self):
        raw = '{"already": "clean"}'
        assert _strip_code_fences(raw) == raw


class TestParseLlmResponse:
    def test_valid_json(self):
        result = _parse_llm_response(VALID_LLM_JSON)
        assert isinstance(result, LLMResponse)
        assert result.category_scores.ghost_signals == 70
        assert result.signals_checked == 12
        assert len(result.red_flags) == 1

    def test_code_fenced_json(self):
        fenced = f"```json\n{VALID_LLM_JSON}\n```"
        result = _parse_llm_response(fenced)
        assert isinstance(result, LLMResponse)
        assert result.category_scores.ghost_signals == 70

    def test_malformed_json_raises(self):
        with pytest.raises(json.JSONDecodeError):
            _parse_llm_response("this is not json at all")

    def test_valid_json_but_wrong_schema_raises(self):
        with pytest.raises(ValidationError):
            _parse_llm_response('{"wrong_field": 42}')

    def test_missing_required_field_raises(self):
        incomplete = json.dumps({
            "category_scores": {"ghost_signals": 70, "scam_signals": 50, "toxic_culture": 40, "market_reality": 60},
            "red_flags": [],
            # missing recommendation and signals_checked
        })
        with pytest.raises(ValidationError):
            _parse_llm_response(incomplete)

    def test_category_score_out_of_range_raises(self):
        bad_scores = json.dumps({
            "category_scores": {"ghost_signals": 150, "scam_signals": 50, "toxic_culture": 40, "market_reality": 60},
            "red_flags": [],
            "recommendation": "apply_confidently",
            "signals_checked": 5,
        })
        with pytest.raises(ValidationError):
            _parse_llm_response(bad_scores)


class TestBuildUserPrompt:
    def test_all_fields_present(self):
        data = {
            "job_title": "Python Developer",
            "company_name": "Acme Corp",
            "description": "Build APIs",
            "requirements": "3+ years Python",
            "salary_text": "10-15 LPA",
            "posting_date": "2026-01-15",
            "source": "dom_extraction",
        }
        prompt = _build_user_prompt(data)
        assert "Job Title: Python Developer" in prompt
        assert "Company: Acme Corp" in prompt
        assert "Description: Build APIs" in prompt
        assert "Requirements: 3+ years Python" in prompt
        assert "Salary: 10-15 LPA" in prompt
        assert "Posting Date: 2026-01-15" in prompt
        assert "Source: dom_extraction" in prompt

    def test_missing_optional_fields(self):
        data = {
            "job_title": "Dev",
            "company_name": "Corp",
            "description": "Work here",
        }
        prompt = _build_user_prompt(data)
        assert "Salary: Not mentioned" in prompt
        assert "Posting Date: Not available" in prompt
        assert "Requirements:" not in prompt

    def test_empty_dict(self):
        prompt = _build_user_prompt({})
        assert "Job Title: N/A" in prompt
        assert "Company: N/A" in prompt
        assert "Salary: Not mentioned" in prompt


class TestTryProvider:
    def test_success_on_first_attempt(self):
        mock_fn = MagicMock(return_value=(VALID_LLM_JSON, 100))
        result, tokens = _try_provider(mock_fn, "test prompt", "test-model")
        assert isinstance(result, LLMResponse)
        assert tokens == 100
        assert mock_fn.call_count == 1

    def test_retry_on_parse_failure_then_success(self):
        # First call returns bad JSON, second call returns valid JSON
        mock_fn = MagicMock(side_effect=[("not valid json", 50), (VALID_LLM_JSON, 60)])
        result, tokens = _try_provider(mock_fn, "test prompt", "test-model")
        assert isinstance(result, LLMResponse)
        assert tokens == 110  # 50 + 60
        assert mock_fn.call_count == 2

    def test_both_attempts_fail_raises(self):
        mock_fn = MagicMock(side_effect=[("bad json", 50), ("still bad json", 60)])
        with pytest.raises(json.JSONDecodeError):
            _try_provider(mock_fn, "test prompt", "test-model")

    def test_api_error_raises_immediately_no_retry(self):
        """API/network errors should raise immediately, not trigger a parse-failure retry."""
        mock_fn = MagicMock(side_effect=ConnectionError("network down"))
        with pytest.raises(ConnectionError):
            _try_provider(mock_fn, "test prompt", "test-model")
        assert mock_fn.call_count == 1

    def test_pydantic_validation_error_triggers_retry(self):
        """Pydantic ValidationError is a ValueError subclass — should retry."""
        bad_schema = json.dumps({"wrong": "structure"})
        mock_fn = MagicMock(side_effect=[(bad_schema, 50), (VALID_LLM_JSON, 60)])
        result, tokens = _try_provider(mock_fn, "test prompt", "test-model")
        assert isinstance(result, LLMResponse)
        assert mock_fn.call_count == 2


class TestAnalyzeJobListing:
    @patch("apps.analysis.services.ai_analyzer._call_gemini")
    def test_gemini_success(self, mock_gemini):
        mock_gemini.return_value = (VALID_LLM_JSON, 200)
        result, model, tokens = analyze_job_listing({"job_title": "Dev", "company_name": "Corp", "description": "Hi"})
        assert isinstance(result, LLMResponse)
        assert model == "gemini-2.5-flash"
        assert tokens == 200

    @patch("apps.analysis.services.ai_analyzer._call_openai")
    @patch("apps.analysis.services.ai_analyzer._call_gemini")
    def test_gemini_fails_openai_succeeds(self, mock_gemini, mock_openai):
        mock_gemini.side_effect = ConnectionError("Gemini down")
        mock_openai.return_value = (VALID_LLM_JSON, 150)
        result, model, tokens = analyze_job_listing({"job_title": "Dev", "company_name": "Corp", "description": "Hi"})
        assert isinstance(result, LLMResponse)
        assert model == "gpt-4o-mini"
        assert tokens == 150

    @patch("apps.analysis.services.ai_analyzer._call_openai")
    @patch("apps.analysis.services.ai_analyzer._call_gemini")
    def test_both_fail_raises_unavailable(self, mock_gemini, mock_openai):
        mock_gemini.side_effect = ConnectionError("Gemini down")
        mock_openai.side_effect = ConnectionError("OpenAI down")
        with pytest.raises(AnalysisUnavailableError, match="Both AI providers failed"):
            analyze_job_listing({"job_title": "Dev", "company_name": "Corp", "description": "Hi"})

    @patch("apps.analysis.services.ai_analyzer._call_gemini")
    def test_gemini_parse_failure_retries_then_succeeds(self, mock_gemini):
        """Gemini returns bad JSON on first try, valid on retry."""
        mock_gemini.side_effect = [("not json", 50), (VALID_LLM_JSON, 60)]
        result, model, tokens = analyze_job_listing({"job_title": "Dev", "company_name": "Corp", "description": "Hi"})
        assert model == "gemini-2.5-flash"
        assert tokens == 110
