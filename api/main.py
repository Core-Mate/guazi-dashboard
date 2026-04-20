import asyncio
from collections import OrderedDict
from contextlib import asynccontextmanager, suppress
from datetime import date
import importlib
import json
import logging
import os
import sys
import time
from typing import Any, Awaitable, Callable, Optional
from uuid import uuid4

import asyncpg
import uvicorn
from asyncpg import Pool
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address


def _sensitive_log_tokens() -> tuple[str, ...]:
    tokens = {
        os.getenv("DATABASE_URL", "").strip(),
        os.getenv("API_KEY", "").strip(),
        os.getenv("DASHBOARD_API_KEYS", "").strip(),
    }
    raw_keys = os.getenv("DASHBOARD_API_KEYS", "").strip()
    for entry in raw_keys.split(","):
        entry = entry.strip()
        if not entry or ":" not in entry:
            continue
        key, _ = entry.rsplit(":", 1)
        key = key.strip()
        if key:
            tokens.add(key)
    return tuple(token for token in tokens if token)


def _sanitize_log_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: ("[REDACTED]" if key.lower() in {"api_key", "password", "database_url"} else _sanitize_log_value(val))
            for key, val in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [_sanitize_log_value(item) for item in value]
    if isinstance(value, str):
        sanitized = value
        for token in _sensitive_log_tokens():
            sanitized = sanitized.replace(token, "[REDACTED]")
        return sanitized
    return value


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "msg": _sanitize_log_value(record.getMessage()),
        }
        if hasattr(record, "extra"):
            payload.update(_sanitize_log_value(record.extra))
        if record.exc_info:
            payload["exc_info"] = _sanitize_log_value(self.formatException(record.exc_info))
        return json.dumps(payload, ensure_ascii=False)


root = logging.getLogger()
handler = logging.StreamHandler(sys.stdout)
handler.setFormatter(JsonFormatter())
root.handlers = [handler]
root.setLevel(os.getenv("LOG_LEVEL", "INFO").upper())

import auth
from auth import require_api_key
import db

_cors_env = os.getenv('CORS_ORIGINS', '').strip()
if _cors_env:
    CORS_ALLOWED = [o.strip() for o in _cors_env.split(',') if o.strip()]
else:
    CORS_ALLOWED = ['*']

_EXPLORE_ENABLED = os.getenv("ENABLE_EXPLORE", "").lower() in ("1", "true", "yes")

try:
    from cachetools import TTLCache
except ImportError:  # pragma: no cover
    class TTLCache:
        def __init__(self, maxsize: int, ttl: float):
            self.maxsize = maxsize
            self.ttl = ttl
            self._data: OrderedDict[Any, tuple[Any, float]] = OrderedDict()

        def _expire(self) -> None:
            now = time.monotonic()
            expired_keys = [
                key for key, (_, expires_at) in self._data.items()
                if expires_at <= now
            ]
            for key in expired_keys:
                self._data.pop(key, None)

        def get(self, key: Any, default: Any = None) -> Any:
            self._expire()
            entry = self._data.get(key)
            if entry is None:
                return default

            value, expires_at = entry
            if expires_at <= time.monotonic():
                self._data.pop(key, None)
                return default

            self._data.move_to_end(key)
            return value

        def __setitem__(self, key: Any, value: Any) -> None:
            self._expire()
            if key in self._data:
                self._data.pop(key, None)
            elif len(self._data) >= self.maxsize:
                self._data.popitem(last=False)
            self._data[key] = (value, time.monotonic() + self.ttl)

        def clear(self) -> None:
            self._data.clear()

logger = logging.getLogger(__name__)
WARMUP_RANGES = ("today", "yesterday", "7d", "30d")
_DASHBOARD_CACHE_TTL = 90
_DASHBOARD_CACHE_MAXSIZE = 200
_DASHBOARD_CACHE_MISS = object()
_dashboard_highlights_cache = TTLCache(maxsize=_DASHBOARD_CACHE_MAXSIZE, ttl=_DASHBOARD_CACHE_TTL)
_dashboard_highlights_lock = asyncio.Lock()
_dashboard_charts_cache = TTLCache(maxsize=_DASHBOARD_CACHE_MAXSIZE, ttl=_DASHBOARD_CACHE_TTL)
_dashboard_charts_lock = asyncio.Lock()
_dashboard_aggs_cache = TTLCache(maxsize=_DASHBOARD_CACHE_MAXSIZE, ttl=_DASHBOARD_CACHE_TTL)
_dashboard_aggs_lock = asyncio.Lock()
_dashboard_ops_trend_cache = TTLCache(maxsize=_DASHBOARD_CACHE_MAXSIZE, ttl=_DASHBOARD_CACHE_TTL)
_dashboard_ops_trend_lock = asyncio.Lock()
_WARMUP_TASK_TIMEOUT_SECONDS = 90.0
_WARMUP_TICK_TIMEOUT_SECONDS = 120.0


def tenant_key_fn(request: Request) -> str:
    tenant_id = getattr(request.state, "tenant_id", None)
    if not tenant_id:
        bearer_token = _extract_bearer_token(request.headers.get("Authorization", "").strip())
        tenant_id = _resolve_mock_bearer_tenant_id(bearer_token)
    if tenant_id:
        return f"tenant:{tenant_id}"
    return get_remote_address(request)


limiter = Limiter(key_func=tenant_key_fn)


