import logging
from typing import Any, Optional

from fastapi import Depends, Request


logger = logging.getLogger(__name__)
MOCK_BEARER_PREFIX = "mock-"
OPEN_PATHS = frozenset({
    "/health",
    "/ready",
    "/api/auth/send-otp",
    "/api/auth/login",
})
ROLE_FREE_AUTH_PATHS = frozenset({
    "/api/auth/logout",
    "/api/auth/me",
})
_MOCK_AUTH_SESSIONS: dict[str, dict[str, Any]] = {}


class AuthError(Exception):
    def __init__(self, status_code: int, error: str):
        super().__init__(error)
        self.status_code = status_code
        self.error = error


def _extract_bearer_token(authorization: str) -> str:
    if not authorization:
        return ""
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer":
        return ""
    return token.strip()


def _is_open_request(request: Request) -> bool:
    return request.method.upper() == "OPTIONS" or request.url.path in OPEN_PATHS


def _requires_auth(request: Request) -> bool:
    return request.url.path.startswith("/api/") and not _is_open_request(request)


def store_mock_auth_session(token: str, user: dict[str, Any]) -> None:
    _MOCK_AUTH_SESSIONS[token] = dict(user)


def delete_mock_auth_session(token: str) -> None:
    _MOCK_AUTH_SESSIONS.pop(token, None)


def resolve_bearer_user(token: str) -> Optional[dict[str, Any]]:
    if not token:
        return None
    user = _MOCK_AUTH_SESSIONS.get(token)
    if not user:
        return None
    return dict(user)


def _raise_auth_error(request: Request, status_code: int, error: str) -> None:
    logger.error(
        "AuthError path=%s method=%s tenant_id=%s error=%s",
        request.url.path,
        request.method,
        getattr(request.state, "tenant_id", None),
        error,
    )
    raise AuthError(status_code=status_code, error=error)


async def require_authenticated_user(request: Request) -> Optional[dict[str, Any]]:
    if not _requires_auth(request):
        return None

    cached_user = getattr(request.state, "current_user", None)
    if cached_user:
        return dict(cached_user)

    bearer_token = _extract_bearer_token(request.headers.get("Authorization", "").strip())
    if not bearer_token:
        _raise_auth_error(request, 401, "Unauthorized")

    user = resolve_bearer_user(bearer_token)
    if not user:
        _raise_auth_error(request, 401, "Unauthorized")

    request.state.current_user = dict(user)
    request.state.tenant_id = int(user.get("tenant_id") or 1)
    return dict(user)


async def require_api_key(request: Request) -> int:
    if _is_open_request(request):
        request.state.current_user = None
        request.state.tenant_id = None
        return 0

    user = await require_authenticated_user(request)
    if not user:
        _raise_auth_error(request, 401, "Unauthorized")

    tenant_id = int(user.get("tenant_id") or 1)
    request.state.current_user = dict(user)
    request.state.tenant_id = tenant_id
    return tenant_id


async def enforce_dashboard_rbac(
    request: Request,
    user: Optional[dict[str, Any]] = Depends(require_authenticated_user),
) -> None:
    if not _requires_auth(request) or user is None:
        return

    if request.url.path in ROLE_FREE_AUTH_PATHS or request.method.upper() == "GET":
        return

    role = str(user.get("role") or "").strip().lower()
    if role in {"admin", "enterprise_admin"}:
        return
    if role == "member":
        _raise_auth_error(request, 403, "只读成员无权修改")
    _raise_auth_error(request, 403, "C 端用户不能进后台")


verify_api_key = require_api_key
