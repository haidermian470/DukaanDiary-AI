"""Phase E: Dummy Bank, screenshot matching, imports, receipts and demo data."""
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.schemas.verification import AIScreenshotExtraction
from app.services.verification_service import compare
from app.utils.dates import today_local
from tests.conftest import create_sale, summary

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
NOW = datetime.now(timezone.utc)


def shot(**kw):
    base = {"is_payment_screenshot": True, "amount": None, "currency": "PKR", "reference": None,
            "transaction_datetime": None, "sender_name": None, "recipient_name": None, "status_text": None,
            "status_category": None, "service_name": None, "legibility": "clear", "unreadable_fields": [],
            "notes": None}
    return {**base, **kw}


def record(status="completed", amount="2000", ref="DDB-100001", name="Ahmed Raza", hours_ago=2):
    return {"id": uuid.uuid4(), "reference": ref, "amount": Decimal(amount), "status": status,
            "counterparty_name": name, "occurred_at": NOW - timedelta(hours=hours_ago)}


def run(extraction, records, imported=frozenset()):
    return compare(AIScreenshotExtraction.model_validate(shot(**extraction)), records, set(imported))


# ---------------------------------------------------------------------------
# Pure matching rules (no database, no AI)
# ---------------------------------------------------------------------------
def test_exact_match():
    r = run({"amount": 2000, "reference": "ddb 100001", "sender_name": "Ahmed R.", "status_category": "success",
             "transaction_datetime": NOW.isoformat()}, [record()])
    assert r["outcome"] == "matched_demo_record" and r["confidence"] == "high"


def test_amount_mismatch_on_same_reference_is_suspicious_not_fraud():
    r = run({"amount": 20000, "reference": "DDB-100001"}, [record()])
    assert r["outcome"] == "potentially_suspicious"
    assert "fraud" not in r["explanation"].lower()


def test_pending_record_is_pending_or_delayed():
    r = run({"amount": 2000, "reference": "DDB-100001"}, [record(status="pending")])
    assert r["outcome"] == "pending_or_delayed"


def test_failed_record_vs_success_claim():
    assert run({"amount": 2000, "reference": "DDB-100001", "status_category": "success"},
               [record(status="failed")])["outcome"] == "potentially_suspicious"
    assert run({"amount": 2000, "reference": "DDB-100001", "status_category": "failed"},
               [record(status="cancelled")])["outcome"] == "mismatch"


def test_name_or_date_mismatch():
    assert run({"amount": 2000, "reference": "DDB-100001", "sender_name": "Zubair"}, [record()])["outcome"] == "mismatch"
    old = (NOW - timedelta(days=5)).isoformat()
    assert run({"amount": 2000, "reference": "DDB-100001", "transaction_datetime": old}, [record()])["outcome"] == "mismatch"


def test_unknown_reference_is_unverified_not_fraud():
    r = run({"amount": 2000, "reference": "TID-999"}, [record(amount="5000")])
    assert r["outcome"] == "unverified" and "not proof of fraud" in r["explanation"]


def test_no_reference_needs_amount_date_and_name():
    rec = record()
    ok = run({"amount": 2000, "sender_name": "Ahmed", "transaction_datetime": NOW.isoformat()}, [rec])
    assert ok["outcome"] == "matched_demo_record" and ok["confidence"] == "medium"
    no_name = run({"amount": 2000, "transaction_datetime": NOW.isoformat()}, [rec])
    assert no_name["outcome"] == "unverified"
    two = run({"amount": 2000, "sender_name": "Ahmed"}, [rec, record(ref="DDB-100009")])
    assert two["outcome"] == "unverified"


def test_unreadable_screenshot_is_unverified():
    assert run({"is_payment_screenshot": False}, [record()])["outcome"] == "unverified"
    assert run({}, [record()])["outcome"] == "unverified"


