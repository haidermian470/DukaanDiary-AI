"""Phase C/F: dashboard, trends, breakdowns and reports agree with each other."""
from datetime import timedelta

from app.utils.dates import resolve_period, today_local
from tests.conftest import create_sale, summary

TODAY = today_local()


def _expense(api, amount, category, days_ago=0, paid=None):
    r = api.post("/api/v1/transactions", json={
        "type": "expense", "amount": amount, "amount_paid": paid if paid is not None else amount,
        "payment_method": "cash", "description": f"{category} cost", "category": category,
        "transaction_date": (TODAY - timedelta(days=days_ago)).isoformat(),
        **({"contact_name": "K-Electric"} if paid == "0" else {})})
    assert r.status_code == 201, r.text
    return r.json()


def test_empty_dashboard_shows_zeros_not_errors(api):
    s = summary(api)
    assert s["figures"]["total_sales"] == "0.00"
    assert s["recent_transactions"] == []
    assert s["has_demo_data"] is False
    assert "profit" in s["definitions"]


def test_balances_ignore_the_period_but_flows_respect_it(api):
    old = (TODAY - timedelta(days=60)).isoformat()
    create_sale(api, "5000", "1000", contact="Ahmed", date=old)
    s = summary(api, "today")
    assert s["figures"]["total_sales"] == "0.00"          # the sale is not from today
    assert s["balances"]["receivables"] == "4000.00"      # but the customer still owes today
    assert summary(api, "all_time")["figures"]["total_sales"] == "5000.00"


def test_received_breakdown_separates_old_dues(api):
    old = (TODAY - timedelta(days=60)).isoformat()
    create_sale(api, "5000", "0", contact="Ahmed", date=old)
    create_sale(api, "1000", "1000", contact=None)
    api.post("/api/v1/payments/settle-contact", json={"contact_name": "Ahmed", "amount": "2000"})
    s = summary(api, "today")
    assert s["figures"]["money_received"] == "3000.00"
    assert s["received_breakdown"] == {"for_sales_in_period": "1000.00", "for_older_sales": "2000.00",
                                       "advances": "0.00"}


def test_trends_buckets_match_summary(api):
    create_sale(api, "300", "300", contact=None, date=(TODAY - timedelta(days=2)).isoformat())
    create_sale(api, "700", "200", contact="Ahmed")
    _expense(api, "150", "transport", days_ago=1)
    r = api.get("/api/v1/dashboard/trends?period=last_7_days&granularity=day").json()
    assert len(r["points"]) == 7
    total_sales = sum(float(p["sales"]) for p in r["points"])
    total_in = sum(float(p["money_received"]) for p in r["points"])
    s = summary(api, "last_7_days")["figures"]
    assert total_sales == float(s["total_sales"]) == 1000
    assert total_in == float(s["money_received"]) == 500
    weekly = api.get("/api/v1/dashboard/trends?period=last_30_days&granularity=week").json()
    assert sum(float(p["expenses"]) for p in weekly["points"]) == 150


def test_expense_breakdown_shares(api):
    _expense(api, "300", "transport")
    _expense(api, "700", "electricity")
    r = api.get("/api/v1/dashboard/expense-breakdown?period=this_month").json()
    assert r["total"] == "1000.00"
    assert [(c["category"], c["share_percent"]) for c in r["categories"]] == [("electricity", 70.0), ("transport", 30.0)]


def test_custom_period_validation(api):
    r = api.get("/api/v1/dashboard/summary?date_from=2026-10-09&date_to=2026-10-01")
    assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_period"


def test_report_summary_and_csv_export(api):
    create_sale(api, "5000", "3000", contact="=HYPERLINK(evil)")
    _expense(api, "800", "transport")
    rep = api.get("/api/v1/reports/summary?period=this_month").json()
    assert rep["figures"]["total_sales"] == "5000.00"
    assert rep["top_customers_owing"][0]["outstanding"] == "2000.00"
    csv = api.get("/api/v1/reports/transactions?period=this_month&format=csv")
    assert csv.status_code == 200 and csv.headers["content-type"].startswith("text/csv")
    lines = csv.text.strip().splitlines()
    assert lines[0].startswith("transaction_date,type,category")
    assert len(lines) == 3
    assert "'=HYPERLINK" in csv.text  # formula injection neutralised
    assert ",'," not in csv.text      # empty cells stay empty
    js = api.get("/api/v1/reports/transactions?period=this_month&type=expense").json()
    assert js["total"] == 1


def test_dashboard_matches_ledgers_and_history(api):
    """Same numbers everywhere: dashboard receivables = sum of customer ledgers = sum of open items."""
    create_sale(api, "5000", "3000", contact="Ahmed")
    create_sale(api, "2000", "500", contact="Sana")
    api.post("/api/v1/payments/settle-contact", json={"contact_name": "Sana", "amount": "500"})
    s = summary(api)
    ledgers = api.get("/api/v1/contacts?kind=customer").json()
    history = api.get("/api/v1/transactions?type=sale").json()["items"]
    from decimal import Decimal
    assert Decimal(s["balances"]["receivables"]) == sum(Decimal(c["outstanding"]) for c in ledgers) \
        == sum(Decimal(t["outstanding"]) for t in history) == Decimal("3000")
