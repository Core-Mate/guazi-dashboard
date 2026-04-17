from contextlib import asynccontextmanager
import importlib
from typing import Optional

import asyncpg
import uvicorn
from asyncpg import Pool
from fastapi import Depends, FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from auth import require_api_key
import db


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_pool()
    try:
        yield
    finally:
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
    tenant_id: int = Depends(require_api_key),
    pool: Pool = Depends(db.get_pool),
):
    try:
        return await get_queries_module().get_transactions(pool, page, page_size, tenant_id)
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
        return {"success": True}
    except ValueError as exc:
        return value_error_response(exc)
    except asyncpg.PostgresError as exc:
        return postgres_error_response(exc)


class AddMemberRequest(BaseModel):
    name: str
    phone_number: str
    role: str = "member"
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
        return {"id": new_id, "success": True}
    except ValueError as exc:
        return value_error_response(exc)
    except asyncpg.PostgresError as exc:
        return postgres_error_response(exc)


@app.get("/api/audit-log")
async def api_get_audit_log(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    tenant_id: int = Depends(require_api_key),
    pool: Pool = Depends(db.get_pool),
):
    try:
        return await get_queries_module().get_audit_log(pool, tenant_id, page, page_size)
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


app.add_api_route(
    "/api/dashboard/highlights",
    _dashboard_handler("aggregate_highlights"),
    methods=["GET"],
)
app.add_api_route(
    "/api/dashboard/achievements",
    _dashboard_handler("aggregate_achievements"),
    methods=["GET"],
)
app.add_api_route(
    "/api/dashboard/aggregations",
    _dashboard_handler("aggregate_aggregations"),
    methods=["GET"],
)
app.add_api_route(
    "/api/dashboard/charts",
    _dashboard_handler("aggregate_charts"),
    methods=["GET"],
)
app.add_api_route(
    "/api/dashboard/snapshot",
    _dashboard_handler("aggregate_snapshot"),
    methods=["GET"],
)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8403)