def test_already_imported_record_warns_against_double_recording():
    rec = record()
    r = run({"amount": 2000, "reference": "DDB-100001"}, [rec], {rec["id"]})
    assert r["outcome"] == "matched_demo_record" and r["already_imported"]
    assert "Do not record it twice" in r["recommended_action"]


def test_local_time_on_screenshot_is_read_as_pakistan_time():
    rec = record(hours_ago=0)
    pk_local = rec["occurred_at"].astimezone(timezone(timedelta(hours=5))).replace(tzinfo=None)
    r = run({"amount": 2000, "reference": "DDB-100001", "transaction_datetime": pk_local.isoformat()}, [rec])
    date_cmp = next(c for c in r["comparisons"] if c["field"] == "date_time")
    assert date_cmp["result"] == "match"


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
def test_dummy_bank_is_seeded_and_labelled(api):
    accounts = api.get("/api/v1/dummy-bank/accounts").json()
    assert len(accounts) == 1 and accounts[0]["is_synthetic"] and "NO REAL BANK" in accounts[0]["disclaimer"]
    txns = api.get("/api/v1/dummy-bank/transactions").json()
    assert {t["status"] for t in txns} == {"completed", "pending", "failed", "cancelled"}
    assert api.get("/api/v1/dummy-bank/accounts").json()[0]["id"] == accounts[0]["id"]  # idempotent


def _bank(api, ref):
    return next(t for t in api.get("/api/v1/dummy-bank/transactions").json() if t["reference"] == ref)


def test_screenshot_endpoint_end_to_end(api, fake_ai):
    _bank(api, "DDB-100001")
    fake_ai.add_json(shot(amount=2000, reference="DDB-100001", sender_name="Ahmed Raza", status_category="success"))
    r = api.post("/api/v1/ai/analyze-screenshot", files={"file": ("s.png", PNG, "image/png")})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["outcome"] == "matched_demo_record" and body["proves_real_payment"] is False
    assert "NO REAL BANK" in body["disclaimer"]
    assert fake_ai.calls[0]["images"] == 1
    assert api.get("/api/v1/ai/screenshot-checks").json()[0]["outcome"] == "matched_demo_record"


def test_delayed_transfer_demo(api, fake_ai):
    """Screenshot arrives before the transfer: unverified. Transfer appears: matched."""
    api.get("/api/v1/dummy-bank/accounts")
    extraction = shot(amount=4500, reference="DDB-DELAY-01", sender_name="Sana Ahmed", status_category="success")
    fake_ai.add_json(extraction)
    first = api.post("/api/v1/ai/analyze-screenshot", files={"file": ("s.png", PNG, "image/png")}).json()
    assert first["outcome"] == "unverified"
    created = api.post("/api/v1/dummy-bank/simulate/incoming", json={
        "amount": "4500", "counterparty_name": "Sana Ahmed", "reference": "DDB-DELAY-01", "status": "pending"}).json()
    fake_ai.add_json(extraction)
    second = api.post("/api/v1/ai/analyze-screenshot", files={"file": ("s.png", PNG, "image/png")}).json()
    assert second["outcome"] == "pending_or_delayed"
    api.post(f"/api/v1/dummy-bank/simulate/transactions/{created['id']}/status", json={"status": "completed"})
    fake_ai.add_json(extraction)
    third = api.post("/api/v1/ai/analyze-screenshot", files={"file": ("s.png", PNG, "image/png")}).json()
    assert third["outcome"] == "matched_demo_record"


@pytest.mark.parametrize("content, name, status", [
    (b"GIF89a....", "x.gif", 415),
    (b"%PDF-1.4 hello", "x.png", 415),          # wrong bytes behind a .png name
    (b"", "x.png", 400),
    (b"\x89PNG\r\n\x1a\n" + b"0" * (1024 * 1024 + 10), "big.png", 413),
], ids=["gif", "pdf-renamed-png", "empty", "too-large"])
def test_bad_uploads_are_rejected(api, fake_ai, content, name, status):
    r = api.post("/api/v1/ai/analyze-screenshot", files={"file": (name, content, "image/png")})
    assert r.status_code == status
    assert fake_ai.calls == []  # never reached the AI


