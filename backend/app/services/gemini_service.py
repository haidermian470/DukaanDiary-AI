"""The only module that talks to Google Gemini.

Everything else calls `get_ai_client()` and uses two methods:
    generate_json(...)  -> a validated Pydantic object (structured output)
    generate_text(...)  -> plain text

Provider failures are converted into AIServiceError with a clear, safe message.
To switch AI providers later, write another class with the same two methods.
"""
import json
import logging
from functools import lru_cache
from typing import Protocol, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from app.core.config import get_settings
from app.core.exceptions import AIServiceError

logger = logging.getLogger("dukaandiary.ai")
M = TypeVar("M", bound=BaseModel)


class ImageInput(BaseModel):
    data: bytes
    mime_type: str


class AIClient(Protocol):
    def generate_json(self, *, system: str, prompt: str, schema: type[M],
                      images: list[ImageInput] | None = None) -> M: ...

    def generate_text(self, *, system: str, prompt: str) -> str: ...


def _strip_code_fence(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else ""
        if text.rstrip().endswith("```"):
            text = text.rstrip()[:-3]
    return text.strip()


class GeminiClient:
    def __init__(self, api_key: str, model: str, timeout_seconds: int):
        from google import genai
        from google.genai import types

        self._types = types
        self._model = model
        self._client = genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(timeout=timeout_seconds * 1000),
        )

    def _call(self, contents, config):
        from google.genai import errors

        try:
            return self._client.models.generate_content(model=self._model, contents=contents, config=config)
        except errors.ClientError as exc:
            code = getattr(exc, "code", None)
            logger.warning("Gemini client error code=%s", code)
            if code == 429:
                raise AIServiceError("The AI service is busy or out of quota. Try again in a minute.",
                                     code="ai_rate_limited")
            if code in (401, 403):
                raise AIServiceError("The AI service rejected the server's API key. Check GEMINI_API_KEY.",
                                     code="ai_not_authorised")
            if code == 404:
                raise AIServiceError(f"The AI model '{self._model}' is not available. Check GEMINI_MODEL.",
                                     code="ai_model_unavailable")
            raise AIServiceError("The AI service could not process this request.", code="ai_request_rejected")
        except errors.ServerError as exc:
            logger.warning("Gemini server error code=%s", getattr(exc, "code", None))
            raise AIServiceError("The AI service is temporarily unavailable. Try again shortly.")
        except (httpx.TimeoutException, TimeoutError):
            logger.warning("Gemini timeout")
            raise AIServiceError("The AI service took too long to respond. Try again.", code="ai_timeout")
        except httpx.HTTPError:
            logger.warning("Gemini network error")
            raise AIServiceError("Could not reach the AI service. Check the internet connection.")

    def generate_json(self, *, system: str, prompt: str, schema: type[M],
                      images: list[ImageInput] | None = None) -> M:
        types = self._types
        parts = [types.Part.from_bytes(data=img.data, mime_type=img.mime_type) for img in images or []]
        parts.append(types.Part.from_text(text=prompt))
        config = types.GenerateContentConfig(
            system_instruction=system, temperature=0.1,
            response_mime_type="application/json", response_schema=schema,
        )
        last_error = None
        for _attempt in range(2):  # one retry if the model returns unusable JSON
            response = self._call([types.Content(role="user", parts=parts)], config)
            text = _strip_code_fence(getattr(response, "text", None) or "")
            try:
                return schema.model_validate(json.loads(text))
            except (json.JSONDecodeError, ValidationError) as exc:
                last_error = exc
                logger.warning("Gemini returned invalid structured output (%s)", type(exc).__name__)
        raise AIServiceError("The AI returned an answer in an unexpected format. Please try again.",
                             code="ai_invalid_response") from last_error

    def generate_text(self, *, system: str, prompt: str) -> str:
        types = self._types
        config = types.GenerateContentConfig(system_instruction=system, temperature=0.3)
        response = self._call(prompt, config)
        text = (getattr(response, "text", None) or "").strip()
        if not text:
            raise AIServiceError("The AI returned an empty answer. Please try again.", code="ai_invalid_response")
        return text


@lru_cache
def _cached_client(api_key: str, model: str, timeout: int) -> GeminiClient:
    return GeminiClient(api_key, model, timeout)


def get_ai_client() -> AIClient:
    """FastAPI dependency. Tests override this with a fake client."""
    settings = get_settings()
    if not settings.gemini_api_key:
        raise AIServiceError("AI features are not configured on the server (GEMINI_API_KEY is missing).",
                             code="ai_not_configured")
    return _cached_client(settings.gemini_api_key, settings.gemini_model, settings.gemini_timeout_seconds)


def get_optional_ai_client() -> AIClient | None:
    """Like get_ai_client, but returns None when AI is not configured (for endpoints with a fallback)."""
    try:
        return get_ai_client()
    except AIServiceError:
        return None
