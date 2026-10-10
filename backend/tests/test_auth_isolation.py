"""Phase B: authentication, workspace isolation and database-level lockdown."""
import uuid

import psycopg
import pytest

from tests.conftest import USER_A, USER_B, auth, create_sale, make_token


def test_me_creates_profile_and_default_shop_once(api):
    first = api.get("/api/v1/me").json()
    second = api.get("/api/v1/me").json()
    assert first["user"]["id"] == str(USER_A)
    assert len(first["workspaces"]) == 1 and len(second["workspaces"]) == 1
    assert first["current_workspace_id"] == second["current_workspace_id"]
    assert first["workspaces"][0]["currency"] == "PKR"
    assert first["workspaces"][0]["role"] == "owner"


@pytest.mark.parametrize("token, code", [
    ("not-a-jwt", "not_authenticated"),
    (make_token(secret="wrong-secret-wrong-secret-wrong-secret-1"), "not_authenticated"),
    (make_token(expires_in=-120), "token_expired"),
    (make_token(audience="anon"), "not_authenticated"),
    (make_token(issuer="https://evil.supabase.co/auth/v1"), "not_authenticated"),
])
def test_bad_tokens_are_rejected(client, token, code):
    r = client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == code


def test_user_id_comes_from_token_not_body(api):
    """Sending another user's id in the body has no effect: ownership comes from the token."""
    r = api.post("/api/v1/transactions", json={
        "type": "expense", "amount": "100", "amount_paid": "100", "payment_method": "cash",
        "description": "Tea", "created_by": str(USER_B), "workspace_id": str(uuid.uuid4())})
    assert r.status_code == 201
    assert api.as_user(USER_B).get("/api/v1/transactions").json()["total"] == 0


def test_users_cannot_see_each_others_records(api):
    sale = create_sale(api)
    b = api.as_user(USER_B)
    assert b.get("/api/v1/transactions").json()["total"] == 0
    assert b.get(f"/api/v1/transactions/{sale['id']}").status_code == 404
    assert b.patch(f"/api/v1/transactions/{sale['id']}", json={"description": "hack"}).status_code == 404
    assert b.delete(f"/api/v1/transactions/{sale['id']}").status_code == 404
    pay_id = sale["payments"][0]["id"]
    assert b.get(f"/api/v1/payments/{pay_id}").status_code == 404
    assert b.post("/api/v1/payments", json={"transaction_id": sale["id"], "amount": "100"}).status_code == 404
    contact_id = sale["contact"]["id"]
    assert b.get(f"/api/v1/contacts/{contact_id}").status_code == 404
    assert b.get("/api/v1/dashboard/summary").json()["figures"]["total_sales"] == "0.00"
    # Still intact for the owner
    assert api.get(f"/api/v1/transactions/{sale['id']}").json()["description"] == "Sold goods"


def test_workspace_header_for_someone_elses_shop_is_forbidden(api):
    ws_a = api.get("/api/v1/me").json()["current_workspace_id"]
    r = api.as_user(USER_B).get("/api/v1/transactions", headers={"X-Workspace-Id": ws_a})
    assert r.status_code == 403
    r = api.get("/api/v1/transactions", headers={"X-Workspace-Id": "not-a-uuid"})
    assert r.status_code == 403


def test_dev_bypass_only_when_enabled(client, monkeypatch):
    assert client.get("/api/v1/me").status_code == 401
    monkeypatch.setenv("DEV_AUTH_BYPASS", "true")
    monkeypatch.setenv("APP_ENV", "development")
    from app.core.config import get_settings
    get_settings.cache_clear()
    try:
        r = client.get("/api/v1/me")
        assert r.status_code == 200
        assert r.json()["user"]["email"] == "dev@dukaandiary.local"
    finally:
        monkeypatch.setenv("DEV_AUTH_BYPASS", "false")
        monkeypatch.setenv("APP_ENV", "test")
        get_settings.cache_clear()


@pytest.mark.parametrize("role", ["anon", "authenticated"])
def test_public_data_api_roles_cannot_read_financial_tables(database_url, api, role):
    """Supabase's browser-facing roles have no access at all (RLS on + privileges revoked)."""
    create_sale(api)
    with psycopg.connect(database_url, autocommit=True) as conn:
        conn.execute(f"set role {role}")
        for table in ("transactions", "payments", "contacts", "workspaces", "dummy_bank_transactions"):
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                conn.execute(f"select * from public.{table}")
        conn.execute("reset role")


def test_rls_is_enabled_on_every_table(database_url):
    with psycopg.connect(database_url) as conn:
        rows = conn.execute("""select relname, relrowsecurity from pg_class c
                               join pg_namespace n on n.oid = c.relnamespace
                               where n.nspname = 'public' and c.relkind = 'r'""").fetchall()
    assert rows and all(enabled for _, enabled in rows), rows


def test_database_unavailable_returns_503(client, monkeypatch):
    from sqlalchemy.exc import OperationalError
    from app.services import transaction_service

    def boom(*a, **k):
        raise OperationalError("select 1", {}, Exception("connection refused"))

    monkeypatch.setattr(transaction_service, "list_transactions", boom)
    r = client.get("/api/v1/transactions", headers=auth())
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "database_unavailable"
    assert "refused" not in r.text  # internals are not leaked
