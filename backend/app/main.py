"""DukaanDiary AI - FastAPI application.

Run locally (from the backend/ folder):
    uvicorn app.main:app --reload
Then open http://127.0.0.1:8000/docs
"""
import logging
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.exceptions import register_exception_handlers
from app.core.logging_config import configure_logging
from app.routes import (
    ai_transactions, assistant, contacts, dashboard, demo, dummy_bank, expense_insights, health,
    payment_verification, payments, receipts, reports, transactions, workspaces,
)

API_PREFIX = "/api/v1"
logger = logging.getLogger("dukaandiary")

DESCRIPTION = """
Bookkeeping and AI assistant API for small Pakistani shops. Currency: **PKR**. Business timezone: **Asia/Karachi**.

**Authentication:** send `Authorization: Bearer <Supabase access token>` on every `/api/v1` call
(except `/health`). In local development with `DEV_AUTH_BYPASS=true` you can call endpoints without a token.

**Money** is returned as a string with 2 decimals (e.g. `"5000.00"`) so amounts stay exact.

**AI never saves anything by itself.** AI endpoints return drafts; the user confirms; the frontend then
calls the normal create endpoints.

**Dummy Bank:** DEMO - NO REAL BANK CONNECTION. All bank data is synthetic.
"""


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(
        title="DukaanDiary AI API",
        description=DESCRIPTION,
        version="1.0.0",
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "X-Workspace-Id", "X-Request-ID"],
        expose_headers=["X-Request-ID", "Idempotent-Replay", "Retry-After", "Content-Disposition"],
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        incoming = request.headers.get("X-Request-ID", "")
        request.state.request_id = incoming[:64] if incoming else uuid.uuid4().hex
        started = time.perf_counter()
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        # Log method, path, status and timing only - no bodies, no tokens.
        logger.info("%s %s -> %s (%.0f ms) request_id=%s", request.method, request.url.path,
                    response.status_code, (time.perf_counter() - started) * 1000, request.state.request_id)
        return response

    register_exception_handlers(app)

    for module in (health, workspaces, contacts, transactions, payments, dashboard, reports,
                   ai_transactions, assistant, expense_insights, receipts, payment_verification,
                   dummy_bank, demo):
        app.include_router(module.router, prefix=API_PREFIX)

    @app.get("/", include_in_schema=False)
    def root():
        return {"message": "Welcome to DukaanDiary AI API", "status": "running", "docs": "/docs",
                "health": f"{API_PREFIX}/health"}

    @app.get("/health", include_in_schema=False)
    def legacy_health():
        return {"status": "healthy", "application": "DukaanDiary AI"}

    return app


app = create_app()
