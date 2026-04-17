import os
from pathlib import Path
from typing import Optional

import asyncpg
from asyncpg import Pool
from dotenv import load_dotenv


load_dotenv(Path(__file__).with_name(".env"))

DATABASE_URL = os.getenv("DATABASE_URL")
_pool: Optional[Pool] = None


async def init_pool() -> None:
    global _pool

    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL environment variable is required. Please set it in api/.env")
    if _pool is not None:
        return

    _pool = await asyncpg.create_pool(
        dsn=DATABASE_URL,
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
