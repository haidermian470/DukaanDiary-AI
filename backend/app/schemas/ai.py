"""Schemas for the AI features.

Two kinds of models live here:
  * `AI...` models describe what Gemini must return (structured output). They are
    validated again on the server; the AI's word is never trusted as-is.
  * The others are this API's request/response contracts for the frontend.
"""
import uuid
from datetime import date
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.schemas.common import ApiModel, PaymentMethod, PeriodOut, TransactionType
from app.schemas.contact import ContactRef


# ---------------------------------------------------------------------------
# What Gemini returns (kept simple: nullable fields, enums, no defaults)
# ---------------------------------------------------------------------------
class AIParsedTransaction(BaseModel):
    intent: Literal["new_transaction", "payment_against_dues", "advance_payment", "not_a_transaction"]
    transaction_type: Literal["sale", "purchase", "expense"] | None
    total_amount: float | None
    amount_paid_now: float | None
    payment_method: Literal["cash", "bank", "mobile_wallet", "cheque", "other"] | None
    category: str | None
    description: str | None
    party_name: str | None
    party_role: Literal["customer", "supplier"] | None
    transaction_date: str | None
    due_date: str | None
    remaining_balance_mentioned: float | None
    language: Literal["english", "urdu", "roman_urdu", "mixed"] | None
    uncertain_fields: list[str]
    clarification_question: str | None


AssistantIntent = Literal[
    "sales_summary", "purchases_summary", "expenses_summary", "top_expense_category",
    "money_received", "money_paid", "receivables", "overdue_receivables", "payables",
    "period_comparison", "cash_vs_sales", "spending_advice", "business_overview",
    "contact_balance", "unsupported",
]


class AIQuestionClassification(BaseModel):
    intent: AssistantIntent
    period: Literal["today", "yesterday", "this_week", "last_week", "this_month", "last_month",
                    "last_7_days", "last_30_days", "this_year", "all_time", "custom"] | None
    date_from: str | None
    date_to: str | None
    contact_name: str | None
    language: Literal["english", "urdu", "roman_urdu", "mixed"] | None


class AIInsightNarrative(BaseModel):
    summary: str
    suggestions: list[str]


# ---------------------------------------------------------------------------
# AI transaction entry
# ---------------------------------------------------------------------------
class ParseTransactionRequest(ApiModel):
    text: str = Field(min_length=2, max_length=1000,
                      examples=["Sold goods worth Rs. 5,000, received Rs. 3,000, customer Ali will pay the rest tomorrow"])
    input_mode: Literal["typed", "voice"] = Field(
        "typed", description="'voice' if the text came from browser speech-to-text")
    previous_text: str | None = Field(
        None, max_length=1000,
        description="When answering a clarification question, send the original sentence here "
                    "and the answer in `text`.")


class TransactionDraft(ApiModel):
    type: TransactionType | None
    amount: Decimal | None
    amount_paid: Decimal | None
    amount_due: Decimal | None
    payment_method: PaymentMethod | None
    category: str | None
    description: str | None
    contact_name: str | None
    contact_id: uuid.UUID | None
    contact_match: Literal["existing", "new", "none"]
    similar_contacts: list[ContactRef]
    transaction_date: date | None
    due_date: date | None
    currency: str = "PKR"


class PaymentDraft(ApiModel):
    kind: Literal["settle_dues", "advance"]
    contact_name: str | None
    contact_id: uuid.UUID | None
    contact_kind: Literal["customer", "supplier"] | None
    amount: Decimal | None
    method: PaymentMethod | None
    payment_date: date | None
    outstanding_before: Decimal | None
    outstanding_after: Decimal | None
    similar_contacts: list[ContactRef]


class ConfirmAction(ApiModel):
    method: Literal["POST"] = "POST"
    path: str
    body: dict[str, Any]


class ParseTransactionResponse(ApiModel):
    status: Literal["ready_to_confirm", "needs_clarification", "not_a_transaction"]
    intent: Literal["new_transaction", "payment_against_dues", "advance_payment", "not_a_transaction"]
    transaction_draft: TransactionDraft | None
    payment_draft: PaymentDraft | None
    missing_fields: list[str]
    warnings: list[str]
    assumptions: list[str]
    clarification_question: str | None
    language_detected: str | None
    confirm: ConfirmAction | None = Field(
        description="When ready: the exact request to send after the user reviews/edits and clicks Confirm. "
                    "Add an Idempotency-Key header.")
    saved: Literal[False] = Field(False, description="Always false: parsing never saves anything.")


# ---------------------------------------------------------------------------
# AI Financial Assistant
# ---------------------------------------------------------------------------
class AssistantRequest(ApiModel):
    question: str = Field(min_length=2, max_length=500, examples=["Why is my cash received lower than my sales?"])


class AssistantResponse(ApiModel):
    answer: str
    intent: AssistantIntent
    period: PeriodOut | None
    comparison_period: PeriodOut | None = None
    figures: dict[str, Any] = Field(description="The exact backend-calculated numbers the answer is based on")
    ai_generated: bool = Field(description="False when the answer came from the built-in template (AI unavailable)")
    grounding_check: Literal["passed", "failed_fallback_used", "not_applicable"]
    notice: str | None = None


# ---------------------------------------------------------------------------
# Expense insights
# ---------------------------------------------------------------------------
class ExpenseInsightsRequest(ApiModel):
    period: Literal["this_week", "last_week", "this_month", "last_month", "last_7_days", "last_30_days"] = "this_month"
    include_purchases: bool = False


class CategoryChange(ApiModel):
    category: str
    current: Decimal
    previous: Decimal
    change: Decimal
    change_percent: float | None = Field(description="None when the previous amount was 0 (no baseline)")


class UnusualExpense(ApiModel):
    transaction_id: uuid.UUID
    date: date
    description: str
    category: str
    amount: Decimal
    typical_amount: Decimal = Field(description="Median of this category over the previous 90 days")
    times_typical: float


class ExpenseInsightsResponse(ApiModel):
    period: PeriodOut
    previous_period: PeriodOut
    total_current: Decimal
    total_previous: Decimal
    change: Decimal
    change_percent: float | None
    top_category: str | None
    categories: list[CategoryChange]
    increases: list[CategoryChange]
    decreases: list[CategoryChange]
    unusual_expenses: list[UnusualExpense]
    data_notes: list[str]
    summary: str
    suggestions: list[str]
    ai_generated: bool
    grounding_check: Literal["passed", "failed_fallback_used", "not_applicable"]
    rules: dict[str, str]
