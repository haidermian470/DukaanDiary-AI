"""Reusable request parameters."""
from datetime import date

from fastapi import Header, Query

from app.core.exceptions import AppError
from app.schemas.common import PeriodName
from app.utils.dates import Period, resolve_period


def period_params(
    period: PeriodName = Query("this_month", description="Named period (Asia/Karachi dates). Weeks start Monday."),
    date_from: date | None = Query(None, description="Custom start date (inclusive). Overrides `period`."),
    date_to: date | None = Query(None, description="Custom end date (inclusive). Overrides `period`."),
) -> Period:
    try:
        return resolve_period(period, date_from, date_to)
    except ValueError as exc:
        raise AppError(str(exc), code="invalid_period")


def idempotency_key(
    idempotency_key: str | None = Header(
        None, alias="Idempotency-Key", max_length=100,
        description="Unique value per Save click (e.g. crypto.randomUUID()). Retries with the same key "
                    "return the first result instead of saving twice."),
) -> str | None:
    return idempotency_key.strip() if idempotency_key and idempotency_key.strip() else None
