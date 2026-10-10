from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.core.config import Settings, get_settings
from app.database.session import check_database

router = APIRouter(tags=["Health"])


@router.get("/health", summary="Liveness check (no dependencies)")
def health():
    return {"status": "healthy", "application": "DukaanDiary AI"}


@router.get("/health/ready", summary="Readiness: is the database reachable and are services configured?")
def readiness(settings: Settings = Depends(get_settings)):
    checks = {
        "database": "not_configured",
        "auth": "configured" if settings.auth_configured else "not_configured",
        "gemini": "configured" if settings.gemini_api_key else "not_configured",
    }
    if settings.database_url:
        try:
            check_database()
            checks["database"] = "ok"
        except Exception:  # never leak connection details
            checks["database"] = "unreachable"
    ready = checks["database"] == "ok" and checks["auth"] == "configured"
    return JSONResponse(status_code=200 if ready else 503,
                        content={"status": "ready" if ready else "not_ready", "checks": checks})
