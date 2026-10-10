"""Application errors and the handlers that turn them into safe JSON responses.

Every error response has the same shape, so the frontend can handle errors in one place:

    {"error": {"code": "not_found", "message": "Transaction not found.",
               "details": null, "request_id": "..."}}

Stack traces, SQL and secrets are never sent to the client.
"""
import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError, SQLAlchemyError
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("dukaandiary")


class AppError(Exception):
    status_code = 400
    code = "bad_request"

    def __init__(self, message: str, *, details: Any = None, code: str | None = None,
                 headers: dict[str, str] | None = None):
        super().__init__(message)
        self.message = message
        self.details = details
        self.headers = headers
        if code:
            self.code = code


class AuthenticationError(AppError):
    status_code = 401
    code = "not_authenticated"


class PermissionDeniedError(AppError):
    status_code = 403
    code = "forbidden"


class NotFoundError(AppError):
    status_code = 404
    code = "not_found"


class ConflictError(AppError):
    status_code = 409
    code = "conflict"


class BusinessRuleError(AppError):
    """The input is well-formed but breaks an accounting rule (for example an overpayment)."""
    status_code = 422
    code = "business_rule_violation"


class PayloadTooLargeError(AppError):
    status_code = 413
    code = "file_too_large"


class UnsupportedMediaError(AppError):
    status_code = 415
    code = "unsupported_file_type"


class RateLimitedError(AppError):
    status_code = 429
    code = "rate_limited"


class ServiceNotConfiguredError(AppError):
    status_code = 503
    code = "service_not_configured"


class AIServiceError(AppError):
    """The AI provider failed: unavailable, out of quota, timed out or gave unusable output."""
    status_code = 503
    code = "ai_unavailable"


def _body(code: str, message: str, details: Any = None, request_id: str | None = None) -> dict:
    return {"error": {"code": code, "message": message, "details": details, "request_id": request_id}}


def register_exception_handlers(app: FastAPI) -> None:
    def rid(request: Request) -> str | None:
        return getattr(request.state, "request_id", None)

    @app.exception_handler(AppError)
    async def _app_error(request: Request, exc: AppError):
        return JSONResponse(status_code=exc.status_code, headers=exc.headers,
                            content=_body(exc.code, exc.message, exc.details, rid(request)))

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError):
        details = [
            {"field": ".".join(str(p) for p in err.get("loc", []) if p != "body"),
             "message": err.get("msg"), "type": err.get("type")}
            for err in exc.errors()
        ]
        return JSONResponse(status_code=422, content=_body(
            "validation_error", "Some fields are missing or invalid.", details, rid(request)))

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException):
        code = {404: "not_found", 405: "method_not_allowed"}.get(exc.status_code, "http_error")
        return JSONResponse(status_code=exc.status_code, headers=getattr(exc, "headers", None),
                            content=_body(code, str(exc.detail), None, rid(request)))

    @app.exception_handler(OperationalError)
    async def _db_unavailable(request: Request, exc: OperationalError):
        logger.error("Database unavailable (request_id=%s): %s", rid(request), type(exc).__name__)
        return JSONResponse(status_code=503, content=_body(
            "database_unavailable", "The database is not reachable right now. Try again shortly.",
            None, rid(request)))

    @app.exception_handler(SQLAlchemyError)
    async def _db_error(request: Request, exc: SQLAlchemyError):
        logger.exception("Database error (request_id=%s)", rid(request))
        return JSONResponse(status_code=500, content=_body(
            "database_error", "A database error occurred. Nothing was saved.", None, rid(request)))

    @app.exception_handler(Exception)
    async def _unexpected(request: Request, exc: Exception):
        logger.exception("Unexpected error (request_id=%s)", rid(request))
        return JSONResponse(status_code=500, content=_body(
            "internal_error", "Something went wrong on the server.", None, rid(request)))
