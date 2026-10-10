"""AI Expense Insights.

The numbers are calculated here with transparent rules. Gemini only writes the
summary and suggestions from those numbers, and the grounding check rejects any
summary that contains numbers we did not calculate.

Rules:
  * Comparison: the selected period vs the previous period of the same kind
    (this week vs last week, this month vs last month, last 7 days vs the 7 days before).
  * Percentage change is only given when the previous amount is more than 0.
  * Unusual expense: one expense in the current period that is more than 2x the median
    of the same category over the 90 days before the period, with at least 3 earlier records.
"""
import statistics
from datetime import timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import AIServiceError
from app.core.security import WorkspaceContext
from app.database.models import Transaction
from app.schemas.ai import AIInsightNarrative
from app.services import ledger_service
from app.services.gemini_service import AIClient
from app.utils.dates import Period, previous_period, today_local
from app.utils.grounding import ungrounded_numbers
from app.utils.money import ZERO, format_pkr, to_money

UNUSUAL_MULTIPLIER = Decimal("2")
UNUSUAL_LOOKBACK_DAYS = 90
UNUSUAL_MIN_HISTORY = 3

RULES = {
    "comparison": "Selected period vs the previous period of the same length/kind.",
    "change_percent": "Only calculated when the previous period's amount is more than 0.",
    "unusual_expense": (f"An expense more than {UNUSUAL_MULTIPLIER}x the median of its category over the "
                        f"previous {UNUSUAL_LOOKBACK_DAYS} days, with at least {UNUSUAL_MIN_HISTORY} earlier records. "
                        "Unusual does not mean wrong - it is only worth a second look."),
}

SYSTEM_PROMPT = """You are a friendly bookkeeping helper for a small Pakistani shop owner.
You receive FACTS as JSON, calculated exactly by the shop's software.
Write a short summary (2-4 sentences) and up to 4 practical money-saving suggestions.
Rules: use ONLY numbers that appear in FACTS (write money as Rs 12,500). Do not calculate new totals,
averages or percentages. Do not invent expenses, shops or prices. If data is limited, say so.
Never call an expense fraud or wrong; unusual only means worth checking. Plain simple English.
Return JSON with keys summary and suggestions."""


def _pct(current: Decimal, previous: Decimal) -> float | None:
    if previous <= 0:
        return None
    return float(round((current - previous) / previous * 100, 1))


def compute(db: Session, workspace_id, period: Period, include_purchases: bool = False) -> dict:
    types = ("expense", "purchase") if include_purchases else ("expense",)
    prev = previous_period(period)
    current_cats = {c["category"]: c["total"] for c in ledger_service.expense_by_category(db, workspace_id, period, types)}
    prev_cats = {c["category"]: c["total"] for c in ledger_service.expense_by_category(db, workspace_id, prev, types)}

    categories = []
    for cat in sorted(set(current_cats) | set(prev_cats)):
        cur, pre = current_cats.get(cat, ZERO), prev_cats.get(cat, ZERO)
        categories.append({"category": cat, "current": cur, "previous": pre, "change": cur - pre,
                           "change_percent": _pct(cur, pre)})
    categories.sort(key=lambda c: (-c["current"], c["category"]))
    total_current = sum(current_cats.values(), ZERO)
    total_previous = sum(prev_cats.values(), ZERO)

    # Unusual expenses
    lookback_start = period.start - timedelta(days=UNUSUAL_LOOKBACK_DAYS)
    history_rows = db.execute(
        select(Transaction.category, Transaction.amount)
        .where(ledger_service.active_transaction_filter(workspace_id), Transaction.type.in_(types),
               Transaction.transaction_date >= lookback_start, Transaction.transaction_date < period.start)
    ).all()
    history: dict[str, list[Decimal]] = {}
    for cat, amount in history_rows:
        history.setdefault(cat, []).append(to_money(amount))
    current_rows = db.scalars(
        select(Transaction).where(ledger_service.active_transaction_filter(workspace_id),
                                  Transaction.type.in_(types),
                                  Transaction.transaction_date.between(period.start, period.end))
        .order_by(Transaction.transaction_date)).all()
    unusual = []
    for t in current_rows:
        past = history.get(t.category, [])
        if len(past) < UNUSUAL_MIN_HISTORY:
            continue
        median = to_money(statistics.median(past))
        if median > 0 and to_money(t.amount) > median * UNUSUAL_MULTIPLIER:
            unusual.append({"transaction_id": t.id, "date": t.transaction_date, "description": t.description,
                            "category": t.category, "amount": to_money(t.amount), "typical_amount": median,
                            "times_typical": float(round(to_money(t.amount) / median, 1))})

    notes = []
    if total_current == 0 and total_previous == 0:
        notes.append("No expenses are recorded in either period.")
    elif total_previous == 0:
        notes.append("No expenses in the previous period, so there is no baseline for a percentage change.")
    if period.end == today_local() and period.name in ("this_week", "this_month"):
        notes.append(f"{period.label} is not over yet, so it is being compared with a complete previous period.")
    if not any(len(v) >= UNUSUAL_MIN_HISTORY for v in history.values()):
        notes.append("Not enough history yet to spot unusual expenses (needs 3+ earlier records per category).")

    return {
        "period": period.as_dict(), "previous_period": prev.as_dict(),
        "total_current": total_current, "total_previous": total_previous,
        "change": total_current - total_previous, "change_percent": _pct(total_current, total_previous),
        "top_category": categories[0]["category"] if categories and categories[0]["current"] > 0 else None,
        "categories": categories,
        "increases": [c for c in categories if c["change"] > 0],
        "decreases": [c for c in categories if c["change"] < 0],
        "unusual_expenses": unusual, "data_notes": notes, "rules": RULES,
    }