def test_import_new_transaction_and_duplicate_protection(api):
    t = _bank(api, "DDB-100008")  # completed, money in, 7,500
    body = {"mode": "new_transaction", "new_transaction": {"type": "sale", "description": "Bulk order",
                                                           "contact_name": "Farooq General Store"}}
    r = api.post(f"/api/v1/dummy-bank/import/{t['id']}", json=body)
    assert r.status_code == 201, r.text
    s = summary(api)
    assert s["figures"]["total_sales"] == "7500.00" and s["figures"]["money_received"] == "7500.00"
    again = api.post(f"/api/v1/dummy-bank/import/{t['id']}", json=body)
    assert again.status_code == 409
    assert summary(api)["figures"]["total_sales"] == "7500.00"   # not double counted
    assert _bank(api, "DDB-100008")["imported"] is True
    created = r.json()["created_transaction_id"]
    assert api.delete(f"/api/v1/transactions/{created}").status_code == 409  # import stays consistent


def test_import_settles_existing_due_without_new_sale(api):
    sale = create_sale(api, "5000", "3000", contact="Ahmed Raza")
    t = _bank(api, "DDB-100001")  # 2,000 in
    r = api.post(f"/api/v1/dummy-bank/import/{t['id']}", json={"mode": "settle_transaction", "transaction_id": sale["id"]})
    assert r.status_code == 201, r.text
    s = summary(api)
    assert s["figures"]["sales_count"] == 1 and s["balances"]["receivables"] == "0.00"
    pay = api.get(f"/api/v1/payments/{r.json()['payment_ids'][0]}").json()
    assert pay["from_dummy_bank"] and pay["method"] == "bank"
    assert api.patch(f"/api/v1/payments/{pay['id']}", json={"status": "cancelled"}).status_code == 409


def test_import_settle_contact(api):
    create_sale(api, "1500", "0", contact="Ahmed Raza")
    create_sale(api, "1500", "0", contact="Ahmed Raza")
    contact_id = api.get("/api/v1/contacts?kind=customer").json()[0]["id"]
    t = _bank(api, "DDB-100001")
    r = api.post(f"/api/v1/dummy-bank/import/{t['id']}", json={"mode": "settle_contact", "contact_id": contact_id})
    assert r.status_code == 201 and len(r.json()["payment_ids"]) == 2
    assert summary(api)["balances"]["receivables"] == "1000.00"


@pytest.mark.parametrize("ref", ["DDB-100003", "DDB-100004", "DDB-100005"])  # pending, failed, cancelled
def test_non_completed_transfers_cannot_be_imported(api, ref):
    t = _bank(api, ref)
    r = api.post(f"/api/v1/dummy-bank/import/{t['id']}",
                 json={"mode": "new_transaction", "new_transaction": {"type": "sale", "description": "x"}})
    assert r.status_code == 422
    assert summary(api)["figures"]["money_received"] == "0.00"


def test_direction_must_match_and_overpayment_is_refused(api):
    expense = api.post("/api/v1/transactions", json={"type": "expense", "amount": "100", "amount_paid": "0",
                                                     "description": "Bill", "contact_name": "K-Electric"}).json()
    t_in = _bank(api, "DDB-100001")
    r = api.post(f"/api/v1/dummy-bank/import/{t_in['id']}", json={"mode": "settle_transaction", "transaction_id": expense["id"]})
    assert r.status_code == 422  # money IN cannot pay an expense
    t_out = _bank(api, "DDB-100007")  # 2,750 out
    r = api.post(f"/api/v1/dummy-bank/import/{t_out['id']}", json={"mode": "settle_transaction", "transaction_id": expense["id"]})
    assert r.status_code == 422  # 2,750 is more than the 100 due
    assert _bank(api, "DDB-100007")["imported"] is False  # failed import left no trace


