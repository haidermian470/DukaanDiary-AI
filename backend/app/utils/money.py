"""Money helpers.

Money is always a `Decimal` with two decimal places, never a float, so that
5000.10 + 0.20 is exactly 5000.30. The database column type is NUMERIC(14, 2).
"""
from decimal import ROUND_HALF_UP, Decimal

ZERO = Decimal("0.00")
CENT = Decimal("0.01")


def to_money(value) -> Decimal:
    """Convert a number, string or None into a 2-decimal Decimal (None becomes 0.00)."""
    if value is None:
        return ZERO
    if isinstance(value, float):
        value = repr(value)  # avoid binary float artefacts such as 0.1 -> 0.1000000000000000055
    return Decimal(value).quantize(CENT, rounding=ROUND_HALF_UP)


def format_pkr(value) -> str:
    """Human-friendly PKR text, e.g. Rs 12,500 or Rs 12,500.50."""
    amount = to_money(value)
    sign = "-" if amount < 0 else ""
    amount = abs(amount)
    if amount == amount.to_integral_value():
        return f"{sign}Rs {amount:,.0f}"
    return f"{sign}Rs {amount:,.2f}"
