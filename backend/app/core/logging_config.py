"""Logging setup. We log events and IDs, never tokens, API keys or request bodies."""
import logging


def configure_logging(level: str = "INFO") -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    # HTTP client libraries can log full URLs and headers at DEBUG level, so keep them quiet.
    for noisy in ("httpx", "httpcore", "google_genai", "urllib3"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
