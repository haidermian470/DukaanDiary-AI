"""Phase A: app starts, health, config validation, error format. Mostly no database needed."""
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from tests.conftest import _configure_env


@pytest.fixture
def bare_client():
    _configure_env(None)  # no database configured
    from app.main import create_app
    with TestClient(create_app()) as c:
        yield c


def test_health_needs_no_dependencies(bare_client):
    r = bare_client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json() == {"status": "healthy", "application": "DukaanDiary AI"}
    assert "X-Request-ID" in r.headers


def test_legacy_root_and_health_still_work(bare_client):
    assert bare_client.get("/").json()["status"] == "running"
    assert bare_client.get("/health").json()["status"] == "healthy"


def test_readiness_reports_missing_database(bare_client):
    r = bare_client.get("/api/v1/health/ready")
    assert r.status_code == 503
    assert r.json()["checks"]["database"] == "not_configured"


def test_protected_endpoint_without_token_is_401(bare_client):
    r = bare_client.get("/api/v1/transactions")
    assert r.status_code == 401
    body = r.json()
    assert body["error"]["code"] == "not_authenticated"
    assert "request_id" in body["error"]


def test_unknown_route_uses_standard_error_shape(bare_client):
    r = bare_client.get("/api/v1/does-not-exist")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "not_found"


def test_cors_allows_only_configured_origin(bare_client):
    ok = bare_client.options("/api/v1/health", headers={"Origin": "http://localhost:5173",
                                                        "Access-Control-Request-Method": "GET"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:5173"
    bad = bare_client.options("/api/v1/health", headers={"Origin": "https://evil.example",
                                                         "Access-Control-Request-Method": "GET"})
    assert bad.headers.get("access-control-allow-origin") is None


def test_dev_bypass_is_refused_in_production(monkeypatch):
    from app.core.config import Settings
    with pytest.raises(ValidationError):
        Settings(app_env="production", dev_auth_bypass=True, _env_file=None)


def test_wildcard_origin_is_refused_in_production():
    from app.core.config import Settings
    with pytest.raises(ValidationError):
        Settings(app_env="production", frontend_origins="*", _env_file=None)


def test_database_url_is_normalised_for_psycopg():
    from app.core.config import Settings
    s = Settings(database_url="postgresql://u:p@host:5432/postgres", _env_file=None)
    assert s.database_url.startswith("postgresql+psycopg://")
    s = Settings(database_url="postgres://u:p@host/db", _env_file=None)
    assert s.database_url.startswith("postgresql+psycopg://")


def test_ai_not_configured_gives_clear_503(bare_client, monkeypatch):
    from app.core.exceptions import AIServiceError
    from app.services.gemini_service import get_ai_client
    with pytest.raises(AIServiceError) as exc:
        get_ai_client()
    assert exc.value.code == "ai_not_configured"


def test_money_helpers():
    from decimal import Decimal
    from app.utils.money import format_pkr, to_money
    assert to_money(0.1) + to_money(0.2) == Decimal("0.30")
    assert to_money("5000") == Decimal("5000.00")
    assert format_pkr(Decimal("12500")) == "Rs 12,500"
    assert format_pkr(Decimal("12500.5")) == "Rs 12,500.50"


def test_periods_use_monday_weeks():
    from datetime import date
    from app.utils.dates import previous_period, resolve_period
    today = date(2026, 10, 10)  # a Saturday
    week = resolve_period("this_week", today=today)
    assert (week.start, week.end) == (date(2026, 10, 5), today)
    last = resolve_period("last_week", today=today)
    assert (last.start, last.end) == (date(2026, 9, 28), date(2026, 10, 4))
    month = resolve_period("this_month", today=today)
    assert previous_period(month).start == date(2026, 9, 1)
    assert previous_period(month).end == date(2026, 9, 30)
    with pytest.raises(ValueError):
        resolve_period("custom", date(2026, 10, 5), date(2026, 10, 1))