def template_narrative(facts: dict) -> dict:
    """Plain-language summary built directly from the numbers (used when AI is unavailable)."""
    p, prev = facts["period"]["label"], facts["previous_period"]["label"].lower()
    cur, pre = facts["total_current"], facts["total_previous"]
    if cur == 0 and pre == 0:
        return {"summary": f"No expenses are recorded for {p.lower()} or {prev}.",
                "suggestions": ["Record daily expenses as they happen so insights can be calculated."]}
    parts = [f"{p} expenses: {format_pkr(cur)} (previous: {format_pkr(pre)})."]
    if facts["change_percent"] is not None:
        direction = "up" if facts["change"] > 0 else "down"
        parts.append(f"That is {direction} {abs(facts['change_percent'])}%.")
    if facts["top_category"]:
        top = facts["categories"][0]
        parts.append(f"The biggest category is {top['category']} at {format_pkr(top['current'])}.")
    suggestions = []
    if facts["increases"]:
        biggest = max(facts["increases"], key=lambda c: c["change"])
        suggestions.append(f"Review {biggest['category']}: it rose by {format_pkr(biggest['change'])}.")
    for u in facts["unusual_expenses"][:2]:
        suggestions.append(f"Check '{u['description']}' ({format_pkr(u['amount'])}); "
                           f"{u['category']} is usually around {format_pkr(u['typical_amount'])}.")
    if not suggestions:
        suggestions.append("Spending looks steady. Keep recording every expense to spot changes early.")
    return {"summary": " ".join(parts), "suggestions": suggestions}


def _ai_facts(facts: dict) -> dict:
    """Minimal, privacy-friendly facts for the AI (no ids, no contact details)."""
    return {
        "period": facts["period"], "previous_period": facts["previous_period"],
        "total_current": format_pkr(facts["total_current"]), "total_previous": format_pkr(facts["total_previous"]),
        "change": format_pkr(facts["change"]), "change_percent": facts["change_percent"],
        "categories": [{"category": c["category"], "current": format_pkr(c["current"]),
                        "previous": format_pkr(c["previous"]), "change": format_pkr(c["change"]),
                        "change_percent": c["change_percent"]} for c in facts["categories"][:10]],
        "unusual_expenses": [{"description": u["description"], "category": u["category"],
                              "amount": format_pkr(u["amount"]), "typical_amount": format_pkr(u["typical_amount"]),
                              "times_typical": u["times_typical"]} for u in facts["unusual_expenses"][:5]],
        "data_notes": facts["data_notes"],
    }


def insights(db: Session, ctx: WorkspaceContext, ai: AIClient | None, period: Period,
             include_purchases: bool) -> dict:
    facts = compute(db, ctx.workspace_id, period, include_purchases)
    narrative, ai_generated, grounding = template_narrative(facts), False, "not_applicable"
    if ai is not None and (facts["total_current"] > 0 or facts["total_previous"] > 0):
        ai_facts = _ai_facts(facts)
        try:
            import json
            result: AIInsightNarrative = ai.generate_json(
                system=SYSTEM_PROMPT, prompt="FACTS:\n" + json.dumps(ai_facts, default=str),
                schema=AIInsightNarrative)
            text = result.summary + " " + " ".join(result.suggestions)
            if ungrounded_numbers(text, ai_facts):
                grounding = "failed_fallback_used"
            else:
                narrative = {"summary": result.summary.strip(),
                             "suggestions": [s.strip() for s in result.suggestions if s.strip()][:4]}
                ai_generated, grounding = True, "passed"
        except AIServiceError:
            pass  # keep the template narrative; ai_generated=False tells the UI
    return {**facts, **narrative, "ai_generated": ai_generated, "grounding_check": grounding}