def _get_warmup_tenant_ids() -> list[int]:
    raw = os.getenv("DASHBOARD_WARMUP_TENANT_IDS", "").strip()
    if raw:
        tenant_ids: list[int] = []
        for part in raw.split(","):
            part = part.strip()
            if not part:
                continue
            try:
                tenant_ids.append(int(part))
            except ValueError:
                logger.warning("Skipping invalid DASHBOARD_WARMUP_TENANT_IDS entry: %s", part)
        if tenant_ids:
            return sorted(set(tenant_ids))

    fallback_tenant = os.getenv("TENANT_ID", "1").strip()
    try:
        return [int(fallback_tenant)]
    except ValueError:
        logger.warning("Invalid TENANT_ID for warmup: %s; falling back to tenant_id=1", fallback_tenant)
        return [1]

async def _refill_hot_caches(ranges: Optional[tuple[str, ...]] = None) -> None:
    started_at = time.perf_counter()
    pool = await db.get_pool()
    queries = get_queries_module()
    tenants = _get_warmup_tenant_ids()
    ranges = ranges or WARMUP_RANGES
    for tenant_id in tenants:
        for range_value in ranges:
            cache_key = _dashboard_cache_key(tenant_id, range_value, None, None)
            warmers = (
                (
                    "snapshot",
                    lambda t=tenant_id, rr=range_value: queries.aggregate_snapshot(pool, t, rr),
                ),
                (
                    "highlights",
                    lambda t=tenant_id, rr=range_value, ck=cache_key: _cached_dashboard_payload(
                        _dashboard_highlights_cache,
                        _dashboard_highlights_lock,
                        ck,
                        lambda tt=t, rr2=rr: _load_dashboard_highlights_bundle(pool, tt, rr2, None, None),
                    ),
                ),
                (
                    "charts",
                    lambda t=tenant_id, rr=range_value, ck=cache_key: _cached_dashboard_payload(
                        _dashboard_charts_cache,
                        _dashboard_charts_lock,
                        ck,
                        lambda tt=t, rr2=rr: queries.aggregate_charts(pool, tt, rr2, None, None),
                    ),
                ),
                (
                    "aggs",
                    lambda t=tenant_id, rr=range_value, ck=cache_key: _cached_dashboard_payload(
                        _dashboard_aggs_cache,
                        _dashboard_aggs_lock,
                        ck,
                        lambda tt=t, rr2=rr: queries.aggregate_aggregations(pool, tt, rr2, None, None),
                    ),
                ),
                (
                    "ops_trend",
                    lambda t=tenant_id, rr=range_value, ck=cache_key: _cached_dashboard_payload(
                        _dashboard_ops_trend_cache,
                        _dashboard_ops_trend_lock,
                        ck,
                        lambda tt=t, rr2=rr: _load_dashboard_ops_trend(pool, tt, rr2, None, None),
                    ),
                ),
            )
            async def _run_warmer(name: str, warmer: Callable[[], Awaitable[Any]]) -> Any:
                warmer_started_at = time.perf_counter()
                try:
                    result = await asyncio.wait_for(warmer(), timeout=_WARMUP_TASK_TIMEOUT_SECONDS)
                except asyncio.TimeoutError:
                    elapsed = time.perf_counter() - warmer_started_at
                    logger.error(
                        "Dashboard %s warmup timed out after %.3fs for tenant_id=%s range=%s",
                        name,
                        elapsed,
                        tenant_id,
                        range_value,
                    )
                    raise
                elapsed = time.perf_counter() - warmer_started_at
                logger.info(
                    "Dashboard %s warmup completed in %.3fs for tenant_id=%s range=%s",
                    name,
                    elapsed,
                    tenant_id,
                    range_value,
                )
                return result

            range_started_at = time.perf_counter()
            results = await asyncio.gather(
                *(_run_warmer(name, warmer) for name, warmer in warmers),
                return_exceptions=True,
            )
            failures = [
                (name, result)
                for (name, _), result in zip(warmers, results)
                if isinstance(result, Exception)
            ]
            if failures:
                for name, exc in failures:
                    logger.error(
                        "Dashboard %s warmup failed for tenant_id=%s range=%s",
                        name,
                        tenant_id,
                        range_value,
                        exc_info=(type(exc), exc, exc.__traceback__),
                    )
            else:
                logger.info(
                    "Dashboard warmup completed in %.3fs for tenant_id=%s range=%s",
                    time.perf_counter() - range_started_at,
                    tenant_id,
                    range_value,
                )
    elapsed = time.perf_counter() - started_at
    logger.info(
        "Dashboard hot cache refill completed in %.1fs for %s ranges x %s tenants",
        elapsed,
        len(ranges),
        len(tenants),
    )


