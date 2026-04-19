import hmac
import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import HTTPException, Request

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

logger = logging.getLogger(__name__)
API_KEYS = {}

def _load_keys():
    API_KEYS.clear()
    raw = os.getenv("DASHBOARD_API_KEYS", "").strip()
    dev_key = os.getenv("API_KEY", "").strip()
    if not raw and not dev_key:
        raise RuntimeError("No API key configured. Set DASHBOARD_API_KEYS or API_KEY env var.")
    if raw:
        for entry in raw.split(","):
            entry = entry.strip()
            if ":" in entry:
                key, tid = entry.rsplit(":", 1)
                key = key.strip()
                if not key:
                    continue
                try:
                    API_KEYS[key] = int(tid.strip())
                except ValueError:
                    pass
    if dev_key:
        API_KEYS[dev_key] = int(os.getenv("TENANT_ID", "1").strip())
    if not API_KEYS:
        raise RuntimeError("No API key configured. Set DASHBOARD_API_KEYS or API_KEY env var.")

_load_keys()

OPEN_PATHS = frozenset()


def _resolve_tenant_id(api_key: str):
    for candidate_key, tenant_id in API_KEYS.items():
        if hmac.compare_digest(api_key, candidate_key):
            return tenant_id
    return None


def resolve_tenant_id(api_key: str):
    return _resolve_tenant_id(api_key)


async def require_api_key(request: Request) -> int:
    if request.url.path in OPEN_PATHS:
        request.state.tenant_id = 1
        return 1

    api_key = request.headers.get("X-API-Key", "").strip()
    if not api_key:
        logger.error(
            "HTTPException path=%s api_key_present=%s tenant_id=%s detail=%s",
            request.url.path,
            False,
            None,
            "Missing X-API-Key header",
        )
        raise HTTPException(status_code=401, detail="Missing X-API-Key header")

    tenant_id = _resolve_tenant_id(api_key)
    if tenant_id is None:
        logger.error(
            "HTTPException path=%s api_key_present=%s tenant_id=%s detail=%s",
            request.url.path,
            True,
            None,
            "Invalid API key",
        )
        raise HTTPException(status_code=401, detail="Invalid API key")

    request.state.tenant_id = tenant_id
    return tenant_id


verify_api_key = require_api_key
