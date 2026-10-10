"""Phase D: AI transaction parsing. Gemini is faked; the backend's validation is what is tested."""
from datetime import timedelta

from app.core.exceptions import AIServiceError
from app.utils.dates import today_local
from tests.conftest import create_sale, summary

TODAY = today_local()


def ai_tx(**overrides):
    base = {"intent": "new_transaction", "transaction_type": None, "total_amount": None, "amount_paid_now": None,
            "payment_method": None, "category": None, "description": None, "party_name": None, "party_role": None,
            "transaction_date": None, "due_date": None, "remaining_balance_mentioned": None, "language": "english",
            "uncertain_fields": [], "clarification_question": None}
    return {**base, **overrides}


def parse(api, text, **extra):
    r = api.post("/api/v1/ai/parse-transaction", json={"text": text, **extra})
    assert r.status_code == 200, r.text
    return r.json()


def test_partial_sale_draft_then_confirm_end_to_end(api, fake_ai):
    """Acceptance A through the AI path: parse -> review -> confirm -> dashboard."""
    tomorrow = (TODAY + timedelta(days=1)).isoformat()
    fake_ai.add_json(ai_tx(transaction_type="sale", total_amount=5000, amount_paid_now=3000, payment_method="cash",
                           category="sales", description="Goods sold, part paid", party_name="Ali",
                           party_role="customer", due_date=tomorrow))
    d = parse(api, "Sold goods worth Rs. 5,000 to Ali, received Rs. 3,000, he will pay the rest tomorrow.")
    assert d["status"] == "ready_to_confirm" and d["saved"] is False
    draft = d["transaction_draft"]
    assert (draft["amount"], draft["amount_paid"], draft["amount_due"]) == ("5000.00", "3000.00", "2000.00")
    assert draft["due_date"] == tomorrow and draft["contact_match"] == "new"
    assert "TODAY (Asia/Karachi)" in fake_ai.calls[0]["prompt"]
    # Parsing saved nothing
    assert api.get("/api/v1/transactions").json()["total"] == 0

    confirm = d["confirm"]
    assert confirm["path"] == "/api/v1/transactions" and confirm["body"]["source"] == "ai"
    r = api.post(confirm["path"], json=confirm["body"], headers={"Idempotency-Key": "ui-1"})
    assert r.status_code == 201, r.text
    s = summary(api)
    assert (s["figures"]["total_sales"], s["figures"]["money_received"], s["balances"]["receivables"]) == \
        ("5000.00", "3000.00", "2000.00")


def test_user_can_edit_draft_before_confirming(api, fake_ai):
    fake_ai.add_json(ai_tx(transaction_type="expense", total_amount=800, amount_paid_now=800, category="transport"))
    d = parse(api, "Spent Rs. 800 on transport")
    assert d["status"] == "ready_to_confirm"
    assert any("cash" in a for a in d["assumptions"])  # method defaulted and disclosed
    body = {**d["confirm"]["body"], "amount": "850", "amount_paid": "850"}  # user corrected it
    assert api.post("/api/v1/transactions", json=body).json()["amount"] == "850.00"


def test_missing_amount_asks_a_question(api, fake_ai):
    fake_ai.add_json(ai_tx(transaction_type="sale", payment_method="cash"))
    d = parse(api, "Sold some goods today")
    assert d["status"] == "needs_clarification" and d["confirm"] is None
    assert "amount" in d["missing_fields"]
    assert d["clarification_question"]


def test_unknown_payment_status_is_not_guessed(api, fake_ai):
    fake_ai.add_json(ai_tx(transaction_type="sale", total_amount=2500))
    d = parse(api, "Sold goods for 2500")
    assert "amount_paid" in d["missing_fields"]
    assert d["transaction_draft"]["amount_paid"] is None


def test_credit_sale_without_name_asks_who(api, fake_ai):
    fake_ai.add_json(ai_tx(transaction_type="sale", total_amount=7000, amount_paid_now=0))
    d = parse(api, "Sold goods for Rs. 7,000 on credit")
    assert d["missing_fields"] == ["contact_name"]


def test_paid_more_than_total_is_flagged(api, fake_ai):
    fake_ai.add_json(ai_tx(transaction_type="sale", total_amount=1000, amount_paid_now=1500, party_name="Ali"))
    d = parse(api, "Sold 1000, got 1500")
    assert d["status"] == "needs_clarification" and d["warnings"]


def test_future_date_and_bad_due_date(api, fake_ai):
    future = (TODAY + timedelta(days=5)).isoformat()
    fake_ai.add_json(ai_tx(transaction_type="expense", total_amount=100, amount_paid_now=100,
                           transaction_date=future, due_date="2001-01-01"))
    d = parse(api, "Next week paid 100")
    assert "transaction_date" in d["missing_fields"]


