"""Phase C: accounting rules. These are the most important tests in the project."""
import threading
from datetime import timedelta

import pytest

from app.utils.dates import today_local
from tests.conftest import create_sale, summary

TODAY = today_local()
TOMORROW = (TODAY + timedelta(days=1)).isoformat()
YESTERDAY = (TODAY - timedelta(days=1)).isoformat()


def test_acceptance_a_partial_sale(api):
    """Sold 5,000, received 3,000, rest due tomorrow."""
    sale = create_sale(api, "5000", "3000", contact="Ali", due=TOMORROW)
    assert sale["amount"] == "5000.00"
    assert sale["amount_paid"] == "3000.00"
    assert sale["outstanding"] == "2000.00"
    assert sale["settlement_status"] == "partially_paid"
    assert sale["due_date"] == TOMORROW
    assert len(sale["payments"]) == 1 and sale["payments"][0]["direction"] == "in"

    s = summary(api)
    assert s["figures"]["total_sales"] == "5000.00"        # sales up 5,000
    assert s["figures"]["money_received"] == "3000.00"     # cash up 3,000 (not 5,000)
    assert s["balances"]["receivables"] == "2000.00"       # receivable 2,000
    assert s["recent_transactions"][0]["id"] == sale["id"]

    ledger = api.get(f"/api/v1/contacts/{sale['contact']['id']}").json()
    assert ledger["contact"]["outstanding"] == "2000.00"
    assert [e["running_balance"] for e in ledger["entries"]] == ["5000.00", "2000.00"]
    history = api.get("/api/v1/transactions").json()
    assert history["total"] == 1 and history["items"][0]["outstanding"] == "2000.00"


def test_acceptance_b_cash_expense(api):
    r = api.post("/api/v1/transactions", json={"type": "expense", "amount": "800", "amount_paid": "800",
                                               "payment_method": "cash", "description": "Transport",
                                               "category": "Transport"})
    assert r.status_code == 201
    t = r.json()
    assert t["category"] == "transport" and t["settlement_status"] == "paid"
    s = summary(api)
    assert s["figures"]["total_expenses"] == "800.00"
    assert s["figures"]["money_paid"] == "800.00"
    assert s["figures"]["net_cash_flow"] == "-800.00"
    assert s["balances"]["payables"] == "0.00"


