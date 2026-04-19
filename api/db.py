import os
from pathlib import Path
from typing import Optional

import asyncpg
from asyncpg import Connection
from asyncpg import Pool
from dotenv import load_dotenv


load_dotenv(Path(__file__).with_name(".env"))

DATABASE_URL = os.getenv("DATABASE_URL")
_pool: Optional[Pool] = None


def _env_int(name: str, default: int, minimum: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return value if value >= minimum else default


def _env_float(name: str, default: float, minimum: float) -> float:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        return default
    return value if value >= minimum else default


async def _init_connection(conn: Connection) -> None:
    schema = os.getenv("DB_SCHEMA", "public").strip() or "public"
    await conn.execute("SELECT set_config('search_path', $1, false)", schema)
    await conn.execute("SELECT set_config('TimeZone', $1, false)", "Asia/Shanghai")


async def init_pool() -> None:
    global _pool

    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL environment variable is required. Please set it in api/.env")
    if _pool is not None:
        return

    min_size = _env_int("DB_POOL_MIN_SIZE", 5, 1)
    max_size = _env_int("DB_POOL_MAX_SIZE", 25, min_size)
    command_timeout = _env_float("DB_COMMAND_TIMEOUT", 30.0, 1.0)
    statement_cache_size = _env_int("DB_STATEMENT_CACHE_SIZE", 100, 0)

    _pool = await asyncpg.create_pool(
        dsn=DATABASE_URL,
        min_size=min_size,
        max_size=max_size,
        command_timeout=command_timeout,
        statement_cache_size=statement_cache_size,
        max_inactive_connection_lifetime=300,
        init=_init_connection,
    )

    async with _pool.acquire() as conn:
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS mutation_idempotency (
              id BIGSERIAL PRIMARY KEY,
              idempotency_key VARCHAR(64) NOT NULL,
              tenant_id INT NOT NULL,
              endpoint VARCHAR(120) NOT NULL,
              request_hash VARCHAR(64) NOT NULL,
              response_json TEXT NOT NULL,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              UNIQUE (tenant_id, idempotency_key)
            );
            """
        )
        await conn.execute(
            """
            CREATE INDEX IF NOT EXISTS mutation_idempotency_created_idx
              ON mutation_idempotency (created_at);
            """
        )


async def close_pool() -> None:
    global _pool

    if _pool is None:
        return

    await _pool.close()
    _pool = None


async def get_pool() -> Pool:
    if _pool is None:
        raise RuntimeError("Database pool is not initialized")
    return _pool
