"""Kept for backwards compatibility: `uvicorn main:app` still works.
The real application lives in app/main.py (run `uvicorn app.main:app`)."""
from app.main import app  # noqa: F401
