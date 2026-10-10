"""Phase D/F: the assistant and expense insights are grounded in real records."""
from datetime import timedelta

from app.core.exceptions import AIServiceError
from app.utils.dates import today_local
from app.utils.grounding import ungrounded_numbers
from tests.conftest import create_sale

TODAY = today_local()


def classify(intent, period=None, contact_name=None, **kw):
    return {"intent": intent, "period": period, "date_from": None, "date_to": None,
            "contact_name": contact_name, "language": "english", **kw}


def ask(api, q):
    r = api.post("/api/v1/ai/assistant", json={"question": q})
    assert r.status_code == 200, r.text
    return r.json()


def test_acceptance_d_cash_vs_sales_grounded_answer(api, fake_ai):
    create_sale(api, "5000", "3000", contact="Ahmed")
    fake_ai.add_json(classify("cash_vs_sales", "this_month"))
    fake_ai.add_text("This month your sales were Rs 5,000 but you received Rs 3,000. The remaining Rs 2,000 "
                     "is owed by customers (Ahmed), so it is a receivable, not cash in hand.")
    a = ask(api, "Why is my cash received lower than my total sales?")
    assert a["ai_generated"] is True and a["grounding_check"] == "passed"
    f = a["figures"]
    assert (f["total_sales"], f["money_received"], f["sales_in_period_not_yet_paid"]) == ("Rs 5,000", "Rs 3,000", "Rs 2,000")
    # The AI only ever saw this workspace's computed facts
    facts_prompt = fake_ai.calls[1]["prompt"]
    assert "Rs 2,000" in facts_prompt and "Ahmed" in facts_prompt


def test_invented_number_is_caught_and_replaced(api, fake_ai):
    create_sale(api, "5000", "3000", contact="Ahmed")
    fake_ai.add_json(classify("sales_summary", "this_month"))
    fake_ai.add_text("You sold Rs 9,999 this month!")  # hallucination
    a = ask(api, "How much did I sell this month?")
    assert a["grounding_check"] == "failed_fallback_used" and a["ai_generated"] is False
    assert "9,999" not in a["answer"] and "Rs 5,000" in a["answer"]


def test_assistant_works_without_ai_using_keywords(api, fake_ai):
    create_sale(api, "5000", "3000", contact="Ahmed")
    fake_ai.add_json(AIServiceError("down"))
    a = ask(api, "Who owes me money?")
    assert a["intent"] == "receivables" and a["ai_generated"] is False
    assert "Ahmed" in a["answer"] and "Rs 2,000" in a["answer"] and a["notice"]


def test_no_records_says_so_without_calling_ai_for_text(api, fake_ai):
    fake_ai.add_json(classify("expenses_summary", "this_week"))
    a = ask(api, "What were my expenses this week?")
    assert "Rs 0" in a["answer"] and a["ai_generated"] is False
    assert len([c for c in fake_ai.calls if c["kind"] == "text"]) == 0


def test_unsupported_question_is_declined_honestly(api, fake_ai):
    fake_ai.add_json(classify("unsupported"))
    a = ask(api, "What will my profit be next year?")
    assert a["intent"] == "unsupported" and "can't answer" in a["answer"]
    assert a["figures"] == {}


def test_assistant_only_sees_own_workspace(api, fake_ai):
    from tests.conftest import USER_B
    create_sale(api.as_user(USER_B), "99000", "0", contact="Secret Customer")
    create_sale(api, "1000", "0", contact="Ahmed")
    fake_ai.add_json(classify("receivables"))
    fake_ai.add_text("As of today, Ahmed owes you Rs 1,000.")
    a = ask(api, "Who owes me?")
    assert "Secret Customer" not in str(a["figures"]) and "99,000" not in str(fake_ai.calls)


def test_period_comparison_and_contact_balance(api, fake_ai):
    create_sale(api, "1000", "1000", contact=None)
    fake_ai.add_json(classify("period_comparison", "this_week"))
    fake_ai.add_text("This week sales are Rs 1,000 compared with Rs 0 last week.")
    a = ask(api, "Compare this week with last week")
    assert a["comparison_period"] is not None and a["figures"]["current"]["total_sales"] == "Rs 1,000"

    create_sale(api, "700", "200", contact="Sana")
    fake_ai.add_json(classify("contact_balance", contact_name="sana"))
    fake_ai.add_text("Sana owes you Rs 500.")
    a = ask(api, "How much does Sana owe?")
    assert a["figures"]["contacts"][0]["outstanding"] == "Rs 500"


def test_grounding_helper():
    facts = {"total": "Rs 5,000", "count": 3, "pct": 45.3, "period": {"date_from": "2026-10-01"}}
    assert ungrounded_numbers("Sales Rs 5,000 from 3 sales since 2026-10-01, about 45%", facts) == []
    assert ungrounded_numbers("Sales were Rs 5,500", facts) == ["5500"]


# ---------------------------------------------------------------------------
# Expense insights
# ---------------------------------------------------------------------------
def _expense(api, amount, category, days_ago):
    r = api.post("/api/v1/transactions", json={
        "type": "expense", "amount": amount, "amount_paid": amount, "payment_method": "cash",
        "description": f"{category} {days_ago}", "category": category,
        "transaction_date": (TODAY - timedelta(days=days_ago)).isoformat()})
    assert r.status_code == 201, r.text


def test_insights_zero_baseline(api, fake_ai):
    _expense(api, "500", "transport", 0)
    fake_ai.add_json({"summary": "You spent Rs 500 in the last 7 days, all on transport.", "suggestions": ["Combine trips."]})
    r = api.post("/api/v1/ai/expense-insights", json={"period": "last_7_days"}).json()
    assert r["total_current"] == "500.00" and r["total_previous"] == "0.00"
    assert r["change_percent"] is None and any("no baseline" in n for n in r["data_notes"])
    assert r["ai_generated"] is True and r["grounding_check"] == "passed"


def test_insights_percent_change_and_unusual_expense(api, fake_ai):
    for days, amount in ((40, "600"), (30, "650"), (20, "700")):   # history before the window
        _expense(api, amount, "transport", days)
    _expense(api, "500", "transport", 10)                          # previous 7-day window
    _expense(api, "2200", "transport", 1)                          # current window: unusual
    fake_ai.add_json(AIServiceError("down"))                       # template fallback
    r = api.post("/api/v1/ai/expense-insights", json={"period": "last_7_days"}).json()
    assert r["total_current"] == "2200.00"
    assert r["unusual_expenses"][0]["amount"] == "2200.00"
    assert r["unusual_expenses"][0]["typical_amount"] == "625.00"  # median of 600, 650, 700, 500
    assert r["ai_generated"] is False and "Rs 2,200" in r["summary"]


def test_insights_with_no_data(api, fake_ai):
    r = api.post("/api/v1/ai/expense-insights", json={"period": "this_month"}).json()
    assert r["total_current"] == "0.00" and "No expenses" in r["summary"]
    assert fake_ai.calls == []  # nothing to explain, so the AI is not called
