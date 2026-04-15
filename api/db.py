import os
from pathlib import Path

import asyncpg
from asyncpg import Pool
from dotenv import load_dotenv


load_dotenv(Path(__file__).with_name(".env"))

DATABASE_URL = os.getenv("DATABASE_URL")
_pool: Pool | None = None


async def init_pool() -> None:
    global _pool

    if _pool is not None:
        return
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not set")

    _pool = await asyncpg.create_pool(dsn=DATABASE_URL)


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
