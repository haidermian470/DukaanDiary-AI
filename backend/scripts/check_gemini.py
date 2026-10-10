"""Check that the Gemini key and model in backend/.env really work.

Usage (from backend/, venv active):
    python -m scripts.check_gemini            # one tiny test call with GEMINI_MODEL
    python -m scripts.check_gemini --list     # list models your key can use

The key itself is never printed.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import get_settings  # noqa: E402
from app.core.exceptions import AIServiceError  # noqa: E402
from app.schemas.ai import AIParsedTransaction  # noqa: E402
from app.services.ai_transaction_service import SYSTEM_PROMPT  # noqa: E402
from app.services.gemini_service import GeminiClient  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--list", action="store_true")
    args = parser.parse_args()
    s = get_settings()
    if not s.gemini_api_key:
        print("GEMINI_API_KEY is empty in backend/.env")
        return 1
    if args.list:
        from google import genai
        client = genai.Client(api_key=s.gemini_api_key)
        for m in client.models.list():
            actions = getattr(m, "supported_actions", None) or []
            if "generateContent" in actions:
                print(m.name)
        return 0

    print(f"Model: {s.gemini_model}")
    client = GeminiClient(s.gemini_api_key, s.gemini_model, s.gemini_timeout_seconds)
    try:
        result = client.generate_json(
            system=SYSTEM_PROMPT, schema=AIParsedTransaction,
            prompt="TODAY (Asia/Karachi): 2026-10-10 (Saturday)\nMESSAGE:\nSold goods worth Rs 5,000 to Ali, "
                   "received Rs 3,000, rest tomorrow")
    except AIServiceError as exc:
        print(f"FAILED: {exc.code} - {exc.message}")
        return 1
    print("OK - structured output received:")
    print(result.model_dump_json(indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
