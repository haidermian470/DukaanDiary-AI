"""Grounding check: does an AI answer only use numbers that the backend calculated?

We collect every number that appears in the facts we gave the AI (amounts, counts,
percentages, dates) and then look at every number in the AI's answer.
If the answer contains an amount that is not in the facts, we do not show it -
we fall back to a template answer built directly from the facts.

Small whole numbers (0-31) are always allowed, because they appear naturally in
text ("2 customers", "7 days", "5 tips").
"""
import re
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

NUMBER_RE = re.compile(r"(?<![\w.])\d[\d,]*(?:\.\d+)?")


def _numbers_in_text(text: str) -> list[Decimal]:
    found = []
    for raw in NUMBER_RE.findall(text):
        cleaned = raw.replace(",", "")
        try:
            found.append(Decimal(cleaned))
        except InvalidOperation:
            continue
    return found


def _variants(n: Decimal) -> set[Decimal]:
    n = abs(n)
    return {n, n.quantize(Decimal("1"), rounding=ROUND_HALF_UP),
            n.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP),
            n.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)}


def allowed_numbers(facts) -> set[Decimal]:
    allowed: set[Decimal] = set()

    def walk(value):
        if isinstance(value, dict):
            for v in value.values():
                walk(v)
        elif isinstance(value, (list, tuple)):
            for v in value:
                walk(v)
        elif isinstance(value, bool) or value is None:
            return
        elif isinstance(value, (int, float, Decimal)):
            allowed.update(_variants(Decimal(str(value))))
        elif isinstance(value, (date, datetime)):
            allowed.update({Decimal(value.year), Decimal(value.month), Decimal(value.day)})
        elif isinstance(value, str):
            for n in _numbers_in_text(value):
                allowed.update(_variants(n))
            for part in re.findall(r"\d+", value):  # date pieces like 2026-10-09
                allowed.add(Decimal(int(part)))

    walk(facts)
    return allowed


def ungrounded_numbers(answer: str, facts) -> list[str]:
    allowed = allowed_numbers(facts)
    bad = []
    for n in _numbers_in_text(answer):
        if n <= 31 and n == n.to_integral_value():
            continue
        if not (_variants(n) & allowed):
            bad.append(str(n))
    return bad