def test_acceptance_c_payment_against_dues_is_not_a_sale(api):
    create_sale(api, "5000", "3000", contact="Ahmed")
    r = api.post("/api/v1/payments/settle-contact", json={"contact_name": "ahmed", "amount": "2000"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["outstanding_before"] == "2000.00" and body["outstanding_after"] == "0.00"
    s = summary(api)
    assert s["figures"]["total_sales"] == "5000.00"        # NOT 7,000
    assert s["figures"]["sales_count"] == 1
    assert s["figures"]["money_received"] == "5000.00"
    assert s["balances"]["receivables"] == "0.00"


def test_settlement_applies_oldest_due_first(api):
    old = create_sale(api, "1000", "0", contact="Ahmed", date=(TODAY - timedelta(days=5)).isoformat())
    new = create_sale(api, "3000", "0", contact="Ahmed")
    body = api.post("/api/v1/payments/settle-contact", json={"contact_name": "Ahmed", "amount": "1500"}).json()
    assert [p["amount"] for p in body["payments"]] == ["1000.00", "500.00"]
    assert api.get(f"/api/v1/transactions/{old['id']}").json()["settlement_status"] == "paid"
    assert api.get(f"/api/v1/transactions/{new['id']}").json()["outstanding"] == "2500.00"


def test_settlement_cannot_exceed_dues_or_hit_unknown_contact(api):
    create_sale(api, "5000", "3000", contact="Ahmed")
    r = api.post("/api/v1/payments/settle-contact", json={"contact_name": "Ahmed", "amount": "2500"})
    assert r.status_code == 422 and "advance" in r.json()["error"]["message"]
    r = api.post("/api/v1/payments/settle-contact", json={"contact_name": "Ahmad", "amount": "100"})
    assert r.status_code == 404
    assert r.json()["error"]["details"]["did_you_mean"][0]["name"] == "Ahmed"


def test_credit_purchase_creates_payable_and_supplier_payment_reduces_it(api):
    r = api.post("/api/v1/transactions", json={"type": "purchase", "amount": "10000", "amount_paid": "4000",
                                               "payment_method": "cash", "description": "Stock",
                                               "contact_name": "Wholesale Mart"})
    purchase = r.json()
    assert purchase["contact"]["kind"] == "supplier"
    assert summary(api)["balances"]["payables"] == "6000.00"
    r = api.post("/api/v1/payments", json={"transaction_id": purchase["id"], "amount": "6000", "method": "bank"})
    assert r.status_code == 201 and r.json()["direction"] == "out"
    s = summary(api)
    assert s["balances"]["payables"] == "0.00"
    assert s["figures"]["total_purchases"] == "10000.00"   # not 16,000
    assert s["figures"]["money_paid"] == "10000.00"


def test_pending_failed_cancelled_payments_do_not_count(api):
    sale = create_sale(api, "5000", "0", contact="Ahmed")
    pend = api.post("/api/v1/payments", json={"transaction_id": sale["id"], "amount": "2000", "status": "pending"}).json()
    t = api.get(f"/api/v1/transactions/{sale['id']}").json()
    assert t["amount_paid"] == "0.00" and t["amount_pending"] == "2000.00" and t["outstanding"] == "5000.00"
    assert summary(api)["figures"]["money_received"] == "0.00"

    # Pending money is reserved: you cannot also record 3,500 completed (2,000 + 3,500 > 5,000).
    r = api.post("/api/v1/payments", json={"transaction_id": sale["id"], "amount": "3500"})
    assert r.status_code == 422

    assert api.patch(f"/api/v1/payments/{pend['id']}", json={"status": "failed"}).json()["status"] == "failed"
    assert summary(api)["figures"]["money_received"] == "0.00"
    assert api.patch(f"/api/v1/payments/{pend['id']}", json={"status": "completed"}).status_code == 422

    ok = api.post("/api/v1/payments", json={"transaction_id": sale["id"], "amount": "5000"}).json()
    assert summary(api)["figures"]["money_received"] == "5000.00"
    api.patch(f"/api/v1/payments/{ok['id']}", json={"status": "cancelled"})  # reversal (bounced)
    s = summary(api)
    assert s["figures"]["money_received"] == "0.00" and s["balances"]["receivables"] == "5000.00"


def test_completing_a_pending_payment_counts_it(api):
    sale = create_sale(api, "5000", "0", contact="Ahmed")
    p = api.post("/api/v1/payments", json={"transaction_id": sale["id"], "amount": "1500", "status": "pending"}).json()
    r = api.patch(f"/api/v1/payments/{p['id']}", json={"status": "completed"})
    assert r.status_code == 200
    assert summary(api)["balances"]["receivables"] == "3500.00"
    # Completed payments cannot have their amount changed.
    assert api.patch(f"/api/v1/payments/{p['id']}", json={"amount": "100"}).status_code == 422


@pytest.mark.parametrize("body, field", [
    ({"amount": "-5"}, "amount"),
    ({"amount": "0"}, "amount"),
    ({"amount": "10.555"}, "amount"),
    ({"type": "refund"}, "type"),
    ({"amount_paid": "6000"}, ""),
    ({"description": ""}, "description"),
])
def test_invalid_input_is_rejected(api, body, field):
    base = {"type": "sale", "amount": "5000", "amount_paid": "5000", "payment_method": "cash",
            "description": "Goods"}
    r = api.post("/api/v1/transactions", json={**base, **body})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "validation_error"
    assert api.get("/api/v1/transactions").json()["total"] == 0


def test_business_rules_on_create(api):
    r = api.post("/api/v1/transactions", json={"type": "sale", "amount": "5000", "amount_paid": "1000",
                                               "payment_method": "cash", "description": "Credit, no name"})
    assert r.status_code == 422 and r.json()["error"]["details"]["missing_field"] == "contact_name"
    future = (TODAY + timedelta(days=3)).isoformat()
    r = api.post("/api/v1/transactions", json={"type": "expense", "amount": "50", "amount_paid": "50",
                                               "payment_method": "cash", "description": "x", "transaction_date": future})
    assert r.status_code == 422
    r = api.post("/api/v1/transactions", json={"type": "expense", "amount": "50", "amount_paid": "50",
                                               "description": "x"})
    assert r.status_code == 422  # payment_method required when money was paid


def test_sale_cannot_be_linked_to_a_supplier(api):
    supplier = api.post("/api/v1/contacts", json={"kind": "supplier", "name": "Mart"}).json()
    r = api.post("/api/v1/transactions", json={"type": "sale", "amount": "100", "amount_paid": "0",
                                               "description": "x", "contact_id": supplier["id"]})
    assert r.status_code == 422


def test_acceptance_g_duplicate_submission_is_ignored(api):
    body = {"type": "sale", "amount": "700", "amount_paid": "700", "payment_method": "cash", "description": "Retry"}
    first = api.post("/api/v1/transactions", json=body, headers={"Idempotency-Key": "click-123"})
    second = api.post("/api/v1/transactions", json=body, headers={"Idempotency-Key": "click-123"})
    assert first.status_code == 201 and second.status_code == 200
    assert second.headers["Idempotent-Replay"] == "true"
    assert first.json()["id"] == second.json()["id"]
    assert api.get("/api/v1/transactions").json()["total"] == 1
    assert summary(api)["figures"]["money_received"] == "700.00"


def test_duplicate_settlement_retry_is_ignored(api):
    create_sale(api, "5000", "0", contact="Ahmed")
    body = {"contact_name": "Ahmed", "amount": "1000"}
    a = api.post("/api/v1/payments/settle-contact", json=body, headers={"Idempotency-Key": "pay-1"})
    b = api.post("/api/v1/payments/settle-contact", json=body, headers={"Idempotency-Key": "pay-1"})
    assert a.status_code == 201 and b.status_code == 200
    assert summary(api)["balances"]["receivables"] == "4000.00"


def test_parallel_payments_cannot_overpay(api, app):
    """Two payments of 3,000 race on a 5,000 sale: the row lock lets only one through."""
    sale = create_sale(api, "5000", "0", contact="Ahmed")
    from fastapi.testclient import TestClient
    from tests.conftest import auth
    results = []
    barrier = threading.Barrier(2)

    def pay():
        with TestClient(app) as c:
            barrier.wait()
            results.append(c.post("/api/v1/payments", headers=auth(),
                                  json={"transaction_id": sale["id"], "amount": "3000"}).status_code)

    threads = [threading.Thread(target=pay) for _ in range(2)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(results) == [201, 422]
    assert api.get(f"/api/v1/transactions/{sale['id']}").json()["amount_paid"] == "3000.00"


def test_void_removes_transaction_and_its_payments_from_totals(api):
    sale = create_sale(api, "5000", "3000", contact="Ahmed")
    assert api.delete(f"/api/v1/transactions/{sale['id']}").status_code == 204
    s = summary(api)
    assert s["figures"]["total_sales"] == "0.00"
    assert s["figures"]["money_received"] == "0.00"
    assert s["balances"]["receivables"] == "0.00"
    assert api.get(f"/api/v1/transactions/{sale['id']}").status_code == 404
    assert api.get("/api/v1/payments").json()["total"] == 0


def test_update_rules(api):
    sale = create_sale(api, "5000", "3000", contact="Ahmed")
    assert api.patch(f"/api/v1/transactions/{sale['id']}", json={"amount": "2000"}).status_code == 422
    r = api.patch(f"/api/v1/transactions/{sale['id']}", json={"amount": "6000", "description": "Fixed"})
    assert r.status_code == 200 and r.json()["outstanding"] == "3000.00"
    r = api.patch(f"/api/v1/transactions/{sale['id']}", json={"contact_id": None})
    assert r.status_code == 422  # money still due, so a customer is required
    r = api.patch(f"/api/v1/transactions/{sale['id']}", json={"contact_name": "Bilal"})
    assert r.status_code == 200 and r.json()["contact"]["name"] == "Bilal"
    assert r.json()["payments"][0]["contact"]["name"] == "Bilal"  # payments follow the record


def test_advance_payment(api):
    supplier = api.post("/api/v1/contacts", json={"kind": "supplier", "name": "Mart"}).json()
    r = api.post("/api/v1/payments", json={"is_advance": True, "contact_id": supplier["id"], "amount": "3000"})
    assert r.status_code == 201 and r.json()["is_advance"] and r.json()["direction"] == "out"
    s = summary(api)
    assert s["figures"]["money_paid"] == "3000.00"
    assert s["figures"]["total_purchases"] == "0.00"
    bal = api.get(f"/api/v1/contacts/{supplier['id']}").json()["contact"]
    assert bal["advance_balance"] == "3000.00" and bal["outstanding"] == "0.00"


def test_acceptance_e_overdue_customer(api):
    old_date = (TODAY - timedelta(days=10)).isoformat()
    create_sale(api, "4000", "1000", contact="Late Larry", date=old_date,
                due=(TODAY - timedelta(days=3)).isoformat())
    create_sale(api, "1000", "0", contact="On Time", due=TOMORROW)
    overdue = api.get("/api/v1/contacts?kind=customer&overdue_only=true").json()
    assert [c["name"] for c in overdue] == ["Late Larry"]
    assert overdue[0]["overdue_amount"] == "3000.00"
    assert summary(api)["balances"]["overdue_receivables"] == "3000.00"
    listed = api.get("/api/v1/transactions?overdue_only=true").json()
    assert listed["total"] == 1 and listed["items"][0]["is_overdue"] is True


def test_list_filters_and_pagination(api):
    for i in range(5):
        create_sale(api, str(100 + i), str(100 + i), contact=None)
    api.post("/api/v1/transactions", json={"type": "expense", "amount": "50", "amount_paid": "50",
                                           "payment_method": "cash", "description": "Tea", "category": "food"})
    page = api.get("/api/v1/transactions?type=sale&page_size=2&page=2").json()
    assert page["total"] == 5 and len(page["items"]) == 2 and page["has_more"] is True
    assert api.get("/api/v1/transactions?category=food").json()["total"] == 1
    assert api.get("/api/v1/transactions?search=tea").json()["total"] == 1
    assert api.get("/api/v1/transactions?settlement_status=unpaid").json()["total"] == 0
    assert api.get(f"/api/v1/transactions?date_from={TOMORROW}").json()["total"] == 0


def test_duplicate_contact_names_are_prevented(api):
    assert api.post("/api/v1/contacts", json={"kind": "customer", "name": "Ahmed"}).status_code == 201
    assert api.post("/api/v1/contacts", json={"kind": "customer", "name": "  ahmed "}).status_code == 409
    create_sale(api, "100", "0", contact="AHMED")
    assert len(api.get("/api/v1/contacts?kind=customer").json()) == 1
