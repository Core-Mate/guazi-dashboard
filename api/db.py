import os
from pathlib import Path
from typing import Optional

import asyncpg
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


async def init_pool() -> None:
    global _pool

    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL environment variable is required. Please set it in api/.env")
    if _pool is not None:
        return

    min_size = _env_int("DB_POOL_MIN_SIZE", 1, 1)
    max_size = _env_int("DB_POOL_MAX_SIZE", 10, min_size)
    command_timeout = _env_float("DB_COMMAND_TIMEOUT", 30.0, 1.0)
    statement_cache_size = _env_int("DB_STATEMENT_CACHE_SIZE", 100, 0)

    _pool = await asyncpg.create_pool(
        dsn=DATABASE_URL,
        min_size=min_size,
        max_size=max_size,
        command_timeout=command_timeout,
        statement_cache_size=statement_cache_size,
        server_settings={
            "search_path": os.getenv("DB_SCHEMA", "public"),
            "TimeZone": "Asia/Shanghai",
        },
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