def test_other_users_cannot_touch_my_dummy_bank(api):
    from tests.conftest import USER_B
    t = _bank(api, "DDB-100008")
    b = api.as_user(USER_B)
    assert b.get(f"/api/v1/dummy-bank/transactions/{t['id']}").status_code == 404
    r = b.post(f"/api/v1/dummy-bank/import/{t['id']}",
               json={"mode": "new_transaction", "new_transaction": {"type": "sale", "description": "steal"}})
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Receipts
# ---------------------------------------------------------------------------
def receipt(**kw):
    base = {"is_receipt_like": True, "document_kind": "receipt", "merchant_name": "Al-Fatah Store",
            "receipt_date": today_local().isoformat(), "total_amount": 1250, "currency": "PKR", "tax_amount": None,
            "line_items": [{"name": "Sugar", "quantity": 2, "unit_price": 300, "line_total": 600},
                           {"name": "Oil", "quantity": 1, "unit_price": 650, "line_total": 650}],
            "payment_method_shown": "cash", "paid_marking_visible": None, "suggested_category": "groceries",
            "unreadable_fields": [], "notes": None}
    return {**base, **kw}


def test_receipt_returns_unsaved_draft_without_assuming_payment(api, fake_ai):
    fake_ai.add_json(receipt())
    r = api.post("/api/v1/ai/analyze-receipt", files={"file": ("r.jpg", b"\xff\xd8\xff" + b"0" * 50, "image/jpeg")})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total_amount"] == "1250.00" and body["saved"] is False
    assert body["draft"]["amount_paid"] is None and "does not prove" in body["note"]
    assert body["warnings"] == []
    assert api.get("/api/v1/transactions").json()["total"] == 0


def test_receipt_warnings(api, fake_ai):
    fake_ai.add_json(receipt(total_amount=2000, document_kind="quotation", unreadable_fields=["tax"]))
    body = api.post("/api/v1/ai/analyze-receipt", files={"file": ("r.png", PNG, "image/png")}).json()
    joined = " ".join(body["warnings"])
    assert "differs from the total" in joined and "quotation" in joined and "unreadable" in joined
    fake_ai.add_json(receipt(total_amount=None, is_receipt_like=False, line_items=[]))
    body = api.post("/api/v1/ai/analyze-receipt", files={"file": ("r.png", PNG, "image/png")}).json()
    assert body["total_amount"] is None and len(body["warnings"]) >= 2


# ---------------------------------------------------------------------------
# Demo data
# ---------------------------------------------------------------------------
def test_demo_seed_is_consistent_and_resettable(api):
    r = api.post("/api/v1/demo/seed")
    assert r.status_code == 201, r.text
    assert api.post("/api/v1/demo/seed").status_code == 409
    s = summary(api, "all_time")
    assert s["has_demo_data"] is True
    assert s["balances"]["receivables"] == "9000.00"   # Ahmed 2,000 + Bilal 5,000 + Sana 2,000
    assert s["balances"]["payables"] == "6000.00"
    overdue = api.get("/api/v1/contacts?overdue_only=true").json()
    assert [c["name"] for c in overdue] == ["Ahmed Raza"]
    items = api.get("/api/v1/transactions?page_size=100").json()["items"]
    assert all(t["is_demo"] and t["description"].startswith("[DEMO]") for t in items)

    real = api.post("/api/v1/transactions", json={"type": "expense", "amount": "99", "amount_paid": "99",
                                                  "payment_method": "cash", "description": "Real tea"}).json()
    assert api.delete("/api/v1/demo/data").status_code == 400  # needs confirm=true
    out = api.delete("/api/v1/demo/data?confirm=true").json()
    assert out["removed_transactions"] == 12
    left = api.get("/api/v1/transactions").json()
    assert left["total"] == 1 and left["items"][0]["id"] == real["id"]
