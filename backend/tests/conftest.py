"""Test setup.

Database tests run against a REAL PostgreSQL with the real migration SQL applied:
  * If TEST_DATABASE_URL is set, that database is used (it is wiped - never point it at real data!).
  * Otherwise the `pgserver` package (requirements-dev.txt) starts a throwaway local Postgres.
  * If neither is available, database tests are skipped (pure logic tests still run).

Gemini is never called: tests replace it with FakeAI, which returns scripted answers.
Auth uses real signed JWTs (HS256 test secret), exactly like Supabase legacy tokens.
"""
import os
import tempfile
import time
import uuid
from collections import deque
from pathlib import Path

import jwt
import psycopg
import pytest

TEST_JWT_SECRET = "test-only-jwt-secret-that-is-long-enough-123456"
TEST_SUPABASE_URL = "https://test-project.supabase.co"
USER_A = uuid.UUID("aaaaaaaa-0000-4000-8000-000000000001")
USER_B = uuid.UUID("bbbbbbbb-0000-4000-8000-000000000002")

TABLES = ["payment_verifications", "payments", "dummy_bank_imports", "dummy_bank_transactions",
          "dummy_bank_accounts", "transactions", "contacts", "workspace_members", "workspaces", "profiles"]

_db_url_cache: dict = {}


def _start_database() -> str | None:
    url = os.environ.get("TEST_DATABASE_URL")
    if url:
        return url
    try:
        import pgserver
    except ImportError:
        return None
    data_dir = Path(tempfile.gettempdir()) / "dukaandiary_pgtest"
    server = pgserver.get_server(data_dir, cleanup_mode="stop")
    base = server.get_uri()
    with psycopg.connect(base, autocommit=True) as conn:
        conn.execute("drop database if exists dukaan_test with (force)")
        conn.execute("create database dukaan_test")
        # Recreate the roles Supabase provides, so the migration's REVOKE/RLS statements work.
        conn.execute("""do $$ begin
            if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
            if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
        end $$;""")
    _db_url_cache["server"] = server
    return base.rsplit("/", 1)[0] + "/dukaan_test"


@pytest.fixture(scope="session")
def database_url():
    url = _start_database()
    if not url:
        pytest.skip("No test database (install requirements-dev.txt or set TEST_DATABASE_URL)")
    from scripts.apply_migrations import apply_all
    apply_all(url, verbose=False)
    return url


def _configure_env(database_url: str | None):
    os.environ.update({
        "APP_ENV": "test",
        "SUPABASE_JWT_SECRET": TEST_JWT_SECRET,
        "SUPABASE_URL": TEST_SUPABASE_URL,
        "FRONTEND_ORIGINS": "http://localhost:5173",
        "LOG_LEVEL": "WARNING",
        "DEV_AUTH_BYPASS": "false",
        "AI_RATE_LIMIT_PER_MINUTE": "1000",
        "MAX_UPLOAD_SIZE_MB": "1",
        "GEMINI_API_KEY": "",
        "DATABASE_URL": database_url or "",
    })

    os.environ.pop("GEMINI_MODEL", None)
    os.environ.pop("GEMINI_TIMEOUT_SECONDS", None)

    from app.core.config import get_settings
    from app.database import session

    get_settings.cache_clear()
    session.get_engine.cache_clear()
    session._session_factory.cache_clear()

class FakeAI:
    """Stands in for Gemini. Queue answers with .add_json(obj) / .add_text(str) / .add_error(exc)."""

    def __init__(self):
        self.json_answers: deque = deque()
        self.text_answers: deque = deque()
        self.calls: list[dict] = []

    def add_json(self, value):
        self.json_answers.append(value)

    def add_text(self, value):
        self.text_answers.append(value)

    def generate_json(self, *, system, prompt, schema, images=None):
        self.calls.append({"kind": "json", "schema": schema.__name__, "prompt": prompt, "images": len(images or [])})
        if not self.json_answers:
            raise AssertionError(f"FakeAI got an unexpected JSON request for {schema.__name__}")
        value = self.json_answers.popleft()
        if isinstance(value, Exception):
            raise value
        return schema.model_validate(value)

    def generate_text(self, *, system, prompt):
        self.calls.append({"kind": "text", "prompt": prompt})
        if not self.text_answers:
            raise AssertionError("FakeAI got an unexpected text request")
        value = self.text_answers.popleft()
        if isinstance(value, Exception):
            raise value
        return value


@pytest.fixture
def fake_ai():
    return FakeAI()


@pytest.fixture
def app(database_url, fake_ai):
    _configure_env(database_url)
    with psycopg.connect(database_url, autocommit=True) as conn:
        conn.execute("truncate " + ", ".join(f"public.{t}" for t in TABLES) + " cascade")
    from app.core.rate_limit import ai_limiter
    from app.main import create_app
    from app.services.gemini_service import get_ai_client, get_optional_ai_client
    ai_limiter.reset()
    application = create_app()
    application.dependency_overrides[get_ai_client] = lambda: fake_ai
    application.dependency_overrides[get_optional_ai_client] = lambda: fake_ai
    return application


@pytest.fixture
def client(app):
    from fastapi.testclient import TestClient
    with TestClient(app) as c:
        yield c


def make_token(user_id=USER_A, email="a@example.com", expires_in=3600, secret=TEST_JWT_SECRET,
               audience="authenticated", issuer=f"{TEST_SUPABASE_URL}/auth/v1") -> str:
    now = int(time.time())
    payload = {"sub": str(user_id), "email": email, "aud": audience, "role": "authenticated",
               "iat": now, "exp": now + expires_in, "iss": issuer}
    return jwt.encode(payload, secret, algorithm="HS256")


def auth(user_id=USER_A, **extra_headers) -> dict:
    return {"Authorization": f"Bearer {make_token(user_id)}", **extra_headers}


@pytest.fixture
def api(client):
    """Client wrapper that sends user A's token by default."""
    class Api:
        def __init__(self, user=USER_A):
            self.user = user

        def as_user(self, user):
            return Api(user)

        def _h(self, headers):
            return {**auth(self.user), **(headers or {})}

        def get(self, url, headers=None, **kw):
            return client.get(url, headers=self._h(headers), **kw)

        def post(self, url, headers=None, **kw):
            return client.post(url, headers=self._h(headers), **kw)

        def patch(self, url, headers=None, **kw):
            return client.patch(url, headers=self._h(headers), **kw)

        def delete(self, url, headers=None, **kw):
            return client.delete(url, headers=self._h(headers), **kw)

    return Api()


# ---------------------------------------------------------------------------
# Small helpers used by many tests
# ---------------------------------------------------------------------------
def create_sale(api, amount="5000", paid="3000", contact="Ahmed", due=None, date=None, **extra):
    body = {"type": "sale", "amount": amount, "amount_paid": paid, "description": "Sold goods",
            "payment_method": "cash" if paid not in ("0", 0) else None, "contact_name": contact, **extra}
    if due:
        body["due_date"] = due
    if date:
        body["transaction_date"] = date
    r = api.post("/api/v1/transactions", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def summary(api, period="this_month"):
    r = api.get(f"/api/v1/dashboard/summary?period={period}")
    assert r.status_code == 200, r.text
    return r.json()