async def _hot_cache_tick_loop(interval_seconds: int = 60):
    while True:
        tick_started_at = time.perf_counter()
        try:
            await asyncio.wait_for(_refill_hot_caches(), timeout=_WARMUP_TICK_TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            logger.error(
                "Dashboard hot cache tick timed out after %.3fs",
                time.perf_counter() - tick_started_at,
            )
        except Exception:
            logger.exception("Dashboard hot cache refill failed")
        finally:
            logger.info(
                "Dashboard hot cache tick iteration completed in %.3fs",
                time.perf_counter() - tick_started_at,
            )
        await asyncio.sleep(interval_seconds)


async def _warmup(ranges: Optional[tuple[str, ...]] = None) -> None:
    try:
        await _refill_hot_caches(ranges)
    except Exception:
        logger.exception("Dashboard snapshot warmup initialization failed")


async def startup_self_check() -> None:
    pool = await db.get_pool()
    try:
        async with pool.acquire() as conn:
            await conn.execute("SELECT 1")
    except Exception as exc:
        raise RuntimeError(f"DB startup check failed: {exc}") from exc

    tenant_env = os.getenv("TENANT_ID", "").strip()
    logger.info(
        "Dashboard startup self-check passed",
        extra={
            "extra": {
                "tenant_id_configured": bool(tenant_env and tenant_env != "1"),
            }
        },
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_pool()
    try:
        await startup_self_check()
        await _warmup(("7d", "today"))
    except Exception:
        await db.close_pool()
        raise
    tick_task = asyncio.create_task(_hot_cache_tick_loop(60))
    try:
        yield
    finally:
        tick_task.cancel()
        with suppress(asyncio.CancelledError):
            await tick_task
        await db.close_pool()


app = FastAPI(lifespan=lifespan, dependencies=[Depends(auth.enforce_dashboard_rbac)])
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOWED,
    allow_credentials=True if CORS_ALLOWED != ['*'] else False,
    allow_methods=['*'],
    allow_headers=['*'],
)


@app.middleware("http")
async def bind_tenant_context(request: Request, call_next):
    request.state.tenant_id = None
    request.state.current_user = None
    bearer_token = _extract_bearer_token(request.headers.get("Authorization", "").strip())
    user = auth.resolve_bearer_user(bearer_token)
    if not user:
        user_id = _extract_mock_bearer_user_id(bearer_token)
        if user_id is not None:
            try:
                pool = await db.get_pool()
                user = await _fetch_auth_user_by_id(pool, user_id)
            except asyncpg.PostgresError:
                logger.exception("Failed to hydrate bearer user from database")
                user = None
            if user:
                auth.store_mock_auth_session(bearer_token, user)
    if user:
        request.state.current_user = dict(user)
        request.state.tenant_id = int(user.get("tenant_id") or 1)
    return await call_next(request)


app.add_middleware(SlowAPIMiddleware)


@app.exception_handler(auth.AuthError)
async def handle_auth_error(_: Request, exc: auth.AuthError):
    return JSONResponse(status_code=exc.status_code, content={"error": exc.error})


@app.get("/health")
async def health_check(pool: Pool = Depends(db.get_pool)):
    conn = None
    try:
        conn = await asyncio.wait_for(pool.acquire(), timeout=2.0)
        try:
            await asyncio.wait_for(conn.fetchval("SELECT 1"), timeout=2.0)
        finally:
            await pool.release(conn)
            conn = None
        pool_stats = {
            "size": pool.get_size(),
            "idle_size": pool.get_idle_size(),
            "free": pool.get_size() - pool.get_idle_size(),
        }
        return {"ok": True, "pool": pool_stats}
    except asyncio.TimeoutError as exc:
        logger.exception("Dashboard health check timed out")
        raise HTTPException(status_code=503, detail="DB not responsive") from exc
    except Exception as exc:
        logger.exception("Dashboard health check failed")
        raise HTTPException(status_code=503, detail="DB not responsive") from exc
    finally:
        if conn is not None:
            await pool.release(conn)


@app.get("/ready")
async def readiness_check():
    return {"status": "ok"}

_ALLOWED_MEMBER_ROLES = {"admin", "enterprise_admin", "member", "user"}
_MAX_MEMBER_TEXT_LENGTH = 128
_MAX_REMARK_LENGTH = 500
# TODO: 当前开发态 DB 直查与 mock session 仅用于联调，上线前替换为 Better Auth。
_AUTH_USER_SELECT = """
    SELECT
        u.id,
        u.name,
        u."phoneNumber",
        u.role,
        u.tenant_id,
        t.tenant_name
    FROM users u
    LEFT JOIN tenants t
      ON t.id = u.tenant_id
    WHERE {predicate}
      AND u.is_deleted = false
      AND u.is_active = true
      AND COALESCE(u.banned, false) = false
"""


class SendOtpRequest(BaseModel):
    phone: Optional[str] = None
    phoneNumber: Optional[str] = None


class LoginRequest(BaseModel):
    phone: Optional[str] = None
    phoneNumber: Optional[str] = None
    code: Optional[str] = None
    verifyCode: Optional[str] = None


def _extract_bearer_token(authorization: Optional[str]) -> str:
    if not authorization:
        return ""
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer":
        return ""
    return token.strip()


def _normalize_phone_number(phone: str) -> str:
    cleaned = (phone or "").strip()
    if not cleaned:
        raise ValueError("phone is required")
    if len(cleaned) > 32:
        raise ValueError("phone is too long")
    return cleaned


def _resolve_request_phone_number(*candidates: Optional[str]) -> str:
    for candidate in candidates:
        if candidate and candidate.strip():
            return _normalize_phone_number(candidate)
    return _normalize_phone_number("")


def _resolve_request_verify_code(*candidates: Optional[str]) -> str:
    for candidate in candidates:
        if candidate and candidate.strip():
            return candidate.strip()
    return ""


def _serialize_auth_user(row: asyncpg.Record) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "phoneNumber": row["phoneNumber"],
        "role": row["role"],
        "tenant_id": row["tenant_id"],
        "tenant_name": row["tenant_name"],
    }


