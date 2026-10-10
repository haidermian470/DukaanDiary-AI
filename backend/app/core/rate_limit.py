"""A small in-memory rate limiter for the expensive AI endpoints.

It counts requests per user in a sliding 60-second window. The counts live in
server memory, so they reset on restart and apply per server instance.
That is enough to stop accidental loops or casual abuse during a demo.
"""
import threading
import time
from collections import defaultdict, deque

from app.core.exceptions import RateLimitedError


class SlidingWindowLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str, limit: int, window_seconds: int = 60) -> None:
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            while hits and now - hits[0] >= window_seconds:
                hits.popleft()
            if len(hits) >= limit:
                retry_after = max(1, int(window_seconds - (now - hits[0])))
                raise RateLimitedError(
                    "Too many AI requests. Please wait a moment and try again.",
                    headers={"Retry-After": str(retry_after)},
                    details={"retry_after_seconds": retry_after},
                )
            hits.append(now)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


ai_limiter = SlidingWindowLimiter()
