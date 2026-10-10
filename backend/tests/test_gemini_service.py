"""The Gemini wrapper: provider errors become safe AIServiceErrors; bad JSON is retried then rejected.
The real SDK client object is created (no network) and its HTTP call is replaced."""
import httpx
import pytest
from google.genai import errors

from app.core.exceptions import AIServiceError
from app.schemas.ai import AIInsightNarrative
from app.services.gemini_service import GeminiClient


class _Resp:
    def __init__(self, text):
        self.text = text


class _Models:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls = 0

    def generate_content(self, **kwargs):
        self.calls += 1
        out = self.outcomes.pop(0)
        if isinstance(out, Exception):
            raise out
        return _Resp(out)


def client_with(outcomes):
    c = GeminiClient(api_key="test-key", model="gemini-test", timeout_seconds=10)
    models = _Models(outcomes)
    c._client = type("Fake", (), {"models": models})()
    return c, models


def test_valid_structured_output_is_parsed():
    c, _ = client_with(['{"summary": "ok", "suggestions": ["a"]}'])
    out = c.generate_json(system="s", prompt="p", schema=AIInsightNarrative)
    assert out.summary == "ok"


def test_code_fenced_json_is_accepted():
    c, _ = client_with(['```json\n{"summary": "ok", "suggestions": []}\n```'])
    assert c.generate_json(system="s", prompt="p", schema=AIInsightNarrative).summary == "ok"


def test_invalid_output_is_retried_once_then_rejected():
    c, models = client_with(["not json", '{"wrong": 1}'])
    with pytest.raises(AIServiceError) as exc:
        c.generate_json(system="s", prompt="p", schema=AIInsightNarrative)
    assert exc.value.code == "ai_invalid_response" and models.calls == 2


@pytest.mark.parametrize("error, code", [
    (errors.ClientError(429, {"error": {"message": "quota"}}), "ai_rate_limited"),
    (errors.ClientError(403, {"error": {"message": "bad key"}}), "ai_not_authorised"),
    (errors.ClientError(404, {"error": {"message": "no model"}}), "ai_model_unavailable"),
    (errors.ServerError(503, {"error": {"message": "overloaded"}}), "ai_unavailable"),
    (httpx.ReadTimeout("slow"), "ai_timeout"),
    (httpx.ConnectError("offline"), "ai_unavailable"),
])
def test_provider_errors_are_mapped_safely(error, code):
    c, _ = client_with([error])
    with pytest.raises(AIServiceError) as exc:
        c.generate_text(system="s", prompt="p")
    assert exc.value.code == code
    assert "test-key" not in exc.value.message


def test_empty_text_answer_is_an_error():
    c, _ = client_with([""])
    with pytest.raises(AIServiceError):
        c.generate_text(system="s", prompt="p")
