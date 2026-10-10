"""Authentication (who are you?) and authorization (which shop may you touch?).

How it works:
1. The frontend logs the user in with Supabase Auth and receives an access token.
2. Every API call sends it as:  Authorization: Bearer <access_token>
3. We verify the token's signature, expiry and audience here.
   - New Supabase projects sign tokens with asymmetric keys. We fetch the public
     keys from  <SUPABASE_URL>/auth/v1/.well-known/jwks.json  (cached).
   - Older projects use a shared HS256 secret (SUPABASE_JWT_SECRET).
4. The user id comes ONLY from the verified token ("sub" claim), never from the request body.
5. We then check that the user is a member of the workspace they are acting on.

DEV_AUTH_BYPASS=true (development only, refused in production) skips step 1-3
and acts as a fixed local developer user, so Swagger can be used before login exists.
"""
import logging
import uuid
from dataclasses import dataclass
from functools import lru_cache

import jwt
from fastapi import Depends, Header, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.exceptions import AuthenticationError, PermissionDeniedError, ServiceNotConfiguredError
from app.database.models import Profile, Workspace, WorkspaceMember
from app.database.session import get_db

logger = logging.getLogger("dukaandiary.auth")
bearer_scheme = HTTPBearer(auto_error=False, description="Supabase access token")


@dataclass(frozen=True)
class CurrentUser:
    id: uuid.UUID
    email: str | None


@dataclass(frozen=True)
class WorkspaceContext:
    """Everything a service needs to scope its queries safely."""
    user: CurrentUser
    workspace_id: uuid.UUID
    role: str

    @property
    def user_id(self) -> uuid.UUID:
        return self.user.id


@lru_cache(maxsize=4)
def _jwks_client(supabase_url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(f"{supabase_url}/auth/v1/.well-known/jwks.json",
                           cache_keys=True, lifespan=600, timeout=10)


def verify_access_token(token: str, settings: Settings) -> dict:
    """Return the verified claims of a Supabase access token, or raise AuthenticationError."""
    if not settings.auth_configured:
        raise ServiceNotConfiguredError(
            "Authentication is not configured. Set SUPABASE_URL (and SUPABASE_JWT_SECRET for legacy projects).")
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError:
        raise AuthenticationError("The access token is malformed.")

    alg = header.get("alg")
    options = {"require": ["exp", "sub"]}
    issuer = f"{settings.supabase_url}/auth/v1" if settings.supabase_url else None
    try:
        if alg == "HS256":
            if not settings.supabase_jwt_secret:
                raise AuthenticationError("This token type is not accepted by the server.")
            key = settings.supabase_jwt_secret
            algorithms = ["HS256"]
        elif alg in ("ES256", "RS256"):
            if not settings.supabase_url:
                raise AuthenticationError("This token type is not accepted by the server.")
            key = _jwks_client(settings.supabase_url).get_signing_key_from_jwt(token).key
            algorithms = [alg]
        else:
            raise AuthenticationError("This token type is not accepted by the server.")

        decode_kwargs = {"algorithms": algorithms, "audience": settings.supabase_jwt_audience,
                         "options": options, "leeway": 30}
        if issuer:
            decode_kwargs["issuer"] = issuer
        return jwt.decode(token, key, **decode_kwargs)
    except jwt.ExpiredSignatureError:
        raise AuthenticationError("Your session has expired. Please log in again.", code="token_expired")
    except jwt.PyJWKClientError:
        logger.warning("Could not fetch Supabase signing keys")
        raise AuthenticationError("Could not verify the access token right now.")
    except jwt.PyJWTError:
        raise AuthenticationError("The access token is invalid.")


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    settings: Settings = Depends(get_settings),
) -> CurrentUser:
    if credentials is None or credentials.scheme.lower() != "bearer":
        if settings.dev_auth_bypass and settings.app_env != "production":
            user = CurrentUser(id=uuid.UUID(settings.dev_user_id), email=settings.dev_user_email)
            request.state.user_id = str(user.id)
            return user
        raise AuthenticationError("Log in first: send 'Authorization: Bearer <access token>'.")

    claims = verify_access_token(credentials.credentials, settings)
    try:
        user_id = uuid.UUID(str(claims["sub"]))
    except (ValueError, KeyError):
        raise AuthenticationError("The access token does not identify a user.")
    request.state.user_id = str(user_id)
    return CurrentUser(id=user_id, email=claims.get("email"))


def _ensure_profile_and_default_workspace(db: Session, user: CurrentUser) -> None:
    """First request from a new user: create their profile and a default shop.

    An advisory lock stops two simultaneous first requests from creating two shops.
    """
    db.execute(text("select pg_advisory_xact_lock(hashtext(:k))"), {"k": f"provision:{user.id}"})
    profile = db.get(Profile, user.id)
    if profile is None:
        db.add(Profile(id=user.id, email=user.email))
        db.flush()
    has_workspace = db.scalar(select(WorkspaceMember.workspace_id)
                              .where(WorkspaceMember.user_id == user.id).limit(1))
    if has_workspace is None:
        ws = Workspace(name="My Shop", created_by=user.id)
        db.add(ws)
        db.flush()
        db.add(WorkspaceMember(workspace_id=ws.id, user_id=user.id, role="owner"))
    db.commit()


def get_workspace_context(
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
    x_workspace_id: str | None = Header(default=None, description="Optional. Defaults to your first shop."),
) -> WorkspaceContext:
    """Resolve which workspace (shop) this request acts on, and prove the user belongs to it."""
    membership_q = select(WorkspaceMember).where(WorkspaceMember.user_id == user.id)
    if x_workspace_id:
        try:
            wanted = uuid.UUID(x_workspace_id)
        except ValueError:
            raise PermissionDeniedError("Invalid X-Workspace-Id header.")
        member = db.scalar(membership_q.where(WorkspaceMember.workspace_id == wanted))
        if member is None:
            # Same answer whether the workspace exists or not, so ids cannot be probed.
            raise PermissionDeniedError("You do not have access to this workspace.")
    else:
        member = db.scalar(membership_q.order_by(WorkspaceMember.created_at).limit(1))
        if member is None:
            _ensure_profile_and_default_workspace(db, user)
            member = db.scalar(membership_q.order_by(WorkspaceMember.created_at).limit(1))
    return WorkspaceContext(user=user, workspace_id=member.workspace_id, role=member.role)


def require_owner(ctx: WorkspaceContext = Depends(get_workspace_context)) -> WorkspaceContext:
    if ctx.role != "owner":
        raise PermissionDeniedError("Only the shop owner can do this.")
    return ctx
