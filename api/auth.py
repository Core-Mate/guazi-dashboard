import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Request, HTTPException

load_dotenv(Path(__file__).with_name(".env"))

logger = logging.getLogger(__name__)
API_KEYS = {}

def _load_keys():
    raw = os.getenv("DASHBOARD_API_KEYS", "")
    if raw:
        for entry in raw.split(","):
            entry = entry.strip()
            if ":" in entry:
                key, tid = entry.rsplit(":", 1)
                try:
                    API_KEYS[key.strip()] = int(tid.strip())
                except ValueError:
                    pass
    dev_tenant_str = os.getenv("TENANT_ID")
    if not dev_tenant_str:
        raise RuntimeError("TENANT_ID environment variable is required. Please set it in api/.env")
    dev_tenant = int(dev_tenant_str)
    dev_key = os.getenv("API_KEY", "dev-key-guazi-2026")
    API_KEYS[dev_key] = dev_tenant

_load_keys()

OPEN_PATHS = frozenset()


async def require_api_key(request: Request) -> int:
    if request.url.path in OPEN_PATHS:
        return 1

    api_key = request.headers.get("X-API-Key", "")
    if not api_key:
        logger.error(
            "HTTPException path=%s api_key_prefix=%s tenant_id=%s detail=%s",
            request.url.path,
            api_key[:8],
            None,
            "Missing X-API-Key header",
        )
        raise HTTPException(status_code=401, detail="Missing X-API-Key header")

    tenant_id = API_KEYS.get(api_key)
    if tenant_id is None:
        logger.error(
            "HTTPException path=%s api_key_prefix=%s tenant_id=%s detail=%s",
            request.url.path,
            api_key[:8],
            None,
            "Invalid API key",
        )
        raise HTTPException(status_code=401, detail="Invalid API key")

    return tenant_id
