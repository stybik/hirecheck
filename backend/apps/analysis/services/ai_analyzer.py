"""AI analysis service — Gemini 2.5 Flash primary, GPT-4o-mini fallback."""

import json
import logging
import re

from django.conf import settings

from apps.analysis.schemas import LLMResponse

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are a job listing analyst specializing in detecting ghost jobs, "
    "scam postings, and toxic workplace signals in the Indian job market. "
    "Analyze the provided job listing and return a JSON response with the "
    "following structure:\n\n"
    "1. category_scores: Object with INDEPENDENT scores (each 0-100):\n"
    "   - ghost_signals: Score for ghost job likelihood\n"
    "   - scam_signals: Score for scam indicators\n"
    "   - toxic_culture: Score for toxic workplace signals\n"
    "   - market_reality: Score for market/salary red flags\n"
    "   NOTE: Each score is independent. Do NOT try to make them sum\n"
    "   to any particular total. The server computes the composite.\n\n"
    "2. red_flags: Array of top 3 most significant flags, each with:\n"
    "   - category: ghost_signals | scam_signals | toxic_culture | market_reality\n"
    "   - signal: One-sentence description of the specific issue found\n"
    "   - severity: low | medium | high\n"
    "   - explanation: 2-3 sentence explanation a job seeker can understand\n\n"
    "3. recommendation: apply_confidently | apply_with_caution | likely_fake\n\n"
    "4. signals_checked: Integer count of total signals you evaluated\n\n"
    "RULES:\n"
    "- Only flag issues DIRECTLY evidenced in the provided text\n"
    "- Do NOT hallucinate or infer information not present\n"
    "- If salary is not mentioned, flag as concern with medium severity\n"
    "- Consider Indian job market norms (LPA salary format, etc.)\n"
    "- Staffing agencies with ongoing mandates should score LOWER on\n"
    "  posting age in ghost_signals (long-running listings are normal)\n"
    "- Return ONLY valid JSON. No markdown fences, no commentary."
)


class AnalysisUnavailableError(Exception):
    """Raised when both AI providers fail and retry is exhausted."""


def _build_user_prompt(job_data: dict) -> str:
    """Build the user message from job listing data."""
    parts = [
        f"Job Title: {job_data.get('job_title', 'N/A')}",
        f"Company: {job_data.get('company_name', 'N/A')}",
        f"Description: {job_data.get('description', 'N/A')}",
    ]
    if job_data.get("requirements"):
        parts.append(f"Requirements: {job_data['requirements']}")
    if job_data.get("salary_text"):
        parts.append(f"Salary: {job_data['salary_text']}")
    else:
        parts.append("Salary: Not mentioned")
    if job_data.get("posting_date"):
        parts.append(f"Posting Date: {job_data['posting_date']}")
    else:
        parts.append("Posting Date: Not available")
    parts.append(f"Source: {job_data.get('source', 'unknown')}")
    return "\n".join(parts)


def _strip_code_fences(text: str) -> str:
    """Strip markdown code fences (```json...```) from LLM output."""
    text = text.strip()
    pattern = r"^```(?:json)?\s*\n?(.*?)\n?\s*```$"
    match = re.match(pattern, text, re.DOTALL)
    if match:
        return match.group(1).strip()
    return text


def _parse_llm_response(raw_text: str) -> LLMResponse:
    """Parse and validate LLM response text into LLMResponse model."""
    cleaned = _strip_code_fences(raw_text)
    data = json.loads(cleaned)
    return LLMResponse.model_validate(data)


def _call_gemini(user_prompt: str, retry_prompt: str | None = None) -> tuple[str, int]:
    """Call Gemini 2.5 Flash and return (response_text, tokens_used)."""
    import google.generativeai as genai

    genai.configure(api_key=settings.GEMINI_API_KEY)

    model = genai.GenerativeModel(
        "gemini-2.5-flash",
        system_instruction=SYSTEM_PROMPT,
        generation_config=genai.GenerationConfig(
            response_mime_type="application/json",
            temperature=0.1,
        ),
    )

    prompt = user_prompt
    if retry_prompt:
        prompt = f"{user_prompt}\n\nIMPORTANT: {retry_prompt}"

    response = model.generate_content(prompt, request_options={"timeout": 30})

    tokens_used = 0
    if response.usage_metadata:
        tokens_used = (response.usage_metadata.prompt_token_count or 0) + (
            response.usage_metadata.candidates_token_count or 0
        )

    return response.text, tokens_used


def _call_openai(user_prompt: str, retry_prompt: str | None = None) -> tuple[str, int]:
    """Call GPT-4o-mini and return (response_text, tokens_used)."""
    from openai import OpenAI

    client = OpenAI(api_key=settings.OPENAI_API_KEY)

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]
    if retry_prompt:
        messages.append({"role": "user", "content": f"IMPORTANT: {retry_prompt}"})

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
        response_format={"type": "json_object"},
        temperature=0.1,
        timeout=30,
    )

    tokens_used = 0
    if response.usage:
        tokens_used = (response.usage.prompt_tokens or 0) + (response.usage.completion_tokens or 0)

    return response.choices[0].message.content, tokens_used


def _try_provider(call_fn, user_prompt: str, provider_name: str) -> tuple[LLMResponse, int]:
    """Try a provider with one retry on parse failure.

    Returns (parsed_response, tokens_used) or raises AnalysisUnavailableError.
    """
    total_tokens = 0

    # First attempt
    try:
        raw_text, tokens = call_fn(user_prompt)
        total_tokens += tokens
        return _parse_llm_response(raw_text), total_tokens
    except (json.JSONDecodeError, Exception) as e:
        if not isinstance(e, (json.JSONDecodeError, ValueError)):
            raise  # Re-raise API/network errors — don't retry parse on those
        logger.warning("Parse failure on %s (attempt 1): %s", provider_name, str(e)[:200])

    # Retry with stricter prompt
    try:
        raw_text, tokens = call_fn(
            user_prompt,
            retry_prompt=(
                "Your previous response was not valid JSON. "
                "Return ONLY a valid JSON object with no additional text."
            ),
        )
        total_tokens += tokens
        return _parse_llm_response(raw_text), total_tokens
    except Exception as e:
        logger.error("Parse failure on %s (attempt 2, giving up): %s", provider_name, str(e)[:200])
        raise


def analyze_job_listing(job_data: dict) -> tuple[LLMResponse, str, int]:
    """Analyze a job listing using AI. Returns (llm_response, model_name, tokens_used).

    Tries Gemini 2.5 Flash first, falls back to GPT-4o-mini on any failure.
    Raises AnalysisUnavailableError if both providers fail.
    """
    user_prompt = _build_user_prompt(job_data)

    # Primary: Gemini 2.5 Flash
    try:
        response, tokens = _try_provider(_call_gemini, user_prompt, "gemini-2.5-flash")
        return response, "gemini-2.5-flash", tokens
    except Exception as e:
        logger.warning("Gemini failed, falling back to GPT-4o-mini: %s", str(e)[:200])

    # Fallback: GPT-4o-mini
    try:
        response, tokens = _try_provider(_call_openai, user_prompt, "gpt-4o-mini")
        return response, "gpt-4o-mini", tokens
    except Exception as e:
        logger.error("Both AI providers failed: %s", str(e)[:200])
        raise AnalysisUnavailableError("Both AI providers failed") from e