def test_previous_text_is_sent_for_clarification_answers(api, fake_ai):
    fake_ai.add_json(ai_tx(transaction_type="sale", total_amount=2500, amount_paid_now=2500, payment_method="cash"))
    parse(api, "all of it in cash", previous_text="Sold goods for 2500")
    assert "Original message: Sold goods for 2500" in fake_ai.calls[0]["prompt"]


def test_roman_urdu_payment_against_dues_uses_ledger_not_ai(api, fake_ai):
    create_sale(api, "13000", "0", contact="Ahmed")
    fake_ai.add_json(ai_tx(intent="payment_against_dues", amount_paid_now=5000, party_name="Ahmed",
                           party_role="customer", remaining_balance_mentioned=9000, language="roman_urdu"))
    d = parse(api, "Customer Ahmed ne 5000 diye, uske 9000 abhi baqi hain")
    p = d["payment_draft"]
    assert d["status"] == "ready_to_confirm" and d["intent"] == "payment_against_dues"
    assert (p["outstanding_before"], p["outstanding_after"]) == ("13000.00", "8000.00")
    assert any("records will show Rs 8,000" in w for w in d["warnings"])  # the user's 9000 is not trusted
    assert d["confirm"]["path"] == "/api/v1/payments/settle-contact"
    r = api.post(d["confirm"]["path"], json=d["confirm"]["body"])
    assert r.status_code == 201
    assert summary(api)["figures"]["sales_count"] == 1  # no new sale was created


def test_payment_from_unknown_customer_suggests_names(api, fake_ai):
    create_sale(api, "1000", "0", contact="Ahmed")
    fake_ai.add_json(ai_tx(intent="payment_against_dues", amount_paid_now=500, party_name="Ahmad"))
    d = parse(api, "Ahmad paid 500")
    assert d["status"] == "needs_clarification"
    assert d["payment_draft"]["similar_contacts"][0]["name"] == "Ahmed"


def test_payment_larger_than_dues_needs_clarification(api, fake_ai):
    create_sale(api, "1000", "0", contact="Ahmed")
    fake_ai.add_json(ai_tx(intent="payment_against_dues", amount_paid_now=5000, party_name="Ahmed"))
    d = parse(api, "Ahmed paid 5000")
    assert d["status"] == "needs_clarification" and d["confirm"] is None


def test_supplier_advance(api, fake_ai):
    api.post("/api/v1/contacts", json={"kind": "supplier", "name": "Rashid"})
    fake_ai.add_json(ai_tx(intent="advance_payment", amount_paid_now=3000, party_name="Rashid", party_role="supplier",
                           language="roman_urdu"))
    d = parse(api, "Supplier Rashid ko 3000 advance diya")
    assert d["status"] == "ready_to_confirm" and d["confirm"]["body"]["is_advance"] is True
    assert api.post(d["confirm"]["path"], json=d["confirm"]["body"]).status_code == 201


def test_not_a_transaction(api, fake_ai):
    fake_ai.add_json(ai_tx(intent="not_a_transaction"))
    d = parse(api, "What's the weather?")
    assert d["status"] == "not_a_transaction" and d["transaction_draft"] is None


def test_acceptance_f_ai_failure_saves_nothing(api, fake_ai):
    fake_ai.add_json(AIServiceError("The AI service is temporarily unavailable. Try again shortly."))
    r = api.post("/api/v1/ai/parse-transaction", json={"text": "Sold goods for 500 cash"})
    assert r.status_code == 503 and r.json()["error"]["code"] == "ai_unavailable"
    assert api.get("/api/v1/transactions").json()["total"] == 0
    assert api.get("/api/v1/health").status_code == 200  # app still usable


def test_input_length_limits(api):
    assert api.post("/api/v1/ai/parse-transaction", json={"text": "x" * 1001}).status_code == 422
    assert api.post("/api/v1/ai/parse-transaction", json={"text": ""}).status_code == 422


def test_ai_rate_limit(api, fake_ai, monkeypatch):
    monkeypatch.setenv("AI_RATE_LIMIT_PER_MINUTE", "2")
    from app.core.config import get_settings
    get_settings.cache_clear()
    for _ in range(2):
        fake_ai.add_json(ai_tx(intent="not_a_transaction"))
        assert api.post("/api/v1/ai/parse-transaction", json={"text": "hello"}).status_code == 200
    r = api.post("/api/v1/ai/parse-transaction", json={"text": "hello"})
    assert r.status_code == 429 and "Retry-After" in r.headers
    get_settings.cache_clear()
