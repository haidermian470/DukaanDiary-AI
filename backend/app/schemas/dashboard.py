from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import Field

from app.schemas.common import ApiModel, PeriodOut
from app.schemas.transaction import TransactionOut


class SummaryFigures(ApiModel):
    total_sales: Decimal = Field(description="Value of sales dated in the period (cash + credit)")
    total_purchases: Decimal = Field(description="Value of stock purchases dated in the period")
    total_expenses: Decimal = Field(description="Value of operating expenses dated in the period")
    money_received: Decimal = Field(description="Completed money in, by payment date")
    money_paid: Decimal = Field(description="Completed money out, by payment date")
    net_cash_flow: Decimal = Field(description="money_received - money_paid (not cash in hand)")
    sales_count: int
    purchases_count: int
    expenses_count: int


class BalanceFigures(ApiModel):
    """Balances are always 'as of today', whatever period is selected."""
    as_of: date
    receivables: Decimal = Field(description="What customers owe you now")
    payables: Decimal = Field(description="What you owe suppliers now")
    overdue_receivables: Decimal
    overdue_payables: Decimal
    open_receivable_items: int
    open_payable_items: int
    overdue_receivable_items: int
    overdue_payable_items: int


class DashboardSummary(ApiModel):
    period: PeriodOut
    figures: SummaryFigures
    balances: BalanceFigures
    received_breakdown: dict[str, Decimal] = Field(
        description="Money received split into: for_sales_in_period, for_older_sales, advances")
    recent_transactions: list[TransactionOut]
    has_demo_data: bool
    definitions: dict[str, str]


class TrendPoint(ApiModel):
    bucket_start: date
    bucket_end: date
    sales: Decimal
    purchases: Decimal
    expenses: Decimal
    money_received: Decimal
    money_paid: Decimal


class DashboardTrends(ApiModel):
    period: PeriodOut
    granularity: Literal["day", "week", "month"]
    points: list[TrendPoint]


class CategoryTotal(ApiModel):
    category: str
    total: Decimal
    count: int
    share_percent: float


class ExpenseBreakdown(ApiModel):
    period: PeriodOut
    include_purchases: bool
    total: Decimal
    categories: list[CategoryTotal]


class ReportSummary(ApiModel):
    period: PeriodOut
    figures: SummaryFigures
    balances: BalanceFigures
    expense_categories: list[CategoryTotal]
    top_customers_owing: list[dict]
    top_suppliers_owed: list[dict]
    limitations: list[str]