async def _fetch_auth_user_by_phone(pool: Pool, phone_number: str) -> Optional[dict[str, Any]]:
    row = await pool.fetchrow(
        _AUTH_USER_SELECT.format(predicate='u."phoneNumber" = $1'),
        phone_number,
    )
    if row is None:
        return None
    return _serialize_auth_user(row)


async def _fetch_auth_user_by_id(pool: Pool, user_id: int) -> Optional[dict[str, Any]]:
    row = await pool.fetchrow(
        _AUTH_USER_SELECT.format(predicate="u.id = $1"),
        user_id,
    )
    if row is None:
        return None
    return _serialize_auth_user(row)


async def _fetch_auth_login_candidate_row(pool: Pool, phone_number: str) -> Optional[asyncpg.Record]:
    return await pool.fetchrow(
        """
        SELECT
            u.id,
            u.name,
            u."phoneNumber",
            u.role,
            u.tenant_id,
            u.is_active,
            COALESCE(u.banned, false) AS banned,
            u.is_deleted,
            t.tenant_name
        FROM users u
        LEFT JOIN tenants t
          ON t.id = u.tenant_id
        WHERE u."phoneNumber" = $1
        ORDER BY
            CASE WHEN u.is_deleted THEN 1 ELSE 0 END,
            CASE WHEN u.is_active THEN 0 ELSE 1 END,
            CASE WHEN COALESCE(u.banned, false) THEN 1 ELSE 0 END,
            u.id DESC
        LIMIT 1
        """,
        phone_number,
    )


def _extract_mock_bearer_user_id(token: str) -> Optional[int]:
    if not token.startswith(auth.MOCK_BEARER_PREFIX):
        return None
    prefix, user_id_part, session_suffix = token.split("-", 2) if token.count("-") >= 2 else ("", "", "")
    if prefix != "mock" or not user_id_part or not session_suffix:
        return None
    try:
        return int(user_id_part)
    except ValueError:
        return None


def _resolve_mock_bearer_tenant_id(token: str) -> Optional[int]:
    user = auth.resolve_bearer_user(token)
    if not user:
        return None
    return int(user.get("tenant_id") or 1)


@app.post("/api/auth/send-otp")
async def api_auth_send_otp(body: SendOtpRequest):
    try:
        phone_number = _resolve_request_phone_number(body.phone, body.phoneNumber)
    except ValueError as exc:
        return value_error_response(exc)

    # TODO: 接入阿里云 SMS；开发环境固定验证码仅用于联调，上线前替换为 Better Auth。
    return {
        "success": True,
        "phone": phone_number,
        "devCode": "123456",
    }


@app.post("/api/auth/login")
async def api_auth_login(body: LoginRequest, pool: Pool = Depends(db.get_pool)):
    try:
        phone_number = _resolve_request_phone_number(body.phone, body.phoneNumber)
    except ValueError as exc:
        return value_error_response(exc)

    if _resolve_request_verify_code(body.code, body.verifyCode) != "123456":
        return JSONResponse(status_code=401, content={"error": "验证码错误"})

    try:
        candidate_row = await _fetch_auth_login_candidate_row(pool, phone_number)
    except asyncpg.PostgresError as exc:
        return postgres_error_response(exc)

    if candidate_row is None:
        return JSONResponse(status_code=404, content={"error": "未注册"})

    if candidate_row["is_deleted"] or (not candidate_row["is_active"]) or candidate_row["banned"]:
        return JSONResponse(status_code=403, content={"error": "无后台访问权限"})

    user = _serialize_auth_user(candidate_row)
    if user["role"] == "user":
        return JSONResponse(status_code=403, content={"error": "无后台访问权限"})
    if user["role"] not in {"admin", "enterprise_admin", "member"}:
        return JSONResponse(status_code=403, content={"error": "无后台访问权限"})

    token = f"{auth.MOCK_BEARER_PREFIX}{user['id']}-{uuid4()}"
    auth.store_mock_auth_session(token, user)
    # TODO: 当前开发态验证码校验与 mock token 仅用于联调，上线前替换为 Better Auth。
    return {"token": token, "user": user}


@app.post("/api/auth/logout")
async def api_auth_logout(
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    _: Optional[dict[str, Any]] = Depends(auth.require_authenticated_user),
):
    token = _extract_bearer_token(authorization)
    auth.delete_mock_auth_session(token)
    return {"success": True}


@app.get("/api/auth/me")
async def api_auth_me(
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    _: Optional[dict[str, Any]] = Depends(auth.require_authenticated_user),
    pool: Pool = Depends(db.get_pool),
):
    token = _extract_bearer_token(authorization)
    user_id = _extract_mock_bearer_user_id(token)
    if user_id is None:
        raise HTTPException(status_code=401, detail="登录态无效")

    try:
        user = await _fetch_auth_user_by_id(pool, user_id)
    except asyncpg.PostgresError as exc:
        return postgres_error_response(exc)

    if user is None:
        raise HTTPException(status_code=404, detail="该用户不存在或已失效")

    auth.store_mock_auth_session(token, user)
    # TODO: 当前开发态 mock bearer 仅用于联调，上线前替换为 Better Auth。
    return {"user": user}


def postgres_error_response(exc: asyncpg.PostgresError) -> JSONResponse:
    logger.exception(
        "Database request failed",
        exc_info=(type(exc), exc, exc.__traceback__),
    )
    return JSONResponse(status_code=503, content={"error": "database unavailable"})


