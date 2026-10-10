"""Shared types used by many schemas.

Money in JSON responses is a STRING with two decimals (for example "5000.00").
This keeps amounts exact. In JavaScript, use Number(value) only for display or charts.
"""
from datetime import date
from decimal import Decimal
from typing import Annotated, Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")

MoneyPositive = Annotated[Decimal, Field(gt=0, max_digits=14, decimal_places=2,
                                         description="PKR amount, greater than 0, max 2 decimals")]
MoneyNonNegative = Annotated[Decimal, Field(ge=0, max_digits=14, decimal_places=2,
                                            description="PKR amount, 0 or more, max 2 decimals")]

TransactionType = Literal["sale", "purchase", "expense"]
ContactKind = Literal["customer", "supplier"]
PaymentMethod = Literal["cash", "bank", "mobile_wallet", "cheque", "other"]
PaymentStatus = Literal["completed", "pending", "failed", "cancelled"]
SettlementStatus = Literal["paid", "partially_paid", "unpaid"]
PeriodName = Literal["today", "yesterday", "this_week", "last_week", "this_month", "last_month",
                     "last_7_days", "last_30_days", "this_year", "all_time", "custom"]


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Page(ApiModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int
    has_more: bool


class PeriodOut(ApiModel):
    name: str
    label: str
    date_from: date
    date_to: date


class ErrorBody(BaseModel):
    code: str
    message: str
    details: object | None = None
    request_id: str | None = None


class ErrorResponse(BaseModel):
    error: ErrorBody


# Attach to routes so Swagger documents the error shape.
ERROR_RESPONSES = {
    401: {"model": ErrorResponse, "description": "Missing, invalid or expired access token"},
    403: {"model": ErrorResponse, "description": "No access to this workspace"},
    422: {"model": ErrorResponse, "description": "Invalid input or accounting rule violated"},
}
