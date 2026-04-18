import asyncio
from collections import OrderedDict
from contextlib import asynccontextmanager, suppress
from datetime import date
import importlib
import logging
import os
import time
from typing import Any, Awaitable, Callable, Optional

import asyncpg
import uvicorn
from asyncpg import Pool
from fastapi import Depends, FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

import auth
from auth import require_api_key
import db

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

    configured_tenants = sorted(set(auth.API_KEYS.values()))
    if configured_tenants:
        return configured_tenants

    fallback_tenant = os.getenv("TENANT_ID", "1").strip()
    try:
        return [int(fallback_tenant)]
    except ValueError:
        logger.warning("Invalid TENANT_ID for warmup: %s; falling back to tenant_id=1", fallback_tenant)
        return [1]

async def _refill_hot_caches() -> None:
    started_at = time.perf_counter()
    pool = await db.get_pool()
    queries = get_queries_module()
    tenants = _get_warmup_tenant_ids()
    ranges = WARMUP_RANGES
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
            results = await asyncio.gather(
                *(warmer() for _, warmer in warmers),
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
                    "Dashboard warmup completed for tenant_id=%s range=%s",
                    tenant_id,
                    range_value,
                )
    elapsed = time.perf_counter() - started_at
    print(f"[hot-cache-tick] refilled {len(ranges)} ranges × {len(tenants)} tenants in {elapsed:.1f}s")


async def _hot_cache_tick_loop(interval_seconds: int = 60):
    while True:
        try:
            await _refill_hot_caches()
        except Exception as e:
            print(f"[hot-cache-tick] refill failed: {e}")
        await asyncio.sleep(interval_seconds)


async def _warmup() -> None:
    try:
        await _refill_hot_caches()
    except Exception:
        logger.exception("Dashboard snapshot warmup initialization failed")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_pool()
    warmup_task = asyncio.create_task(_warmup())
    tick_task = asyncio.create_task(_hot_cache_tick_loop(60))
    try:
        yield
    finally:
        tick_task.cancel()
        warmup_task.cancel()
        with suppress(asyncio.CancelledError):
            await warmup_task
        await db.close_pool()


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def postgres_error_response(exc: asyncpg.PostgresError) -> JSONResponse:
    return JSONResponse(status_code=503, content={"error": str(exc)})


def value_error_response(exc: ValueError) -> JSONResponse:
    return JSONResponse(status_code=400, content={"error": str(exc)})


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
    _, _, prev_start, prev_end, _, _, _ = window
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
async def api_distribute_credits(
    body: DistributeRequest,
    tenant_id: int = Depends(require_api_key),
    pool: Pool = Depends(db.get_pool),
):
    if body.amount <= 0:
        return value_error_response(ValueError("amount must be positive"))
    try:
        await get_queries_module().distribute_credits(
            pool, body.operator_id, body.target_user_id, body.amount, body.remark, tenant_id
        )
        _clear_dashboard_component_caches()
        return {"success": True}
    except ValueError as exc:
        return value_error_response(exc)
    except asyncpg.PostgresError as exc:
        return postgres_error_response(exc)


class UpdateMemberRequest(BaseModel):
    name: Optional[str] = None
    phone_number: Optional[str] = None
    role: Optional[str] = None


@app.put("/api/members/{user_id}")
async def api_update_member(
    user_id: int,
    body: UpdateMemberRequest,
    tenant_id: int = Depends(require_api_key),
    pool: Pool = Depends(db.get_pool),
):
    try:
        await get_queries_module().update_member(
            pool, user_id, tenant_id, body.name, body.phone_number, body.role
        )
        _clear_dashboard_component_caches()
        return {"success": True}
    except ValueError as exc:
        return value_error_response(exc)
    except asyncpg.PostgresError as exc:
        return postgres_error_response(exc)


@app.delete("/api/members/{user_id}")
async def api_delete_member(
    user_id: int,
    tenant_id: int = Depends(require_api_key),
    pool: Pool = Depends(db.get_pool),
):
    try:
        await get_queries_module().delete_member(pool, user_id, tenant_id)
        _clear_dashboard_component_caches()
        return {"success": True}
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
async def api_add_member(
    body: AddMemberRequest,
    tenant_id: int = Depends(require_api_key),
    pool: Pool = Depends(db.get_pool),
):
    try:
        new_id = await get_queries_module().add_member(
            pool, body.name, body.phone_number, body.role, body.initial_balance, tenant_id
        )
        _clear_dashboard_component_caches()
        return {"id": new_id, "success": True}
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