def value_error_response(exc: ValueError) -> JSONResponse:
    return JSONResponse(status_code=400, content={"error": str(exc)})


def _normalize_member_text(
    value: Optional[str],
    *,
    field_name: str,
    required: bool = False,
) -> Optional[str]:
    if value is None:
        if required:
            raise ValueError(f"{field_name} is required")
        return None

    cleaned = value.strip()
    if not cleaned:
        raise ValueError(f"{field_name} must not be empty")
    if len(cleaned) > _MAX_MEMBER_TEXT_LENGTH:
        raise ValueError(f"{field_name} is too long")
    return cleaned


def _normalize_member_role(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None

    cleaned = value.strip().lower()
    if not cleaned:
        raise ValueError("role must not be empty")
    if cleaned not in _ALLOWED_MEMBER_ROLES:
        raise ValueError("role must be one of: admin, enterprise_admin, member, user")
    return cleaned


def _normalize_remark(value: Optional[str]) -> str:
    cleaned = (value or "").strip()
    if len(cleaned) > _MAX_REMARK_LENGTH:
        raise ValueError("remark is too long")
    return cleaned


def get_queries_module():
    return importlib.import_module("queries")


def _dashboard_cache_key(
    tenant_id: int,
    range_param: str,
    start: Optional[str],
    end: Optional[str],
) -> tuple[int, str, Optional[str], Optional[str]]:
    return tenant_id, range_param, start, end


def _clear_dashboard_component_caches() -> None:
    _dashboard_highlights_cache.clear()
    _dashboard_charts_cache.clear()
    _dashboard_aggs_cache.clear()
    _dashboard_ops_trend_cache.clear()


def _prime_dashboard_component_caches(
    tenant_id: int,
    range_param: str,
    start: Optional[str],
    end: Optional[str],
    snapshot: dict[str, Any],
) -> None:
    cache_key = _dashboard_cache_key(tenant_id, range_param, start, end)
    _dashboard_highlights_cache[cache_key] = {
        "highlights": snapshot.get("highlights", {}),
        "achievements": snapshot.get("achievements", {}),
    }
    _dashboard_charts_cache[cache_key] = snapshot.get("charts", {})
    _dashboard_aggs_cache[cache_key] = snapshot.get("aggs", {})
    _dashboard_ops_trend_cache[cache_key] = snapshot.get("ops_trend", {})


async def _cached_dashboard_payload(
    cache: TTLCache,
    lock: asyncio.Lock,
    cache_key: tuple[int, str, Optional[str], Optional[str]],
    loader: Callable[[], Awaitable[Any]],
) -> Any:
    cached_payload = cache.get(cache_key, _DASHBOARD_CACHE_MISS)
    if cached_payload is not _DASHBOARD_CACHE_MISS:
        return cached_payload

    async with lock:
        cached_payload = cache.get(cache_key, _DASHBOARD_CACHE_MISS)
        if cached_payload is not _DASHBOARD_CACHE_MISS:
            return cached_payload

        payload = await loader()
        cache[cache_key] = payload
        return payload


async def _load_dashboard_highlights_bundle(
    pool: Pool,
    tenant_id: int,
    range_param: str,
    start: Optional[str],
    end: Optional[str],
) -> dict[str, Any]:
    queries = get_queries_module()
    window = queries._resolve_window(range_param, start, end)
    cur_start, cur_end, prev_start, prev_end, _, _, _ = window
    cur_totals_task = asyncio.create_task(
        queries._fetch_period_totals(pool, tenant_id, cur_start, cur_end)
    )
    prev_totals_task = asyncio.create_task(
        queries._fetch_period_totals(pool, tenant_id, prev_start, prev_end)
    )
    highlights, achievements = await asyncio.gather(
        queries.aggregate_highlights(
            pool,
            tenant_id,
            range_param,
            start,
            end,
            _window=window,
            _prev_totals=prev_totals_task,
        ),
        queries.aggregate_achievements(
            pool,
            tenant_id,
            range_param,
            start,
            end,
            _window=window,
            _cur_totals=cur_totals_task,
            _prev_totals=prev_totals_task,
        ),
    )
    return {
        "highlights": highlights,
        "achievements": achievements,
    }


async def _load_dashboard_ops_trend(
    pool: Pool,
    tenant_id: int,
    range_param: str,
    start: Optional[str],
    end: Optional[str],
) -> dict[str, Any]:
    queries = get_queries_module()
    cur_start, cur_end, _, _, _, unit, _ = queries._resolve_window(range_param, start, end)
    return await queries._fetch_ops_trend(pool, tenant_id, cur_start, cur_end, unit)


if _EXPLORE_ENABLED:
    @app.get("/api/explore/tables")
    async def get_explore_tables(
        tenant_id: int = Depends(require_api_key),
        pool: Pool = Depends(db.get_pool),
    ):
        try:
            return await get_queries_module().explore_tables(pool)
        except asyncpg.PostgresError as exc:
            return postgres_error_response(exc)


    @app.get("/api/explore/sample")
    async def get_sample_table(
        table: str,
        limit: int = Query(default=5, ge=1, le=100),
        api_tenant_id: int = Depends(require_api_key),
        pool: Pool = Depends(db.get_pool),
    ):
        try:
            return await get_queries_module().sample_table(pool, table, limit, api_tenant_id)
        except ValueError as exc:
            return value_error_response(exc)
        except asyncpg.PostgresError as exc:
            return postgres_error_response(exc)


@app.get("/api/stats/overview")
async def get_stats_overview(
    days: int = Query(default=7, ge=1, le=3650),
    tenant_id: int = Depends(require_api_key),
    pool: Pool = Depends(db.get_pool),
):
    try:
        return await get_queries_module().stats_overview(pool, days, tenant_id)
    except ValueError as exc:
        return value_error_response(exc)
    except asyncpg.PostgresError as exc:
        return postgres_error_response(exc)


@app.get("/api/stats/trend")
async def get_stats_trend(
    days: int = Query(default=7, ge=1, le=3650),
    tenant_id: int = Depends(require_api_key),
    pool: Pool = Depends(db.get_pool),
):
    try:
        return await get_queries_module().stats_trend(pool, days, tenant_id)
    except ValueError as exc:
        return value_error_response(exc)
    except asyncpg.PostgresError as exc:
        return postgres_error_response(exc)


@app.get("/api/stats/credits")
async def get_stats_credits(
    days: int = Query(default=30, ge=1, le=3650),
    tenant_id: int = Depends(require_api_key),
    pool: Pool = Depends(db.get_pool),
):
    try:
        return await get_queries_module().stats_credits(pool, days, tenant_id)
    except ValueError as exc:
        return value_error_response(exc)
    except asyncpg.PostgresError as exc:
        return postgres_error_response(exc)


@app.get("/api/stats/tasks")
async def get_stats_tasks(
    tenant_id: int = Depends(require_api_key),
    pool: Pool = Depends(db.get_pool),
):
    try:
        return await get_queries_module().stats_tasks(pool, tenant_id)
    except ValueError as exc:
        return value_error_response(exc)
    except asyncpg.PostgresError as exc:
        return postgres_error_response(exc)


@app.get("/api/members")
async def api_get_members(
    tenant_id: int = Depends(require_api_key),
    pool: Pool = Depends(db.get_pool),
):
    try:
        return await get_queries_module().get_members(pool, tenant_id)
    except asyncpg.PostgresError as exc:
        return postgres_error_response(exc)


@app.get("/api/wallet")
async def api_get_wallet(
    tenant_id: int = Depends(require_api_key),
    pool: Pool = Depends(db.get_pool),
):
    try:
        return await get_queries_module().get_wallet(pool, tenant_id)
    except asyncpg.PostgresError as exc:
        return postgres_error_response(exc)


@app.get("/api/transactions")
async def api_get_transactions(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    member_id: Optional[int] = Query(default=None, ge=1),
    tx_type: Optional[str] = Query(default=None),
    start_date: Optional[date] = Query(default=None),
    end_date: Optional[date] = Query(default=None),
    keyword: Optional[str] = Query(default=None),
    tenant_id: int = Depends(require_api_key),
    pool: Pool = Depends(db.get_pool),
):
    try:
        return await get_queries_module().get_transactions(
            pool, page, page_size, tenant_id, member_id, tx_type, start_date, end_date, keyword,
        )
    except asyncpg.PostgresError as exc:
        return postgres_error_response(exc)


@app.get("/api/skills")
async def api_get_skills(
    tenant_id: int = Depends(require_api_key),
    pool: Pool = Depends(db.get_pool),
):
    try:
        return await get_queries_module().get_skills(pool, tenant_id)
    except asyncpg.PostgresError as exc:
        return postgres_error_response(exc)


@app.get("/api/accounts")
async def api_get_accounts(
    tenant_id: int = Depends(require_api_key),
    pool: Pool = Depends(db.get_pool),
):
    try:
        return await get_queries_module().get_accounts(pool, tenant_id)
    except asyncpg.PostgresError as exc:
        return postgres_error_response(exc)


@app.get("/api/accounts/{account_id}/week-summary")
async def api_get_account_week_summary(
    account_id: int,
    tenant_id: int = Depends(require_api_key),
    pool: Pool = Depends(db.get_pool),
):
    try:
        return await get_queries_module().get_account_week_summary(pool, account_id, tenant_id)
    except ValueError as exc:
        return value_error_response(exc)
    except asyncpg.PostgresError as exc:
        return postgres_error_response(exc)


@app.get("/api/tasks/{task_id}/week-summary")
async def api_get_task_week_summary(
    task_id: int,
    tenant_id: int = Depends(require_api_key),
    pool: Pool = Depends(db.get_pool),
):
    try:
        return await get_queries_module().get_task_week_summary(pool, task_id, tenant_id)
    except ValueError as exc:
        return value_error_response(exc)
    except asyncpg.PostgresError as exc:
        return postgres_error_response(exc)


class DistributeRequest(BaseModel):
    operator_id: int
    target_user_id: int
    amount: int
    remark: str = ""


@app.post("/api/credits/distribute")
@limiter.limit("60/minute")
async def api_distribute_credits(
    request: Request,
    body: DistributeRequest,
    idempotency_key: str = Header(..., alias="Idempotency-Key"),
    tenant_id: int = Depends(require_api_key),
    pool: Pool = Depends(db.get_pool),
):
    if body.amount <= 0:
        return value_error_response(ValueError("amount must be positive"))
    if body.operator_id == body.target_user_id:
        return value_error_response(ValueError("operator and target must be different users"))
    try:
        req_dict = body.model_dump()
        remark = _normalize_remark(body.remark)
        queries_module = get_queries_module()
        async with pool.acquire() as conn:
            async with conn.transaction():
                existing, body_hash = await queries_module.check_idempotency(
                    conn, tenant_id, idempotency_key, req_dict
                )
                if existing == "conflict":
                    raise HTTPException(409, "Idempotency key conflict")
                if existing:
                    return existing
                await queries_module.distribute_credits_with_conn(
                    conn, body.operator_id, body.target_user_id, body.amount, remark, tenant_id
                )
                result = {"success": True}
                await queries_module.record_idempotency(
                    conn, tenant_id, idempotency_key, request.url.path, body_hash, result
                )
        queries_module.clear_mutation_caches()
        _clear_dashboard_component_caches()
        return result
    except ValueError as exc:
        return value_error_response(exc)
    except asyncpg.PostgresError as exc:
        return postgres_error_response(exc)


class UpdateMemberRequest(BaseModel):
    name: Optional[str] = None
    phone_number: Optional[str] = None
    role: Optional[str] = None


@app.put("/api/members/{user_id}")
@limiter.limit("60/minute")
async def api_update_member(
    request: Request,
    user_id: int,
    body: UpdateMemberRequest,
    idempotency_key: str = Header(..., alias="Idempotency-Key"),
    tenant_id: int = Depends(require_api_key),
    pool: Pool = Depends(db.get_pool),
):
    try:
        req_dict = body.model_dump()
        req_dict["user_id"] = user_id
        queries_module = get_queries_module()
        async with pool.acquire() as conn:
            async with conn.transaction():
                existing, body_hash = await queries_module.check_idempotency(
                    conn, tenant_id, idempotency_key, req_dict
                )
                if existing == "conflict":
                    raise HTTPException(409, "Idempotency key conflict")
                if existing:
                    return existing
                name = _normalize_member_text(body.name, field_name="name") if body.name is not None else None
                phone_number = _normalize_member_text(body.phone_number, field_name="phone_number") if body.phone_number is not None else None
                role = _normalize_member_role(body.role) if body.role is not None else None
                if name is None and phone_number is None and role is None:
                    raise ValueError("at least one update field must be provided")
                await queries_module.update_member_with_conn(
                    conn, user_id, tenant_id, name, phone_number, role
                )
                result = {"success": True}
                await queries_module.record_idempotency(
                    conn, tenant_id, idempotency_key, request.url.path, body_hash, result
                )
        queries_module.clear_mutation_caches()
        _clear_dashboard_component_caches()
        return result
    except ValueError as exc:
        return value_error_response(exc)
    except asyncpg.PostgresError as exc:
        return postgres_error_response(exc)


@app.delete("/api/members/{user_id}")
@limiter.limit("60/minute")
async def api_delete_member(
    request: Request,
    user_id: int,
    idempotency_key: str = Header(..., alias="Idempotency-Key"),
    tenant_id: int = Depends(require_api_key),
    pool: Pool = Depends(db.get_pool),
):
    try:
        req_dict = {"user_id": user_id}
        queries_module = get_queries_module()
        async with pool.acquire() as conn:
            async with conn.transaction():
                existing, body_hash = await queries_module.check_idempotency(
                    conn, tenant_id, idempotency_key, req_dict
                )
                if existing == "conflict":
                    raise HTTPException(409, "Idempotency key conflict")
                if existing:
                    return existing
                await queries_module.delete_member_with_conn(conn, user_id, tenant_id)
                result = {"success": True}
                await queries_module.record_idempotency(
                    conn, tenant_id, idempotency_key, request.url.path, body_hash, result
                )
        queries_module.clear_mutation_caches()
        _clear_dashboard_component_caches()
        return result
    except ValueError as exc:
        return value_error_response(exc)
    except asyncpg.PostgresError as exc:
        return postgres_error_response(exc)


class AddMemberRequest(BaseModel):
    name: str
    phone_number: str
    role: Optional[str] = None
    initial_balance: int = Field(default=0, ge=0)


@app.post("/api/members")
@limiter.limit("60/minute")
async def api_add_member(
    request: Request,
    body: AddMemberRequest,
    idempotency_key: str = Header(..., alias="Idempotency-Key"),
    tenant_id: int = Depends(require_api_key),
    pool: Pool = Depends(db.get_pool),
):
    try:
        req_dict = body.model_dump()
        queries_module = get_queries_module()
        async with pool.acquire() as conn:
            async with conn.transaction():
                existing, body_hash = await queries_module.check_idempotency(
                    conn, tenant_id, idempotency_key, req_dict
                )
                if existing == "conflict":
                    raise HTTPException(409, "Idempotency key conflict")
                if existing:
                    return existing
                name = _normalize_member_text(body.name, field_name="name", required=True)
                phone_number = _normalize_member_text(body.phone_number, field_name="phone_number", required=True)
                role = _normalize_member_role(body.role) if body.role is not None else None
                new_id = await queries_module.add_member_with_conn(
                    conn, name, phone_number, role, body.initial_balance, tenant_id
                )
                result = {"id": new_id, "success": True}
                await queries_module.record_idempotency(
                    conn, tenant_id, idempotency_key, request.url.path, body_hash, result
                )
        queries_module.clear_mutation_caches()
        _clear_dashboard_component_caches()
        return result
    except ValueError as exc:
        return value_error_response(exc)
    except asyncpg.PostgresError as exc:
        return postgres_error_response(exc)


@app.get("/api/audit-log")
async def api_get_audit_log(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    member_id: Optional[int] = Query(default=None, ge=1),
    action: Optional[str] = Query(default=None),
    start_date: Optional[date] = Query(default=None),
    end_date: Optional[date] = Query(default=None),
    keyword: Optional[str] = Query(default=None),
    tenant_id: int = Depends(require_api_key),
    pool: Pool = Depends(db.get_pool),
):
    try:
        return await get_queries_module().get_audit_log(
            pool, tenant_id, page, page_size, member_id, action, start_date, end_date, keyword,
        )
    except asyncpg.PostgresError as exc:
        return postgres_error_response(exc)


# ──────────────────────────────────────────────────────────────────
# Dashboard 聚合 endpoint：前端只展示，所有桶分配在后端做
# ──────────────────────────────────────────────────────────────────


def _dashboard_handler(fn):
    async def wrapped(
        range: str = Query(default="7d"),
        start: Optional[str] = Query(default=None),
        end: Optional[str] = Query(default=None),
        tenant_id: int = Depends(require_api_key),
        pool: Pool = Depends(db.get_pool),
    ):
        try:
            return await getattr(get_queries_module(), fn)(pool, tenant_id, range, start, end)
        except ValueError as exc:
            return value_error_response(exc)
        except asyncpg.PostgresError as exc:
            return postgres_error_response(exc)
    return wrapped


@app.get("/api/dashboard/highlights")
async def api_get_dashboard_highlights(
    range: str = Query(default="7d"),
    start: Optional[str] = Query(default=None),
    end: Optional[str] = Query(default=None),
    tenant_id: int = Depends(require_api_key),
    pool: Pool = Depends(db.get_pool),
):
    try:
        cache_key = _dashboard_cache_key(tenant_id, range, start, end)
        return await _cached_dashboard_payload(
            _dashboard_highlights_cache,
            _dashboard_highlights_lock,
            cache_key,
            lambda: _load_dashboard_highlights_bundle(pool, tenant_id, range, start, end),
        )
    except ValueError as exc:
        return value_error_response(exc)
    except asyncpg.PostgresError as exc:
        return postgres_error_response(exc)


app.add_api_route(
    "/api/dashboard/achievements",
    _dashboard_handler("aggregate_achievements"),
    methods=["GET"],
)


@app.get("/api/dashboard/charts")
async def api_get_dashboard_charts(
    range: str = Query(default="7d"),
    start: Optional[str] = Query(default=None),
    end: Optional[str] = Query(default=None),
    tenant_id: int = Depends(require_api_key),
    pool: Pool = Depends(db.get_pool),
):
    try:
        cache_key = _dashboard_cache_key(tenant_id, range, start, end)
        return await _cached_dashboard_payload(
            _dashboard_charts_cache,
            _dashboard_charts_lock,
            cache_key,
            lambda: get_queries_module().aggregate_charts(pool, tenant_id, range, start, end),
        )
    except ValueError as exc:
        return value_error_response(exc)
    except asyncpg.PostgresError as exc:
        return postgres_error_response(exc)


@app.get("/api/dashboard/aggs")
async def api_get_dashboard_aggs(
    range: str = Query(default="7d"),
    start: Optional[str] = Query(default=None),
    end: Optional[str] = Query(default=None),
    tenant_id: int = Depends(require_api_key),
    pool: Pool = Depends(db.get_pool),
):
    try:
        cache_key = _dashboard_cache_key(tenant_id, range, start, end)
        return await _cached_dashboard_payload(
            _dashboard_aggs_cache,
            _dashboard_aggs_lock,
            cache_key,
            lambda: get_queries_module().aggregate_aggregations(pool, tenant_id, range, start, end),
        )
    except ValueError as exc:
        return value_error_response(exc)
    except asyncpg.PostgresError as exc:
        return postgres_error_response(exc)


@app.get("/api/dashboard/aggregations")
async def api_get_dashboard_aggregations(
    range: str = Query(default="7d"),
    start: Optional[str] = Query(default=None),
    end: Optional[str] = Query(default=None),
    tenant_id: int = Depends(require_api_key),
    pool: Pool = Depends(db.get_pool),
):
    try:
        cache_key = _dashboard_cache_key(tenant_id, range, start, end)
        return await _cached_dashboard_payload(
            _dashboard_aggs_cache,
            _dashboard_aggs_lock,
            cache_key,
            lambda: get_queries_module().aggregate_aggregations(pool, tenant_id, range, start, end),
        )
    except ValueError as exc:
        return value_error_response(exc)
    except asyncpg.PostgresError as exc:
        return postgres_error_response(exc)


@app.get("/api/dashboard/ops_trend")
async def api_get_dashboard_ops_trend(
    range: str = Query(default="7d"),
    start: Optional[str] = Query(default=None),
    end: Optional[str] = Query(default=None),
    tenant_id: int = Depends(require_api_key),
    pool: Pool = Depends(db.get_pool),
):
    try:
        cache_key = _dashboard_cache_key(tenant_id, range, start, end)
        return await _cached_dashboard_payload(
            _dashboard_ops_trend_cache,
            _dashboard_ops_trend_lock,
            cache_key,
            lambda: _load_dashboard_ops_trend(pool, tenant_id, range, start, end),
        )
    except ValueError as exc:
        return value_error_response(exc)
    except asyncpg.PostgresError as exc:
        return postgres_error_response(exc)


app.add_api_route(
    "/api/dashboard/snapshot",
    _dashboard_handler("aggregate_snapshot"),
    methods=["GET"],
)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8403)
