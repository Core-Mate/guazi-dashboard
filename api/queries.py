from __future__ import annotations

import asyncio
import json
import sys
import time
from collections import OrderedDict, defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from asyncpg import Pool

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

TENANT_SCOPED_TABLES = {
    "users", "credit_flow", "task_execution", "task_draft",
    "skill", "execution_behavior_stat",
}

try:
    from copywriting import generate_achievement
except ImportError:  # pragma: no cover
    def generate_achievement(*args, **kwargs):
        return None


CN_TZ = timezone(timedelta(hours=8))
_snapshot_cache = TTLCache(maxsize=200, ttl=90)
_cache_lock = asyncio.Lock()
_tx_cache = TTLCache(maxsize=500, ttl=60)
_tx_cache_lock = asyncio.Lock()
_oplog_cache = TTLCache(maxsize=500, ttl=60)
_oplog_cache_lock = asyncio.Lock()
_CACHE_MISS = object()

# CANONICAL SUCCESS FILTER: execution_result = 'SUCCEED' — change only here
def _success_filter_sql(alias: str = "te") -> str:
    return f"{alias}.execution_result = 'SUCCEED'"


# DB enum platformtype 实际值:
# XIAOHONGSHU, DOUYIN, KUAISHOU, WECHAT, LARK, ZOOM,
# LINKEDIN, INSTAGRAM, TIKTOK, X, REDDIT, PINTEREST, GENERAL_APP
PLATFORM_META = {
    "XIAOHONGSHU": {"name": "小红书", "color": "#ff2741"},
    "DOUYIN": {"name": "抖音", "color": "#000000"},
    "KUAISHOU": {"name": "快手", "color": "#ff5500"},
    "WECHAT": {"name": "微信", "color": "#07c160"},
    "LARK": {"name": "飞书", "color": "#3370ff"},
    "ZOOM": {"name": "Zoom", "color": "#2d8cff"},
    "LINKEDIN": {"name": "LinkedIn", "color": "#0a66c2"},
    "INSTAGRAM": {"name": "Instagram", "color": "#e4405f"},
    "TIKTOK": {"name": "TikTok", "color": "#000000"},
    "X": {"name": "X", "color": "#1da1f2"},
    "REDDIT": {"name": "Reddit", "color": "#ff4500"},
    "PINTEREST": {"name": "Pinterest", "color": "#e60023"},
    "GENERAL_APP": {"name": "其他", "color": "#94a3b8"},
}

INTERACTION_META = [
    ("comments", "评论", "#2563eb"),
    ("likes", "点赞", "#3b82f6"),
    ("saves", "收藏", "#60a5fa"),
    ("dms", "私信", "#93c5fd"),
]

TASK_GROUP_META = {
    "acquire": {"label": "🎯 获客触达", "emoji": "🎯", "color": "#ff6900"},
    "ops": {"label": "🛠️ 运营协作", "emoji": "🛠️", "color": "#2196f3"},
}

TASK_GROUP_LABEL = {
    "acquire": "获客触达",
    "ops": "运营协作",
}


def _resolve_window(
    range_param: str,
    start: Optional[str],
    end: Optional[str],
) -> tuple[datetime, datetime, datetime, datetime, str, str, int]:
    """Return (cur_start, cur_end, prev_start, prev_end, compare_label, bucket_unit, bucket_count)."""
    now = datetime.now(CN_TZ)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    if range_param == "today":
        cur_start = today_start
        cur_end = now
        prev_start = today_start - timedelta(days=1)
        prev_end = today_start
        return (cur_start, cur_end, prev_start, prev_end, "较昨日", "hour", 24)

    if range_param == "yesterday":
        local_today = datetime.now().astimezone().date()
        yesterday_date = local_today - timedelta(days=1)
        cur_start = datetime(
            yesterday_date.year,
            yesterday_date.month,
            yesterday_date.day,
            tzinfo=CN_TZ,
        )
        cur_end = cur_start + timedelta(days=1)
        prev_start = cur_start - timedelta(days=1)
        prev_end = cur_start
        return (cur_start, cur_end, prev_start, prev_end, "较前日", "hour", 24)

    if range_param == "7d":
        cur_start = today_start - timedelta(days=6)
        cur_end = now
        prev_start = cur_start - timedelta(days=7)
        prev_end = cur_start
        return (cur_start, cur_end, prev_start, prev_end, "较上周", "day", 7)

    if range_param == "30d":
        cur_start = today_start - timedelta(days=29)
        cur_end = now
        prev_start = cur_start - timedelta(days=30)
        prev_end = cur_start
        return (cur_start, cur_end, prev_start, prev_end, "较上月", "day", 30)

    if range_param == "custom":
        if not start or not end:
            raise ValueError("custom range requires start and end")
        cur_start = datetime.fromisoformat(start)
        cur_end = datetime.fromisoformat(end)
        start_is_date_only = "T" not in start and ":" not in start
        end_is_date_only = "T" not in end and ":" not in end
        if cur_start.tzinfo is None:
            cur_start = cur_start.replace(tzinfo=CN_TZ)
        if cur_end.tzinfo is None:
            cur_end = cur_end.replace(tzinfo=CN_TZ)
        start_date = cur_start.date()
        end_date = cur_end.date()
        if end_is_date_only:
            cur_end = cur_end + timedelta(days=1)
        length = cur_end - cur_start
        prev_end = cur_start
        prev_start = cur_start - length
        days_diff = (end_date - start_date).days
        if start_is_date_only and end_is_date_only and days_diff == 0:
            return (cur_start, cur_end, prev_start, prev_end, "较前期", "hour", 24)
        return (cur_start, cur_end, prev_start, prev_end, "较前期", "day", days_diff + 1)

    raise ValueError(f"unknown range: {range_param}")


def _bucket_label(dt: datetime, unit: str) -> str:
    if unit == "hour":
        return f"{dt.hour:02d}:00"
    return f"{dt.month:02d}/{dt.day:02d}"


async def _resolve_async_value(value: Any) -> Any:
    if hasattr(value, "__await__"):
        return await value
    return value


async def _fetch_metric_buckets(
    pool: Pool,
    tenant_id: int,
    cur_start: datetime,
    cur_end: datetime,
    unit: str,
) -> list[dict[str, Any]]:
    """返回每个时间桶的聚合：comments/likes/saves/dms/reach + executions/successes/credits."""
    if unit == "hour":
        trunc = "hour"
        step = "1 hour"
    else:
        trunc = "day"
        step = "1 day"

    rows = await pool.fetch(
        f"""
        WITH series AS (
            SELECT generate_series(
                DATE_TRUNC('{trunc}', $2::timestamptz AT TIME ZONE 'Asia/Shanghai'),
                DATE_TRUNC('{trunc}', (($3::timestamptz AT TIME ZONE 'Asia/Shanghai') - INTERVAL '1 microsecond')),
                INTERVAL '{step}'
            ) AS bucket
        ),
        ebs_per_te AS (
            SELECT
                execution_id,
                SUM(comment_count) AS comment_count,
                SUM(like_count) AS like_count,
                SUM(collect_count) AS collect_count,
                SUM(dm_count) AS dm_count,
                SUM(unique_reach) AS unique_reach
            FROM execution_behavior_stat
            GROUP BY execution_id
        ),
        te_agg AS (
            SELECT
                DATE_TRUNC('{trunc}', COALESCE(te.finished_at, te.started_at) AT TIME ZONE 'Asia/Shanghai') AS bucket,
                COUNT(*)::bigint AS executions,
                COUNT(*) FILTER (WHERE {_success_filter_sql('te')})::bigint AS successes,
                COALESCE(SUM(ebs.comment_count), 0)::bigint AS comments,
                COALESCE(SUM(ebs.like_count), 0)::bigint AS likes,
                COALESCE(SUM(ebs.collect_count), 0)::bigint AS saves,
                COALESCE(SUM(ebs.dm_count), 0)::bigint AS dms,
                COALESCE(SUM(ebs.unique_reach), 0)::bigint AS reach
            FROM task_execution te
            LEFT JOIN ebs_per_te ebs ON ebs.execution_id = te.id
            JOIN users u ON u.id = te.user_id
            WHERE u.tenant_id = $1
              AND COALESCE(te.finished_at, te.started_at) >= $2
              AND COALESCE(te.finished_at, te.started_at) < $3
              AND NOT te.is_deleted
              AND NOT u.is_deleted
            GROUP BY DATE_TRUNC('{trunc}', COALESCE(te.finished_at, te.started_at) AT TIME ZONE 'Asia/Shanghai')
        )
        SELECT s.bucket,
               COALESCE(te_agg.executions, 0)::bigint AS executions,
               COALESCE(te_agg.successes, 0)::bigint AS successes,
               COALESCE(te_agg.comments, 0)::bigint AS comments,
               COALESCE(te_agg.likes, 0)::bigint AS likes,
               COALESCE(te_agg.saves, 0)::bigint AS saves,
               COALESCE(te_agg.dms, 0)::bigint AS dms,
               COALESCE(te_agg.reach, 0)::bigint AS reach
        FROM series s
        LEFT JOIN te_agg ON te_agg.bucket = s.bucket
        ORDER BY s.bucket
        """,
        tenant_id,
        cur_start,
        cur_end,
    )
    return [dict(r) for r in rows]


async def _fetch_period_totals(
    pool: Pool,
    tenant_id: int,
    start: datetime,
    end: datetime,
) -> dict[str, int]:
    """单段窗口总和（用于环比 prev 段）。"""
    row = await pool.fetchrow(
        f"""
        WITH ebs_per_te AS (
            SELECT
                execution_id,
                SUM(comment_count) AS comment_count,
                SUM(like_count) AS like_count,
                SUM(collect_count) AS collect_count,
                SUM(dm_count) AS dm_count,
                SUM(unique_reach) AS unique_reach
            FROM execution_behavior_stat
            GROUP BY execution_id
        ),
        te_agg AS (
            SELECT
                COUNT(*)::bigint AS executions,
                COUNT(*) FILTER (WHERE {_success_filter_sql('te')})::bigint AS successes,
                COALESCE(SUM(ebs.comment_count), 0)::bigint AS comments,
                COALESCE(SUM(ebs.like_count), 0)::bigint AS likes,
                COALESCE(SUM(ebs.collect_count), 0)::bigint AS saves,
                COALESCE(SUM(ebs.dm_count), 0)::bigint AS dms,
                COALESCE(SUM(ebs.unique_reach), 0)::bigint AS reach
            FROM task_execution te
            LEFT JOIN ebs_per_te ebs ON ebs.execution_id = te.id
            JOIN users u ON u.id = te.user_id
            WHERE u.tenant_id = $1
              AND COALESCE(te.finished_at, te.started_at) >= $2
              AND COALESCE(te.finished_at, te.started_at) < $3
              AND NOT te.is_deleted
              AND NOT u.is_deleted
        )
        SELECT executions, successes, comments, likes, saves, dms, reach
        FROM te_agg
        """,
        tenant_id,
        start,
        end,
    )
    return dict(row) if row else {
        "executions": 0, "successes": 0,
        "comments": 0, "likes": 0, "saves": 0, "dms": 0, "reach": 0,
    }


async def _fetch_period_credits(
    pool: Pool,
    tenant_id: int,
    start: datetime,
    end: datetime,
) -> int:
    val = await pool.fetchval(
        """
        SELECT COALESCE(SUM(ABS(cf.change_amount)), 0)::bigint
        FROM credit_flow cf
        JOIN users u ON u.id = cf.user_id
        WHERE u.tenant_id = $1
          AND cf.change_type = 'CONSUME'
          AND cf.created_at >= $2
          AND cf.created_at < $3
          AND NOT u.is_deleted
        """,
        tenant_id,
        start,
        end,
    )
    return int(val or 0)


async def _fetch_ops_trend(
    pool: Pool,
    tenant_id: int,
    cur_start: datetime,
    cur_end: datetime,
    unit: str,
) -> dict[str, list[Any]]:
    if unit == "hour":
        trunc = "hour"
        step = "1 hour"
    else:
        trunc = "day"
        step = "1 day"

    rows = await pool.fetch(
        f"""
        WITH series AS (
            SELECT generate_series(
                DATE_TRUNC('{trunc}', $2::timestamptz AT TIME ZONE 'Asia/Shanghai'),
                DATE_TRUNC('{trunc}', (($3::timestamptz AT TIME ZONE 'Asia/Shanghai') - INTERVAL '1 microsecond')),
                INTERVAL '{step}'
            ) AS bucket
        ),
        ebs_per_te AS (
            SELECT
                execution_id,
                SUM(comment_count) AS comment_count,
                SUM(like_count) AS like_count,
                SUM(collect_count) AS collect_count,
                SUM(dm_count) AS dm_count,
                SUM(unique_reach) AS unique_reach
            FROM execution_behavior_stat
            GROUP BY execution_id
        ),
        te_agg AS (
            SELECT
                DATE_TRUNC('{trunc}', COALESCE(te.finished_at, te.started_at) AT TIME ZONE 'Asia/Shanghai') AS bucket,
                COUNT(*) FILTER (WHERE {_success_filter_sql('te')})::bigint AS success,
                COUNT(*) FILTER (WHERE te.execution_result = 'FAILED')::bigint AS failed,
                COUNT(*)::bigint AS total,
                COALESCE(SUM(ebs.comment_count), 0)::bigint AS comments,
                COALESCE(SUM(ebs.like_count), 0)::bigint AS likes,
                COALESCE(SUM(ebs.collect_count), 0)::bigint AS saves,
                COALESCE(SUM(ebs.dm_count), 0)::bigint AS dms,
                COALESCE(SUM(ebs.unique_reach), 0)::bigint AS reach,
                COALESCE(SUM(EXTRACT(EPOCH FROM (te.finished_at - te.started_at))), 0)::float / 3600.0 AS runtime_h
            FROM task_execution te
            LEFT JOIN ebs_per_te ebs ON ebs.execution_id = te.id
            JOIN users u ON u.id = te.user_id
            WHERE u.tenant_id = $1
              AND COALESCE(te.finished_at, te.started_at) >= $2
              AND COALESCE(te.finished_at, te.started_at) < $3
              AND NOT te.is_deleted
              AND NOT u.is_deleted
            GROUP BY DATE_TRUNC('{trunc}', COALESCE(te.finished_at, te.started_at) AT TIME ZONE 'Asia/Shanghai')
        ),
        ur_agg AS (
            SELECT
                DATE_TRUNC('{trunc}', COALESCE(ur.end_time, ur.start_time, ur.created_at) AT TIME ZONE 'Asia/Shanghai') AS bucket,
                COALESCE(SUM(ur.credits_used), 0)::bigint AS credits
            FROM usage_record ur
            JOIN users u ON u.id = ur.user_id
            WHERE u.tenant_id = $1
              AND COALESCE(ur.end_time, ur.start_time, ur.created_at) >= $2
              AND COALESCE(ur.end_time, ur.start_time, ur.created_at) < $3
              AND NOT u.is_deleted
            GROUP BY DATE_TRUNC('{trunc}', COALESCE(ur.end_time, ur.start_time, ur.created_at) AT TIME ZONE 'Asia/Shanghai')
        )
        SELECT
            series.bucket,
            COALESCE(te_agg.success, 0)::bigint AS success,
            COALESCE(te_agg.failed, 0)::bigint AS failed,
            COALESCE(te_agg.total, 0)::bigint AS total,
            COALESCE(te_agg.comments, 0)::bigint AS comments,
            COALESCE(te_agg.likes, 0)::bigint AS likes,
            COALESCE(te_agg.saves, 0)::bigint AS saves,
            COALESCE(te_agg.dms, 0)::bigint AS dms,
            COALESCE(te_agg.reach, 0)::bigint AS reach,
            COALESCE(ur_agg.credits, 0)::bigint AS credits,
            COALESCE(te_agg.runtime_h, 0)::float AS runtime_h
        FROM series
        LEFT JOIN te_agg USING (bucket)
        LEFT JOIN ur_agg USING (bucket)
        ORDER BY series.bucket
        """,
        tenant_id,
        cur_start,
        cur_end,
    )

    labels = [_bucket_label(r["bucket"], unit) for r in rows]
    if unit == "hour":
        dates = [
            (r["bucket"].astimezone(CN_TZ) if getattr(r["bucket"], "tzinfo", None) else r["bucket"]).strftime("%Y-%m-%dT%H:%M:%S")
            for r in rows
        ]
    else:
        dates = [
            (r["bucket"].astimezone(CN_TZ) if getattr(r["bucket"], "tzinfo", None) else r["bucket"]).strftime("%Y-%m-%d")
            for r in rows
        ]

    credits = [int(r["credits"]) for r in rows]
    return {
        "labels": labels,
        "dates": dates,
        "exec": [int(r["total"]) for r in rows],
        "success": [int(r["success"]) for r in rows],
        "failed": [int(r["failed"]) for r in rows],
        "total": [int(r["total"]) for r in rows],
        "credits": credits,
        "reach": [int(r["reach"]) for r in rows],
        "comments": [int(r["comments"]) for r in rows],
        "likes": [int(r["likes"]) for r in rows],
        "saves": [int(r["saves"]) for r in rows],
        "dms": [int(r["dms"]) for r in rows],
        "runtime_h": [round(float(r["runtime_h"] or 0), 1) for r in rows],
    }


def _series_stats(values: list[int]) -> dict[str, int]:
    if not values:
        return {"avg": 0, "peak": 0}
    total = sum(values)
    avg = round(total / len(values))
    peak = max(values)
    return {"avg": avg, "peak": peak}


def _label_for_granularity(granularity: str) -> dict[str, str]:
    return {
        "avg_label": "小时均" if granularity == "hour" else "日均",
        "peak_label": "峰值",
    }


def _change_pct(cur: int, prev: int) -> int:
    if prev <= 0:
        return 0
    return round((cur - prev) / prev * 100)


# ────────────────────────────────────────────────────────────────
# 1. /api/dashboard/highlights
# ────────────────────────────────────────────────────────────────

CARD_DEFS = [
    {"key": "successCount", "label": "完成", "unit": ""},
    {"key": "comments", "label": "评论数", "unit": ""},
    {"key": "likes", "label": "点赞数", "unit": ""},
    {"key": "saves", "label": "收藏数", "unit": ""},
    {"key": "dms", "label": "私信数", "unit": ""},
    {"key": "reach", "label": "触达量", "unit": ""},
]


async def aggregate_highlights(
    pool: Pool,
    tenant_id: int,
    range_param: str,
    start: Optional[str] = None,
    end: Optional[str] = None,
    _window: Optional[tuple[datetime, datetime, datetime, datetime, str, str, int]] = None,
    _prev_totals: Any = None,
) -> dict[str, Any]:
    cur_start, cur_end, prev_start, prev_end, compare_label, granularity, _ = _window or _resolve_window(range_param, start, end)

    bucket_rows, prev_totals = await asyncio.gather(
        _fetch_metric_buckets(pool, tenant_id, cur_start, cur_end, granularity),
        _resolve_async_value(
            _prev_totals
            if _prev_totals is not None
            else _fetch_period_totals(pool, tenant_id, prev_start, prev_end)
        ),
    )

    labels = [_bucket_label(r["bucket"], granularity) for r in bucket_rows]
    bucket_key_map = {"successCount": "successes"}
    stats_labels = _label_for_granularity(granularity)

    cards = []
    for d in CARD_DEFS:
        key = d["key"]
        bucket_key = bucket_key_map.get(key, key)
        values = [int(r[bucket_key]) for r in bucket_rows]
        cur_total = sum(values)
        prev_val = int(prev_totals.get(bucket_key, 0))
        cards.append({
            "key": key,
            "label": d["label"],
            "value": cur_total,
            "prev": prev_val,
            "change_pct": _change_pct(cur_total, prev_val),
            "unit": d["unit"],
            "series": {"labels": labels, "values": values},
            "stats": {**_series_stats(values), **stats_labels},
        })

    return {
        "range": range_param,
        "compare_label": compare_label,
        "cards": cards,
    }


# ────────────────────────────────────────────────────────────────
# 2. /api/dashboard/achievements
# ────────────────────────────────────────────────────────────────

ACHIEVEMENT_METRICS = ["comments", "likes", "saves", "dms", "reach"]
ACHIEVEMENT_SOURCE_KEYS = {
    "comments": "comments",
    "likes": "likes",
    "saves": "saves",
    "dms": "dms",
    "reach": "reach",
    "successCount": "successes",
}


async def aggregate_achievements(
    pool: Pool,
    tenant_id: int,
    range_param: str,
    start: Optional[str] = None,
    end: Optional[str] = None,
    _window: Optional[tuple[datetime, datetime, datetime, datetime, str, str, int]] = None,
    _cur_totals: Any = None,
    _prev_totals: Any = None,
) -> dict[str, Any]:
    cur_start, cur_end, prev_start, prev_end, compare_label, unit, _ = _window or _resolve_window(range_param, start, end)

    bucket_rows, prev_totals = await asyncio.gather(
        _fetch_metric_buckets(pool, tenant_id, cur_start, cur_end, unit),
        _resolve_async_value(
            _prev_totals
            if _prev_totals is not None
            else _fetch_period_totals(pool, tenant_id, prev_start, prev_end)
        ),
    )
    cur_totals = {
        source_key: sum(int(r[source_key]) for r in bucket_rows)
        for source_key in set(ACHIEVEMENT_SOURCE_KEYS.values())
    }

    achievements: list[dict[str, Any]] = []

    def _maybe(metric, cur_val, prev_val):
        return generate_achievement(metric, cur_val, prev_val, compare_label)

    def _achievement_sort_key(item: dict[str, Any]) -> int:
        cur_val = int(item.get("current", 0) or 0)
        prev_val = int(item.get("prev", 0) or 0)
        if prev_val == 0 and cur_val > 0:
            return sys.maxsize + cur_val
        return int(item.get("change_pct", 0) or 0)

    for metric in ACHIEVEMENT_METRICS:
        source_key = ACHIEVEMENT_SOURCE_KEYS[metric]
        item = _maybe(metric, int(cur_totals.get(source_key, 0)), int(prev_totals.get(source_key, 0)))
        if item:
            achievements.append(item)

    success_key = ACHIEVEMENT_SOURCE_KEYS["successCount"]
    item = _maybe("successCount", int(cur_totals.get(success_key, 0)), int(prev_totals.get(success_key, 0)))
    if item:
        achievements.append(item)

    # 按 change_pct 降序，最多 5 个
    achievements.sort(key=_achievement_sort_key, reverse=True)
    return {
        "range": range_param,
        "compare_label": compare_label,
        "achievements": achievements[:5],
    }


# ────────────────────────────────────────────────────────────────
# 3. /api/dashboard/aggregations
# ────────────────────────────────────────────────────────────────

async def aggregate_aggregations(
    pool: Pool,
    tenant_id: int,
    range_param: str,
    start: Optional[str] = None,
    end: Optional[str] = None,
    _window: Optional[tuple[datetime, datetime, datetime, datetime, str, str, int]] = None,
) -> dict[str, Any]:
    cur_start, cur_end, _, _, _, _, _ = _window or _resolve_window(range_param, start, end)

    account_rows, skill_rows, device_rows, heat_rows = await asyncio.gather(
        pool.fetch(
            f"""
            WITH account_te_agg AS (
                SELECT
                    te.user_id,
                    MAX(te.device_id) AS device_id,
                    COUNT(te.id)::bigint AS exec_count,
                    COUNT(te.id) FILTER (WHERE {_success_filter_sql('te')})::bigint AS success_count,
                    COALESCE(SUM(EXTRACT(EPOCH FROM (te.finished_at - te.started_at))), 0)::float AS duration_sec,
                    COALESCE(SUM(ebs.comment_count), 0)::bigint AS comments,
                    COALESCE(SUM(ebs.like_count), 0)::bigint AS likes,
                    COALESCE(SUM(ebs.collect_count), 0)::bigint AS saves,
                    COALESCE(SUM(ebs.dm_count), 0)::bigint AS dms,
                    COALESCE(SUM(ebs.unique_reach), 0)::bigint AS reach
                FROM task_execution te
                LEFT JOIN execution_behavior_stat ebs ON ebs.execution_id = te.id
                JOIN users u ON u.id = te.user_id
                WHERE u.tenant_id = $1
                  AND COALESCE(te.finished_at, te.started_at) >= $2
                  AND COALESCE(te.finished_at, te.started_at) < $3
                  AND NOT te.is_deleted
                  AND NOT u.is_deleted
                GROUP BY te.user_id
            ),
            account_credit_agg AS (
                SELECT
                    te.user_id,
                    COALESCE(SUM(ur.credits_used), 0)::bigint AS total_credits
                FROM task_execution te
                JOIN users u ON u.id = te.user_id
                LEFT JOIN usage_record ur
                    -- schema mismatch: usage_record.task_id is varchar while task_execution.id is int; a future migration should align these column types.
                    ON ur.task_id = te.id::varchar
                WHERE u.tenant_id = $1
                  AND COALESCE(te.finished_at, te.started_at) >= $2
                  AND COALESCE(te.finished_at, te.started_at) < $3
                  AND NOT te.is_deleted
                  AND NOT u.is_deleted
                GROUP BY te.user_id
            )
            SELECT
                u.id AS user_id,
                u.name AS username,
                u.role,
                account_te_agg.device_id,
                COALESCE(account_te_agg.exec_count, 0)::bigint AS exec_count,
                COALESCE(account_te_agg.success_count, 0)::bigint AS success_count,
                COALESCE(account_te_agg.duration_sec, 0)::float AS duration_sec,
                COALESCE(account_te_agg.comments, 0)::bigint AS comments,
                COALESCE(account_te_agg.likes, 0)::bigint AS likes,
                COALESCE(account_te_agg.saves, 0)::bigint AS saves,
                COALESCE(account_te_agg.dms, 0)::bigint AS dms,
                COALESCE(account_te_agg.reach, 0)::bigint AS reach,
                COALESCE(account_credit_agg.total_credits, 0)::bigint AS total_credits
            FROM users u
            LEFT JOIN account_te_agg ON account_te_agg.user_id = u.id
            LEFT JOIN account_credit_agg ON account_credit_agg.user_id = u.id
            WHERE u.tenant_id = $1
              AND NOT u.is_deleted
            ORDER BY COALESCE(account_te_agg.exec_count, 0) DESC, u.id
            """,
            tenant_id, cur_start, cur_end,
        ),
        pool.fetch(
            f"""
            WITH skill_te_agg AS (
                SELECT
                    te.task_id AS skill_id,
                    COUNT(te.id)::bigint AS exec_count,
                    COUNT(te.id) FILTER (WHERE {_success_filter_sql('te')})::bigint AS success_count,
                    COUNT(te.id) FILTER (WHERE te.execution_result = 'FAILED')::bigint AS fail_count,
                    COALESCE(SUM(EXTRACT(EPOCH FROM (te.finished_at - te.started_at))), 0)::float AS duration_sec,
                    COALESCE(SUM(ebs.comment_count), 0)::bigint AS comments,
                    COALESCE(SUM(ebs.like_count), 0)::bigint AS likes,
                    COALESCE(SUM(ebs.collect_count), 0)::bigint AS saves,
                    COALESCE(SUM(ebs.dm_count), 0)::bigint AS dms,
                    COALESCE(SUM(ebs.unique_reach), 0)::bigint AS reach
                FROM task_execution te
                LEFT JOIN execution_behavior_stat ebs ON ebs.execution_id = te.id
                JOIN users u ON u.id = te.user_id
                WHERE u.tenant_id = $1
                  AND te.task_id IS NOT NULL
                  AND COALESCE(te.finished_at, te.started_at) >= $2
                  AND COALESCE(te.finished_at, te.started_at) < $3
                  AND NOT te.is_deleted
                  AND NOT u.is_deleted
                GROUP BY te.task_id
            ),
            skill_credit_agg AS (
                SELECT
                    te.task_id AS skill_id,
                    COALESCE(SUM(ur.credits_used), 0)::bigint AS total_credits
                FROM task_execution te
                JOIN users u ON u.id = te.user_id
                LEFT JOIN usage_record ur
                    -- schema mismatch: usage_record.task_id is varchar while task_execution.id is int; a future migration should align these column types.
                    ON ur.task_id = te.id::varchar
                WHERE u.tenant_id = $1
                  AND te.task_id IS NOT NULL
                  AND COALESCE(te.finished_at, te.started_at) >= $2
                  AND COALESCE(te.finished_at, te.started_at) < $3
                  AND NOT te.is_deleted
                  AND NOT u.is_deleted
                GROUP BY te.task_id
            )
            SELECT
                ut.id AS skill_id,
                ut.task_name AS skill_name,
                CASE
                    WHEN (
                        COALESCE(skill_te_agg.comments, 0) +
                        COALESCE(skill_te_agg.likes, 0) +
                        COALESCE(skill_te_agg.saves, 0) +
                        COALESCE(skill_te_agg.dms, 0) +
                        COALESCE(skill_te_agg.reach, 0)
                    ) > 0 THEN 'acquire'
                    ELSE 'ops'
                END AS task_group,
                ut.related_platforms,
                ut.task_description AS description,
                COALESCE(skill_te_agg.exec_count, 0)::bigint AS exec_count,
                COALESCE(skill_te_agg.success_count, 0)::bigint AS success_count,
                COALESCE(skill_te_agg.fail_count, 0)::bigint AS fail_count,
                COALESCE(skill_te_agg.duration_sec, 0)::float AS duration_sec,
                COALESCE(skill_te_agg.comments, 0)::bigint AS comments,
                COALESCE(skill_te_agg.likes, 0)::bigint AS likes,
                COALESCE(skill_te_agg.saves, 0)::bigint AS saves,
                COALESCE(skill_te_agg.dms, 0)::bigint AS dms,
                COALESCE(skill_te_agg.reach, 0)::bigint AS reach,
                COALESCE(skill_credit_agg.total_credits, 0)::bigint AS total_credits
            FROM user_task ut
            JOIN users u ON u.id = ut.user_id
            LEFT JOIN skill_te_agg ON skill_te_agg.skill_id = ut.id
            LEFT JOIN skill_credit_agg ON skill_credit_agg.skill_id = ut.id
            WHERE u.tenant_id = $1
              AND NOT ut.is_deleted
              AND NOT u.is_deleted
              AND COALESCE(skill_te_agg.exec_count, 0) > 0
            ORDER BY COALESCE(skill_te_agg.exec_count, 0) DESC, ut.id
            """,
            tenant_id, cur_start, cur_end,
        ),
        pool.fetch(
            f"""
            WITH device_te_agg AS (
                SELECT
                    te.device_id,
                    COUNT(*)::bigint AS exec_count,
                    COUNT(*) FILTER (WHERE {_success_filter_sql('te')})::bigint AS success_count,
                    COUNT(*) FILTER (WHERE te.execution_result = 'FAILED')::bigint AS fail_count,
                    COALESCE(SUM(EXTRACT(EPOCH FROM (te.finished_at - te.started_at))), 0)::float AS duration_sec,
                    COALESCE(SUM(ebs.comment_count), 0)::bigint AS comments,
                    COALESCE(SUM(ebs.like_count), 0)::bigint AS likes,
                    COALESCE(SUM(ebs.collect_count), 0)::bigint AS saves,
                    COALESCE(SUM(ebs.dm_count), 0)::bigint AS dms,
                    COALESCE(SUM(ebs.unique_reach), 0)::bigint AS reach
                FROM task_execution te
                LEFT JOIN execution_behavior_stat ebs ON ebs.execution_id = te.id
                JOIN users u ON u.id = te.user_id
                WHERE u.tenant_id = $1
                  AND te.device_id IS NOT NULL
                  AND COALESCE(te.finished_at, te.started_at) >= $2
                  AND COALESCE(te.finished_at, te.started_at) < $3
                  AND NOT te.is_deleted
                  AND NOT u.is_deleted
                GROUP BY te.device_id
            ),
            device_credit_agg AS (
                SELECT
                    te.device_id,
                    COALESCE(SUM(ur.credits_used), 0)::bigint AS total_credits
                FROM task_execution te
                JOIN users u ON u.id = te.user_id
                LEFT JOIN usage_record ur
                    -- schema mismatch: usage_record.task_id is varchar while task_execution.id is int; a future migration should align these column types.
                    ON ur.task_id = te.id::varchar
                WHERE u.tenant_id = $1
                  AND te.device_id IS NOT NULL
                  AND COALESCE(te.finished_at, te.started_at) >= $2
                  AND COALESCE(te.finished_at, te.started_at) < $3
                  AND NOT te.is_deleted
                  AND NOT u.is_deleted
                GROUP BY te.device_id
            )
            SELECT
                device_te_agg.device_id,
                device_te_agg.exec_count,
                device_te_agg.success_count,
                device_te_agg.fail_count,
                device_te_agg.duration_sec,
                device_te_agg.comments,
                device_te_agg.likes,
                device_te_agg.saves,
                device_te_agg.dms,
                device_te_agg.reach,
                COALESCE(device_credit_agg.total_credits, 0)::bigint AS total_credits
            FROM device_te_agg
            LEFT JOIN device_credit_agg ON device_credit_agg.device_id = device_te_agg.device_id
            ORDER BY device_te_agg.exec_count DESC, device_te_agg.device_id
            """,
            tenant_id, cur_start, cur_end,
        ),
        pool.fetch(
            """
            SELECT te.device_id,
                   COALESCE(ebs.platform::text, 'OTHER') AS platform,
                   COUNT(*)::bigint AS exec_count,
                   COUNT(*) FILTER (WHERE te.execution_result = 'FAILED')::bigint AS fail_count
            FROM task_execution te
            LEFT JOIN execution_behavior_stat ebs ON ebs.execution_id = te.id
            JOIN users u ON u.id = te.user_id
            WHERE u.tenant_id = $1
              AND te.device_id IS NOT NULL
              AND COALESCE(te.finished_at, te.started_at) >= $2
              AND COALESCE(te.finished_at, te.started_at) < $3
              AND NOT te.is_deleted AND NOT u.is_deleted
            GROUP BY te.device_id, ebs.platform
            """,
            tenant_id, cur_start, cur_end,
        ),
    )

    accounts = []
    for r in account_rows:
        runtime_h = round(float(r["duration_sec"] or 0) / 3600.0, 1)
        accounts.append({
            "id": r["user_id"],
            "user_id": r["user_id"],
            "username": r["username"] or f"user-{r['user_id']}",
            "role": r["role"],
            "device_id": r["device_id"],
            "total_credits": int(r["total_credits"]),
            "success_count": int(r["success_count"]),
            "exec_count": int(r["exec_count"]),
            "runtime_h": runtime_h,
            "comments": int(r["comments"]),
            "likes": int(r["likes"]),
            "saves": int(r["saves"]),
            "dms": int(r["dms"]),
            "reach": int(r["reach"]),
        })

    account_totals = {
        "accounts": len([a for a in accounts if a["exec_count"] > 0]),
        "success_count": sum(int(r["success_count"] or 0) for r in account_rows),
        "total_credits": sum(int(r["total_credits"] or 0) for r in account_rows),
        "runtime_h": round(sum(float(r["duration_sec"] or 0) for r in account_rows) / 3600.0, 1),
        "reach": sum(int(r["reach"] or 0) for r in account_rows),
    }

    # 按 execution_behavior_stat 行为数据动态分组
    groups: dict[str, dict[str, Any]] = {}
    for k, meta in TASK_GROUP_META.items():
        groups[k] = {
            "key": k,
            "label": meta["label"],
            "emoji": meta["emoji"],
            "color": meta["color"],
            "skills": [],
            "totals": {"exec": 0, "success_count": 0, "comments": 0, "likes": 0, "saves": 0, "dms": 0, "reach": 0, "total_credits": 0},
        }

    for r in skill_rows:
        group_key = str(r["task_group"] or "ops")
        if group_key not in groups:
            group_key = "ops"
        skill_item = {
            "skill_id": int(r["skill_id"]),
            "skill_code": f"S{r['skill_id']}",
            "skill_name": r["skill_name"],
            "description": r["description"] or "",
            "category": group_key,
            "task_group": group_key,
            "exec": int(r["exec_count"]),
            "success_count": int(r["success_count"]),
            "fail": int(r["fail_count"]),
            "runtime_h": round(float(r["duration_sec"] or 0) / 3600.0, 1),
            "comments": int(r["comments"]),
            "likes": int(r["likes"]),
            "saves": int(r["saves"]),
            "dms": int(r["dms"]),
            "reach": int(r["reach"]),
            "total_credits": int(r["total_credits"]),
        }
        g = groups[group_key]
        g["skills"].append(skill_item)
        g["totals"]["exec"] += skill_item["exec"]
        g["totals"]["success_count"] += skill_item["success_count"]
        g["totals"]["comments"] += skill_item["comments"]
        g["totals"]["likes"] += skill_item["likes"]
        g["totals"]["saves"] += skill_item["saves"]
        g["totals"]["dms"] += skill_item["dms"]
        g["totals"]["reach"] += skill_item["reach"]
        g["totals"]["total_credits"] += skill_item["total_credits"]

    skill_groups = [g for g in groups.values() if g["skills"]]
    skill_totals = {
        "success_count": sum(g["totals"]["success_count"] for g in skill_groups),
        "total_credits": sum(g["totals"]["total_credits"] for g in skill_groups),
    }

    devices = []
    alert_count = 0
    for r in device_rows:
        exec_count = int(r["exec_count"])
        fail_count = int(r["fail_count"])
        fail_rate = (fail_count / exec_count) if exec_count else 0
        if fail_rate > 0.4:
            status = "critical"
        elif fail_rate > 0.2:
            status = "warning"
        else:
            status = "healthy"
        if status != "healthy":
            alert_count += 1
        devices.append({
            "id": r["device_id"],
            "exec_count": exec_count,
            "success_count": int(r["success_count"]),
            "fail_count": fail_count,
            "fail_rate": round(fail_rate * 100),
            "runtime_h": round(float(r["duration_sec"] or 0) / 3600.0, 1),
            "comments": int(r["comments"]),
            "likes": int(r["likes"]),
            "saves": int(r["saves"]),
            "dms": int(r["dms"]),
            "reach": int(r["reach"]),
            "total_credits": int(r["total_credits"]),
            "status": status,
        })

    heat_map: dict[str, dict[str, dict[str, int]]] = {}
    for r in heat_rows:
        dev = r["device_id"]
        plat_key = (r["platform"] or "OTHER").lower()
        cells = heat_map.setdefault(dev, {})
        cells[plat_key] = {
            "exec": int(r["exec_count"]),
            "fail": int(r["fail_count"]),
        }
    device_heat = [{"id": dev, "cells": cells} for dev, cells in heat_map.items()]

    return {
        "accounts": accounts,
        "account_totals": account_totals,
        "skill_totals": skill_totals,
        "skill_groups": skill_groups,
        "devices": devices,
        "device_heat": device_heat,
        "device_alert_count": alert_count,
    }


# ────────────────────────────────────────────────────────────────
# 4. /api/dashboard/charts
# ────────────────────────────────────────────────────────────────

async def aggregate_charts(
    pool: Pool,
    tenant_id: int,
    range_param: str,
    start: Optional[str] = None,
    end: Optional[str] = None,
    _window: Optional[tuple[datetime, datetime, datetime, datetime, str, str, int]] = None,
    _cur_totals: Any = None,
    _cur_credits: Any = None,
    _prev_totals: Any = None,
    _prev_credits: Any = None,
) -> dict[str, Any]:
    cur_start, cur_end, prev_start, prev_end, _, _, _ = _window or _resolve_window(range_param, start, end)

    duration_sql = f"""
        SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (te.finished_at - te.started_at))), 0)::float AS duration_sec
        FROM task_execution te
        JOIN users u ON u.id = te.user_id
        WHERE u.tenant_id = $1
          AND {_success_filter_sql('te')}
          AND COALESCE(te.finished_at, te.started_at) >= $2
          AND COALESCE(te.finished_at, te.started_at) < $3
          AND NOT te.is_deleted AND NOT u.is_deleted
    """

    platform_rows, interaction_rows, cur_totals, cur_credits, duration_row, prev_totals, prev_credits, prev_duration_row = await asyncio.gather(
        pool.fetch(
            """
            WITH platform_te_agg AS (
                SELECT
                    COALESCE(ebs.platform::text, 'OTHER') AS platform,
                    COALESCE(SUM(ebs.unique_reach), 0)::bigint AS reach
                FROM task_execution te
                LEFT JOIN execution_behavior_stat ebs ON ebs.execution_id = te.id
                JOIN users u ON u.id = te.user_id
                WHERE u.tenant_id = $1
                  AND COALESCE(te.finished_at, te.started_at) >= $2
                  AND COALESCE(te.finished_at, te.started_at) < $3
                  AND NOT te.is_deleted
                  AND NOT u.is_deleted
                GROUP BY COALESCE(ebs.platform::text, 'OTHER')
            )
            SELECT platform, reach
            FROM platform_te_agg
            WHERE reach > 0
            ORDER BY reach DESC, platform
            """,
            tenant_id, cur_start, cur_end,
        ),
        pool.fetch(
            """
            WITH interaction_te_agg AS (
                SELECT
                    COALESCE(SUM(ebs.comment_count), 0)::bigint AS comments,
                    COALESCE(SUM(ebs.like_count), 0)::bigint AS likes,
                    COALESCE(SUM(ebs.collect_count), 0)::bigint AS saves,
                    COALESCE(SUM(ebs.dm_count), 0)::bigint AS dms
                FROM task_execution te
                LEFT JOIN execution_behavior_stat ebs ON ebs.execution_id = te.id
                JOIN users u ON u.id = te.user_id
                WHERE u.tenant_id = $1
                  AND COALESCE(te.finished_at, te.started_at) >= $2
                  AND COALESCE(te.finished_at, te.started_at) < $3
                  AND NOT te.is_deleted
                  AND NOT u.is_deleted
            )
            SELECT 'comments'::text AS key, comments AS value FROM interaction_te_agg
            UNION ALL
            SELECT 'likes'::text AS key, likes AS value FROM interaction_te_agg
            UNION ALL
            SELECT 'saves'::text AS key, saves AS value FROM interaction_te_agg
            UNION ALL
            SELECT 'dms'::text AS key, dms AS value FROM interaction_te_agg
            """,
            tenant_id, cur_start, cur_end,
        ),
        _resolve_async_value(
            _cur_totals
            if _cur_totals is not None
            else _fetch_period_totals(pool, tenant_id, cur_start, cur_end)
        ),
        _resolve_async_value(
            _cur_credits
            if _cur_credits is not None
            else _fetch_period_credits(pool, tenant_id, cur_start, cur_end)
        ),
        pool.fetchrow(duration_sql, tenant_id, cur_start, cur_end),
        _resolve_async_value(
            _prev_totals
            if _prev_totals is not None
            else _fetch_period_totals(pool, tenant_id, prev_start, prev_end)
        ),
        _resolve_async_value(
            _prev_credits
            if _prev_credits is not None
            else _fetch_period_credits(pool, tenant_id, prev_start, prev_end)
        ),
        pool.fetchrow(duration_sql, tenant_id, prev_start, prev_end),
    )
    platform_breakdown = []
    for r in platform_rows:
        meta = PLATFORM_META.get(r["platform"], {"name": r["platform"] or "其他", "color": "#999999"})
        platform_breakdown.append({
            "key": (r["platform"] or "OTHER").lower(),
            "name": meta["name"],
            "value": int(r["reach"]),
            "color": meta["color"],
        })

    interaction_value_by_key = {str(r["key"]): int(r["value"]) for r in interaction_rows}
    interaction_breakdown = [
        {"key": k, "name": label, "value": interaction_value_by_key.get(k, 0), "color": color}
        for (k, label, color) in INTERACTION_META
    ]

    # mini stats
    runtime_sec = float((duration_row["duration_sec"] or 0))
    runtime_prev_sec = float((prev_duration_row["duration_sec"] or 0))
    runtime_h = round(runtime_sec / 3600, 1)
    total_exec = int(cur_totals.get("executions", 0))
    success_exec = int(cur_totals.get("successes", 0))
    rate_pct = round(success_exec / total_exec * 100) if total_exec else 0

    prev_runtime_h = round(runtime_prev_sec / 3600, 1)
    prev_exec = int(prev_totals.get("executions", 0))
    prev_success_exec = int(prev_totals.get("successes", 0))

    mini_stats = {
        "exec": str(total_exec),
        "exec_raw": total_exec,
        "exec_prev": prev_exec,
        "success_count": success_exec,
        "success_count_prev": prev_success_exec,
        "rate": f"{rate_pct}%",
        "runtime_h": runtime_h,
        "runtime_h_prev": prev_runtime_h,
        "total_credits": cur_credits,
        "total_credits_prev": prev_credits,
    }

    # ROI 公式: value = comments*1.3 + dms*1.3 + likes*0.4 + saves*0.4
    comments = int(cur_totals.get("comments", 0))
    likes = int(cur_totals.get("likes", 0))
    saves = int(cur_totals.get("saves", 0))
    dms = int(cur_totals.get("dms", 0))
    value_total = round(comments * 1.3 + dms * 1.3 + likes * 0.4 + saves * 0.4)
    cost_total = round(cur_credits * 0.3)
    roi_val = round(value_total / cost_total, 1) if cost_total else 0
    saved = max(value_total - cost_total, 0)
    saved_pct = round(saved / value_total * 100) if value_total else 0

    breakdown = [
        {"label": "评论", "count": comments, "unit_price": 1.3, "subtotal": round(comments * 1.3)},
        {"label": "私信", "count": dms, "unit_price": 1.3, "subtotal": round(dms * 1.3)},
        {"label": "点赞", "count": likes, "unit_price": 0.4, "subtotal": round(likes * 0.4)},
        {"label": "收藏", "count": saves, "unit_price": 0.4, "subtotal": round(saves * 0.4)},
    ]

    # ROI by platform: 用 platform_breakdown 按比例分摊
    total_reach = sum(p["value"] for p in platform_breakdown) or 1
    roi_platforms = []
    for p in platform_breakdown:
        share = p["value"] / total_reach
        p_value = round(value_total * share)
        p_cost = round(cost_total * share)
        p_roi = round(p_value / p_cost, 1) if p_cost else 0
        roi_platforms.append({"name": p["name"], "value": p_value, "cost": p_cost, "roi": p_roi})

    roi = {
        "value": value_total,
        "cost": cost_total,
        "roi": roi_val,
        "saved": saved,
        "saved_pct": saved_pct,
        "breakdown": breakdown,
        "platforms": roi_platforms,
    }

    return {
        "platform_breakdown": platform_breakdown,
        "interaction_breakdown": interaction_breakdown,
        "mini_stats": mini_stats,
        "roi": roi,
    }


# ────────────────────────────────────────────────────────────────
# 5. /api/dashboard/snapshot - 一次拉取首屏全部数据
# ────────────────────────────────────────────────────────────────

async def _actual_aggregate_snapshot(
    pool: Pool,
    tenant_id: int,
    range_param: str,
    start: Optional[str] = None,
    end: Optional[str] = None,
) -> dict[str, Any]:
    window = _resolve_window(range_param, start, end)
    cur_start, cur_end, prev_start, prev_end, _, unit, _ = window
    cur_totals_task = asyncio.create_task(_fetch_period_totals(pool, tenant_id, cur_start, cur_end))
    prev_totals_task = asyncio.create_task(_fetch_period_totals(pool, tenant_id, prev_start, prev_end))
    cur_credits_task = asyncio.create_task(_fetch_period_credits(pool, tenant_id, cur_start, cur_end))
    prev_credits_task = asyncio.create_task(_fetch_period_credits(pool, tenant_id, prev_start, prev_end))
    ops_trend_task = asyncio.create_task(_fetch_ops_trend(pool, tenant_id, cur_start, cur_end, unit))

    highlights, achievements, aggs, charts, ops_trend = await asyncio.gather(
        aggregate_highlights(pool, tenant_id, range_param, start, end, _window=window, _prev_totals=prev_totals_task),
        aggregate_achievements(
            pool,
            tenant_id,
            range_param,
            start,
            end,
            _window=window,
            _cur_totals=cur_totals_task,
            _prev_totals=prev_totals_task,
        ),
        aggregate_aggregations(pool, tenant_id, range_param, start, end, _window=window),
        aggregate_charts(
            pool,
            tenant_id,
            range_param,
            start,
            end,
            _window=window,
            _cur_totals=cur_totals_task,
            _cur_credits=cur_credits_task,
            _prev_totals=prev_totals_task,
            _prev_credits=prev_credits_task,
        ),
        ops_trend_task,
    )
    return {
        "range": range_param,
        "highlights": highlights,
        "achievements": achievements,
        "aggs": aggs,
        "charts": charts,
        "ops_trend": ops_trend,
    }


async def aggregate_snapshot(
    pool: Pool,
    tenant_id: int,
    range_param: str,
    start: Optional[str] = None,
    end: Optional[str] = None,
) -> dict[str, Any]:
    cache_key = (tenant_id, range_param, start, end)
    cached_snapshot = _snapshot_cache.get(cache_key, _CACHE_MISS)
    if cached_snapshot is not _CACHE_MISS:
        return cached_snapshot

    async with _cache_lock:
        cached_snapshot = _snapshot_cache.get(cache_key, _CACHE_MISS)
        if cached_snapshot is not _CACHE_MISS:
            return cached_snapshot

        snapshot = await _actual_aggregate_snapshot(pool, tenant_id, range_param, start, end)
        _snapshot_cache[cache_key] = snapshot
        return snapshot


WHITELIST = {
    "task_execution",
    "user_task",
    "skill",
    "credit_flow",
    "credit_batch",
    "users",
    "user_balance",
    "usage_record",
    "tenants",
    "enterprise_audit_log",
    "enterprise_recharge_record",
    "executor_behavior_log",
    "recharge_order",
    "execution_behavior_stat",
}


async def explore_tables(pool: Pool) -> dict[str, list[dict[str, Any]]]:
    table_rows = await pool.fetch(
        """
        SELECT relname AS table_name, n_live_tup::bigint AS row_count
        FROM pg_stat_user_tables
        ORDER BY relname
        """
    )
    column_rows = await pool.fetch(
        """
        SELECT table_name, column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position
        """
    )

    columns_by_table: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in column_rows:
        columns_by_table[row["table_name"]].append(
            {
                "name": row["column_name"],
                "type": row["data_type"],
            }
        )

    tables = [
        {
            "name": row["table_name"],
            "row_count": row["row_count"],
            "columns": columns_by_table.get(row["table_name"], []),
        }
        for row in table_rows
    ]
    return {"tables": tables}


async def sample_table(pool: Pool, table_name: str, limit: int, tenant_id: int) -> list[dict[str, Any]]:
    if table_name not in WHITELIST:
        raise ValueError(f"Table '{table_name}' is not allowed")

    json_column_rows = await pool.fetch(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND data_type IN ('json', 'jsonb')
        ORDER BY ordinal_position
        """,
        table_name,
    )
    json_columns = {row["column_name"] for row in json_column_rows}

    query = f'SELECT * FROM "{table_name}"'
    if table_name in TENANT_SCOPED_TABLES:
        query += " WHERE tenant_id = $1 LIMIT $2"
        rows = await pool.fetch(query, tenant_id, limit)
    else:
        query += " LIMIT $1"
        rows = await pool.fetch(query, limit)

    sampled_rows: list[dict[str, Any]] = []
    for row in rows:
        item: dict[str, Any] = {}
        for key, value in dict(row).items():
            if key in json_columns and value is not None:
                item[key] = json.dumps(value, default=str)
            else:
                item[key] = value
        sampled_rows.append(item)

    return sampled_rows


async def stats_overview(pool: Pool, days: int, tenant_id: int) -> dict[str, Any]:
    interval_literal = f"{days} days"

    overview_row = await pool.fetchrow(
        f"""
        WITH te_overview AS (
            SELECT
                COUNT(*)::bigint AS total_executions,
                COUNT(*) FILTER (WHERE {_success_filter_sql('te')})::bigint AS success_count,
                COUNT(*) FILTER (WHERE te.execution_result = 'FAILED')::bigint AS fail_count,
                COUNT(DISTINCT te.user_id)::bigint AS active_users,
                COALESCE(SUM(EXTRACT(EPOCH FROM (te.finished_at - te.started_at)))/3600, 0)::float AS total_duration_hours
            FROM task_execution te
            JOIN users u ON u.id = te.user_id
            WHERE COALESCE(te.finished_at, te.started_at) >= NOW() - INTERVAL '{interval_literal}'
              AND u.tenant_id = $1
              AND NOT te.is_deleted
              AND NOT u.is_deleted
        ),
        credit_overview AS (
            SELECT COALESCE(SUM(cf.change_amount), 0) AS total_credits_consumed
            FROM credit_flow cf
            JOIN users u ON u.id = cf.user_id
            WHERE cf.change_type = 'CONSUME'
              AND cf.created_at >= NOW() - INTERVAL '{interval_literal}'
              AND u.tenant_id = $1
              AND NOT u.is_deleted
        )
        SELECT
            te_overview.total_executions,
            te_overview.success_count,
            te_overview.fail_count,
            te_overview.active_users,
            te_overview.total_duration_hours,
            credit_overview.total_credits_consumed
        FROM te_overview
        CROSS JOIN credit_overview
        """,
        tenant_id,
    )

    return {
        "total_executions": overview_row["total_executions"],
        "success_count": overview_row["success_count"],
        "fail_count": overview_row["fail_count"],
        "total_credits": float(overview_row["total_credits_consumed"]),
        "active_users": overview_row["active_users"],
        "runtime_h": float(overview_row["total_duration_hours"]),
    }


async def stats_trend(pool: Pool, days: int, tenant_id: int) -> dict[str, list[Any]]:
    if days == 1:
        rows = await pool.fetch(
            f"""
            WITH hours AS (
                SELECT generate_series(
                    DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Shanghai'),
                    DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Shanghai') + INTERVAL '23 hours',
                    INTERVAL '1 hour'
                ) AS day_hour
            ),
            te_agg AS (
                SELECT
                    DATE_TRUNC('hour', COALESCE(te.finished_at, te.started_at) AT TIME ZONE 'Asia/Shanghai') AS day_hour,
                    COUNT(*) FILTER (WHERE {_success_filter_sql('te')})::bigint AS success,
                    COUNT(*) FILTER (WHERE te.execution_result = 'FAILED')::bigint AS failed,
                    COUNT(*)::bigint AS total,
                    COALESCE(SUM(ebs.comment_count), 0)::bigint AS comments,
                    COALESCE(SUM(ebs.like_count), 0)::bigint AS likes,
                    COALESCE(SUM(ebs.collect_count), 0)::bigint AS saves,
                    COALESCE(SUM(ebs.dm_count), 0)::bigint AS dms,
                    COALESCE(SUM(ebs.unique_reach), 0)::bigint AS reach,
                    COALESCE(SUM(EXTRACT(EPOCH FROM (te.finished_at - te.started_at))), 0)::float / 3600.0 AS runtime_h
                FROM task_execution te
                LEFT JOIN execution_behavior_stat ebs ON ebs.execution_id = te.id
                JOIN users u ON u.id = te.user_id
                WHERE COALESCE(te.finished_at, te.started_at) >= (
                          DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'
                      )
                  AND COALESCE(te.finished_at, te.started_at) < (
                          (DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Shanghai') + INTERVAL '1 day')
                          AT TIME ZONE 'Asia/Shanghai'
                      )
                  AND u.tenant_id = $1
                  AND NOT te.is_deleted AND NOT u.is_deleted
                GROUP BY DATE_TRUNC('hour', COALESCE(te.finished_at, te.started_at) AT TIME ZONE 'Asia/Shanghai')
            ),
            ur_agg AS (
                SELECT
                    DATE_TRUNC('hour', COALESCE(ur.end_time, ur.start_time, ur.created_at) AT TIME ZONE 'Asia/Shanghai') AS day_hour,
                    COALESCE(SUM(ur.credits_used), 0)::bigint AS credits
                FROM usage_record ur
                JOIN users u ON u.id = ur.user_id
                WHERE COALESCE(ur.end_time, ur.start_time, ur.created_at) >= (
                          DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'
                      )
                  AND COALESCE(ur.end_time, ur.start_time, ur.created_at) < (
                          (DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Shanghai') + INTERVAL '1 day')
                          AT TIME ZONE 'Asia/Shanghai'
                      )
                  AND u.tenant_id = $1
                  AND NOT u.is_deleted
                GROUP BY DATE_TRUNC('hour', COALESCE(ur.end_time, ur.start_time, ur.created_at) AT TIME ZONE 'Asia/Shanghai')
            )
            SELECT
                hours.day_hour AS day_hour,
                COALESCE(te_agg.success, 0) AS success,
                COALESCE(te_agg.failed, 0) AS failed,
                COALESCE(te_agg.total, 0) AS total,
                COALESCE(te_agg.comments, 0) AS comments,
                COALESCE(te_agg.likes, 0) AS likes,
                COALESCE(te_agg.saves, 0) AS saves,
                COALESCE(te_agg.dms, 0) AS dms,
                COALESCE(te_agg.reach, 0) AS reach,
                COALESCE(ur_agg.credits, 0) AS credits,
                COALESCE(te_agg.runtime_h, 0) AS runtime_h
            FROM hours
            LEFT JOIN te_agg USING (day_hour)
            LEFT JOIN ur_agg USING (day_hour)
            ORDER BY hours.day_hour
            """,
            tenant_id,
        )
        dates = [
            (row["day_hour"].astimezone(CN_TZ) if row["day_hour"].tzinfo else row["day_hour"]).strftime("%Y-%m-%dT%H:%M:%S")
            for row in rows
        ]
    else:
        rows = await pool.fetch(
            f"""
            WITH dates AS (
                SELECT generate_series(
                    ((NOW() AT TIME ZONE 'Asia/Shanghai')::date - ($2::int - 1)),
                    (NOW() AT TIME ZONE 'Asia/Shanghai')::date,
                    INTERVAL '1 day'
                )::date AS day
            ),
            te_agg AS (
                SELECT
                    DATE(COALESCE(te.finished_at, te.started_at) AT TIME ZONE 'Asia/Shanghai') AS day,
                    COUNT(*) FILTER (WHERE {_success_filter_sql('te')})::bigint AS success,
                    COUNT(*) FILTER (WHERE te.execution_result = 'FAILED')::bigint AS failed,
                    COUNT(*)::bigint AS total,
                    COALESCE(SUM(ebs.comment_count), 0)::bigint AS comments,
                    COALESCE(SUM(ebs.like_count), 0)::bigint AS likes,
                    COALESCE(SUM(ebs.collect_count), 0)::bigint AS saves,
                    COALESCE(SUM(ebs.dm_count), 0)::bigint AS dms,
                    COALESCE(SUM(ebs.unique_reach), 0)::bigint AS reach,
                    COALESCE(SUM(EXTRACT(EPOCH FROM (te.finished_at - te.started_at))), 0)::float / 3600.0 AS runtime_h
                FROM task_execution te
                LEFT JOIN execution_behavior_stat ebs ON ebs.execution_id = te.id
                JOIN users u ON u.id = te.user_id
                WHERE COALESCE(te.finished_at, te.started_at) >= (
                          (((NOW() AT TIME ZONE 'Asia/Shanghai')::date - ($2::int - 1))::timestamp)
                          AT TIME ZONE 'Asia/Shanghai'
                      )
                  AND COALESCE(te.finished_at, te.started_at) < (
                          (((NOW() AT TIME ZONE 'Asia/Shanghai')::date + 1)::timestamp)
                          AT TIME ZONE 'Asia/Shanghai'
                      )
                  AND u.tenant_id = $1
                  AND NOT te.is_deleted AND NOT u.is_deleted
                GROUP BY DATE(COALESCE(te.finished_at, te.started_at) AT TIME ZONE 'Asia/Shanghai')
            ),
            ur_agg AS (
                SELECT
                    DATE(COALESCE(ur.end_time, ur.start_time, ur.created_at) AT TIME ZONE 'Asia/Shanghai') AS day,
                    COALESCE(SUM(ur.credits_used), 0)::bigint AS credits
                FROM usage_record ur
                JOIN users u ON u.id = ur.user_id
                WHERE COALESCE(ur.end_time, ur.start_time, ur.created_at) >= (
                          (((NOW() AT TIME ZONE 'Asia/Shanghai')::date - ($2::int - 1))::timestamp)
                          AT TIME ZONE 'Asia/Shanghai'
                      )
                  AND COALESCE(ur.end_time, ur.start_time, ur.created_at) < (
                          (((NOW() AT TIME ZONE 'Asia/Shanghai')::date + 1)::timestamp)
                          AT TIME ZONE 'Asia/Shanghai'
                      )
                  AND u.tenant_id = $1
                  AND NOT u.is_deleted
                GROUP BY DATE(COALESCE(ur.end_time, ur.start_time, ur.created_at) AT TIME ZONE 'Asia/Shanghai')
            )
            SELECT
                dates.day AS day,
                COALESCE(te_agg.success, 0) AS success,
                COALESCE(te_agg.failed, 0) AS failed,
                COALESCE(te_agg.total, 0) AS total,
                COALESCE(te_agg.comments, 0) AS comments,
                COALESCE(te_agg.likes, 0) AS likes,
                COALESCE(te_agg.saves, 0) AS saves,
                COALESCE(te_agg.dms, 0) AS dms,
                COALESCE(te_agg.reach, 0) AS reach,
                COALESCE(ur_agg.credits, 0) AS credits,
                COALESCE(te_agg.runtime_h, 0) AS runtime_h
            FROM dates
            LEFT JOIN te_agg USING (day)
            LEFT JOIN ur_agg USING (day)
            ORDER BY dates.day
            """,
            tenant_id,
            days,
        )
        dates = [row["day"].isoformat() for row in rows]

    return {
        "dates": dates,
        "success": [row["success"] for row in rows],
        "failed": [row["failed"] for row in rows],
        "total": [row["total"] for row in rows],
        "comments": [row["comments"] for row in rows],
        "likes": [row["likes"] for row in rows],
        "saves": [row["saves"] for row in rows],
        "dms": [row["dms"] for row in rows],
        "reach": [row["reach"] for row in rows],
        "credits": [row["credits"] for row in rows],
        "runtime_h": [round(float(row["runtime_h"] or 0), 1) for row in rows],
    }


async def stats_credits(pool: Pool, days: int, tenant_id: int) -> dict[str, list[Any]]:
    interval_literal = f"{days} days"

    rows = await pool.fetch(
        f"""
        SELECT
            DATE(cf.created_at) AS day,
            cf.change_type,
            COALESCE(SUM(cf.change_amount), 0) AS total_amount
        FROM credit_flow cf
        JOIN users u ON u.id = cf.user_id
        WHERE cf.created_at > NOW() - INTERVAL '{interval_literal}'
          AND cf.change_type IN ('CONSUME', 'RECHARGE')
          AND u.tenant_id = $1
          AND NOT u.is_deleted
        GROUP BY DATE(cf.created_at), cf.change_type
        ORDER BY day, cf.change_type
        """,
        tenant_id,
    )

    series: dict[str, dict[str, float]] = {}
    for row in rows:
        day = row["day"].isoformat()
        if day not in series:
            series[day] = {"consumed": 0.0, "recharged": 0.0}
        if row["change_type"] == "CONSUME":
            series[day]["consumed"] = float(row["total_amount"])
        elif row["change_type"] == "RECHARGE":
            series[day]["recharged"] = float(row["total_amount"])

    ordered_dates = sorted(series.keys())
    return {
        "dates": ordered_dates,
        "consumed": [series[day]["consumed"] for day in ordered_dates],
        "recharged": [series[day]["recharged"] for day in ordered_dates],
    }


async def stats_tasks(pool: Pool, tenant_id: int) -> list[dict[str, Any]]:
    rows = await pool.fetch(
        f"""
        SELECT
            ut.task_name,
            CASE
                WHEN COALESCE(exec_stats.engagement_total, 0) > 0 THEN 'acquire'
                ELSE 'ops'
            END AS task_group,
            ut.related_platforms,
            COALESCE(exec_stats.total_executions, 0)::bigint AS total_executions,
            COALESCE(exec_stats.success_count, 0)::bigint AS success_count,
            COALESCE(exec_stats.fail_count, 0)::bigint AS fail_count
        FROM user_task AS ut
        LEFT JOIN (
            SELECT
                te.task_id,
                COUNT(*)::bigint AS total_executions,
                COUNT(*) FILTER (WHERE {_success_filter_sql('te')})::bigint AS success_count,
                COUNT(*) FILTER (WHERE te.execution_result = 'FAILED')::bigint AS fail_count,
                COALESCE(
                    SUM(
                        COALESCE(ebs.comment_count, 0) +
                        COALESCE(ebs.like_count, 0) +
                        COALESCE(ebs.collect_count, 0) +
                        COALESCE(ebs.dm_count, 0) +
                        COALESCE(ebs.unique_reach, 0)
                    ),
                    0
                )::bigint AS engagement_total
            FROM task_execution te
            JOIN users u ON u.id = te.user_id
            LEFT JOIN execution_behavior_stat ebs ON ebs.execution_id = te.id
            WHERE u.tenant_id = $1
              AND NOT te.is_deleted
              AND NOT u.is_deleted
            GROUP BY te.task_id
        ) AS exec_stats
            ON exec_stats.task_id = ut.id
        WHERE NOT ut.is_deleted
          AND ut.user_id IN (
              SELECT id
              FROM users
              WHERE tenant_id = $1
                AND NOT is_deleted
          )
        ORDER BY total_executions DESC, ut.task_name
        LIMIT 50
        """,
        tenant_id,
    )

    items: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        raw_task_name = item.get("task_name")
        group_key = str(item.get("task_group") or "ops")
        if group_key != "acquire":
            group_key = "ops"
        item["task_detail_name"] = raw_task_name
        item["category"] = TASK_GROUP_LABEL.get(group_key, group_key)
        item["task_group"] = group_key
        item["task_name"] = TASK_GROUP_LABEL.get(group_key, str(raw_task_name or "未命名任务"))
        items.append(item)

    return items


async def get_members(pool: Pool, tenant_id: int) -> list[dict[str, Any]]:
    rows = await pool.fetch(
        """
        SELECT u.id, u.name AS username, u."phoneNumber" AS phone, u.role,
               COALESCE(ub.remaining, 0)::float AS balance,
               u."createdAt" AS join_date,
               COALESCE(es.exec_count, 0)::bigint AS exec_count,
               COALESCE(es.total_tokens, 0)::bigint AS total_tokens
        FROM users u
        LEFT JOIN user_balance ub ON u.id = ub.user_id
        LEFT JOIN (
            SELECT user_id, COUNT(*) AS exec_count,
                   COALESCE(SUM(
                       CASE WHEN token_usage IS NOT NULL
                            THEN ((token_usage #>> '{}')::jsonb ->> 'total_tokens')::bigint
                            ELSE 0 END
                   ), 0) AS total_tokens
            FROM task_execution GROUP BY user_id
        ) es ON u.id = es.user_id
        WHERE NOT u.is_deleted AND u.tenant_id = $1
        ORDER BY u."createdAt"
        """,
        tenant_id,
    )
    result = []
    for row in rows:
        item = dict(row)
        if item.get("join_date"):
            item["join_date"] = item["join_date"].isoformat()
        result.append(item)
    return result


async def get_wallet(pool: Pool, tenant_id: int) -> dict[str, Any]:
    balance_row = await pool.fetchrow(
        """
        SELECT COALESCE(SUM(ub.remaining), 0)::float AS total_balance
        FROM user_balance ub
        JOIN users u ON u.id = ub.user_id
        WHERE u.tenant_id = $1 AND NOT u.is_deleted
        """,
        tenant_id,
    )
    recharge_row = await pool.fetchrow(
        """
        SELECT COALESCE(SUM(cf.change_amount), 0)::float AS total_recharged
        FROM credit_flow cf
        JOIN users u ON u.id = cf.user_id
        WHERE cf.change_type = 'RECHARGE' AND u.tenant_id = $1 AND NOT u.is_deleted
        """,
        tenant_id,
    )
    consume_row = await pool.fetchrow(
        """
        SELECT COALESCE(SUM(ABS(cf.change_amount)), 0)::float AS total_consumed
        FROM credit_flow cf
        JOIN users u ON u.id = cf.user_id
        WHERE cf.change_type = 'CONSUME' AND u.tenant_id = $1 AND NOT u.is_deleted
        """,
        tenant_id,
    )
    count_row = await pool.fetchrow(
        "SELECT COUNT(*)::bigint AS cnt FROM users WHERE tenant_id = $1 AND NOT is_deleted",
        tenant_id,
    )
    return {
        "total_balance": balance_row["total_balance"],
        "total_recharged": recharge_row["total_recharged"],
        "total_consumed": consume_row["total_consumed"],
        "member_count": count_row["cnt"],
    }


def _append_optional_query_condition(
    clauses: list[str],
    params: list[Any],
    template: str,
    value: Any,
) -> None:
    if value is None:
        return
    if isinstance(value, str):
        value = value.strip()
        if not value:
            return
    params.append(value)
    clauses.append(template.format(param_index=len(params)))


def _normalize_transaction_filter_value(value: str | None) -> str | None:
    if not value:
        return None
    raw = value.strip()
    if not raw:
        return None
    upper = raw.upper()
    aliases = {
        "CHARGE": "RECHARGE",
        "RECHARGE": "RECHARGE",
        "CONSUME": "CONSUME",
        "DISTRIBUTE": "DISTRIBUTE",
        "DEDUCT": "DEDUCT",
        "GIFT": "GIFT",
        "EXPIRE": "EXPIRE",
        "CHECKIN": "CHECKIN",
        "SIGNIN": "SIGNIN",
        "充值": "RECHARGE",
        "消耗": "CONSUME",
        "分发": "DISTRIBUTE",
        "扣减": "DEDUCT",
        "赠送": "GIFT",
        "过期": "EXPIRE",
        "签到": "CHECKIN",
    }
    return aliases.get(upper) or aliases.get(raw) or upper


def _normalize_audit_action_filter(value: str | None) -> str | None:
    if not value:
        return None
    raw = value.strip()
    if not raw:
        return None
    upper = raw.upper()
    aliases = {
        "TRANSFER_CREDITS": "TRANSFER_CREDITS",
        "ADD_MEMBER": "ADD_MEMBER",
        "REMOVE_MEMBER": "REMOVE_MEMBER",
        "MEMBER_UPDATE": "MEMBER_UPDATE",
        "BAN_MEMBER": "BAN_MEMBER",
        "分发积分": "TRANSFER_CREDITS",
        "分发算力豆": "TRANSFER_CREDITS",
        "新增成员": "ADD_MEMBER",
        "删除成员": "REMOVE_MEMBER",
        "编辑成员": "MEMBER_UPDATE",
        "封禁成员": "BAN_MEMBER",
    }
    return aliases.get(upper) or aliases.get(raw) or upper


def _build_transactions_where_clause(
    tenant_id: int,
    member_id: int | None,
    tx_type: str | None,
    start_date: date | None,
    end_date: date | None,
    keyword: str | None,
) -> tuple[str, list[Any]]:
    params: list[Any] = [tenant_id]
    clauses: list[str] = []
    normalized_tx_type = _normalize_transaction_filter_value(tx_type)
    _append_optional_query_condition(clauses, params, "sub.user_id = ${param_index}", member_id)
    _append_optional_query_condition(
        clauses, params, "UPPER(sub.change_type) = ${param_index}", normalized_tx_type,
    )
    _append_optional_query_condition(
        clauses,
        params,
        "DATE(COALESCE(sub.ended_at, sub.started_at) AT TIME ZONE 'Asia/Shanghai') >= ${param_index}",
        start_date,
    )
    _append_optional_query_condition(
        clauses,
        params,
        "DATE(COALESCE(sub.ended_at, sub.started_at) AT TIME ZONE 'Asia/Shanghai') <= ${param_index}",
        end_date,
    )
    if keyword and keyword.strip():
        params.append(f"%{keyword.strip()}%")
        keyword_index = len(params)
        clauses.append(
            "("
            f"COALESCE(sub.username, '') ILIKE ${keyword_index} OR "
            f"COALESCE(sub.task_name, '') ILIKE ${keyword_index} OR "
            f"COALESCE(sub.task_exec_id, '') ILIKE ${keyword_index} OR "
            f"COALESCE(sub.change_type, '') ILIKE ${keyword_index}"
            ")"
        )
    return (f"WHERE {' AND '.join(clauses)}" if clauses else ""), params


def _build_audit_log_where_clause(
    tenant_id: int,
    member_id: int | None,
    action: str | None,
    start_date: date | None,
    end_date: date | None,
    keyword: str | None,
) -> tuple[str, list[Any]]:
    params: list[Any] = [tenant_id]
    clauses: list[str] = ["tenant_id = $1"]
    normalized_action = _normalize_audit_action_filter(action)
    _append_optional_query_condition(
        clauses,
        params,
        "(operator_id = ${param_index} OR target_user_id = ${param_index})",
        member_id,
    )
    _append_optional_query_condition(
        clauses, params, "UPPER(action) = ${param_index}", normalized_action,
    )
    _append_optional_query_condition(
        clauses,
        params,
        "DATE(created_at AT TIME ZONE 'Asia/Shanghai') >= ${param_index}",
        start_date,
    )
    _append_optional_query_condition(
        clauses,
        params,
        "DATE(created_at AT TIME ZONE 'Asia/Shanghai') <= ${param_index}",
        end_date,
    )
    if keyword and keyword.strip():
        params.append(f"%{keyword.strip()}%")
        keyword_index = len(params)
        clauses.append(
            "("
            f"COALESCE(operator_name, '') ILIKE ${keyword_index} OR "
            f"COALESCE(target_user_name, '') ILIKE ${keyword_index} OR "
            f"COALESCE(remark, '') ILIKE ${keyword_index} OR "
            f"COALESCE(action, '') ILIKE ${keyword_index}"
            ")"
        )
    return f"WHERE {' AND '.join(clauses)}", params


async def _actual_get_transactions(
    pool: Pool,
    page: int,
    page_size: int,
    tenant_id: int,
    member_id: int | None = None,
    tx_type: str | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    keyword: str | None = None,
) -> dict[str, Any]:
    offset = (page - 1) * page_size
    where_clause, query_args = _build_transactions_where_clause(
        tenant_id, member_id, tx_type, start_date, end_date, keyword,
    )

    union_cte = """
        WITH ur_per_cf AS (
            SELECT
                CASE
                    WHEN to_jsonb(ur) ? 'ref_id' THEN to_jsonb(ur) ->> 'ref_id'
                    ELSE ur.id::text
                END AS ref_id,
                BOOL_OR(to_jsonb(ur) ? 'ref_id') AS has_ref_id,
                SUM(credits_used) AS credits_used,
                COUNT(*) AS ur_count,
                MAX(task_id) AS task_id
            FROM usage_record ur
            GROUP BY CASE
                WHEN to_jsonb(ur) ? 'ref_id' THEN to_jsonb(ur) ->> 'ref_id'
                ELSE ur.id::text
            END
        )
        SELECT
            'CONSUME'::text AS change_type,
            u.id AS user_id,
            te.id::varchar AS task_exec_id,
            ut.task_name,
            u.name AS username,
            COUNT(cf.id)::bigint AS call_count,
            SUM(cf.change_amount)::float AS total_change,
            MAX(cf.balance_after)::float AS balance_after,
            MIN(cf.created_at) AS started_at,
            MAX(cf.created_at) AS ended_at
        FROM credit_flow cf
        JOIN users u ON u.id = cf.user_id
        LEFT JOIN ur_per_cf ur
            ON cf.ref_type = 'usage'
            AND (
                (
                    ur.has_ref_id
                    AND ur.ref_id ~ '^[0-9]+$'
                    -- schema mismatch: usage_record.ref_id is varchar while credit_flow.id is int; a future migration should align these column types.
                    AND CASE WHEN ur.ref_id ~ '^[0-9]+$' THEN ur.ref_id::int END = cf.id
                )
                OR (
                    NOT ur.has_ref_id
                    AND cf.ref_id = ur.ref_id
                )
            )
        LEFT JOIN task_execution te
            -- schema mismatch: usage_record.task_id is varchar while task_execution.id is int; a future migration should align these column types.
            ON ur.task_id = te.id::varchar
        LEFT JOIN user_task ut ON te.task_id = ut.id
        WHERE cf.change_type = 'CONSUME'
          AND u.tenant_id = $1
          AND NOT u.is_deleted
          AND (te.id IS NULL OR NOT te.is_deleted)
          AND (ut.id IS NULL OR NOT ut.is_deleted)
        GROUP BY te.id, ut.task_name, u.id, u.name

        UNION ALL

        SELECT
            cf.change_type::text,
            u.id AS user_id,
            NULL AS task_exec_id,
            cf.remark AS task_name,
            u.name AS username,
            1::bigint AS call_count,
            cf.change_amount::float AS total_change,
            cf.balance_after::float AS balance_after,
            cf.created_at AS started_at,
            cf.created_at AS ended_at
        FROM credit_flow cf
        JOIN users u ON u.id = cf.user_id
        WHERE cf.change_type != 'CONSUME'
          AND u.tenant_id = $1
          AND NOT u.is_deleted
    """

    count_row = await pool.fetchrow(
        f"SELECT COUNT(*)::bigint AS total FROM ({union_cte}) sub {where_clause}",
        *query_args,
    )

    limit_index = len(query_args) + 1
    offset_index = len(query_args) + 2
    rows = await pool.fetch(
        f"""
        SELECT
            change_type,
            task_exec_id,
            task_name,
            username,
            call_count,
            total_change,
            balance_after,
            started_at,
            ended_at
        FROM ({union_cte}) sub
        {where_clause}
        ORDER BY ended_at DESC NULLS LAST
        LIMIT ${limit_index} OFFSET ${offset_index}
        """,
        *query_args,
        page_size,
        offset,
    )

    items = []
    for row in rows:
        item = dict(row)
        if item.get("started_at"):
            item["started_at"] = item["started_at"].isoformat()
        if item.get("ended_at"):
            item["ended_at"] = item["ended_at"].isoformat()
        items.append(item)

    return {"items": items, "total": count_row["total"]}


async def get_transactions(
    pool,
    page,
    page_size,
    tenant_id,
    member_id=None,
    tx_type=None,
    start_date=None,
    end_date=None,
    keyword=None,
    **filters,
):
    filters = {
        "member_id": filters.get("member_id", member_id),
        "tx_type": filters.get("tx_type", tx_type),
        "start_date": filters.get("start_date", start_date),
        "end_date": filters.get("end_date", end_date),
        "keyword": filters.get("keyword", keyword),
    }

    cache_key = (
        tenant_id,
        page,
        page_size,
        filters.get("member_id"),
        filters.get("tx_type"),
        filters.get("start_date"),
        filters.get("end_date"),
        filters.get("keyword"),
    )
    cached_transactions = _tx_cache.get(cache_key, _CACHE_MISS)
    if cached_transactions is not _CACHE_MISS:
        return cached_transactions

    async with _tx_cache_lock:
        cached_transactions = _tx_cache.get(cache_key, _CACHE_MISS)
        if cached_transactions is not _CACHE_MISS:
            return cached_transactions

        transactions = await _actual_get_transactions(
            pool,
            page,
            page_size,
            tenant_id,
            filters.get("member_id"),
            filters.get("tx_type"),
            filters.get("start_date"),
            filters.get("end_date"),
            filters.get("keyword"),
        )
        _tx_cache[cache_key] = transactions
        return transactions


async def get_skills(pool: Pool, tenant_id: int) -> list[dict[str, Any]]:
    rows = await pool.fetch(
        f"""
        SELECT ut.id, ut.task_name AS skill_name, ut.task_description AS description,
               ut.related_platforms, ut.category,
               COALESCE(es.total, 0)::bigint AS total_executions,
               COALESCE(es.success_count, 0)::bigint AS success_count
        FROM user_task ut
        LEFT JOIN (
            SELECT te.task_id,
                   COUNT(*) AS total,
                   COUNT(*) FILTER (WHERE {_success_filter_sql('te')}) AS success_count
            FROM task_execution te
            JOIN users u ON u.id = te.user_id
            WHERE u.tenant_id = $1
              AND NOT te.is_deleted
              AND NOT u.is_deleted
            GROUP BY te.task_id
        ) es ON ut.id = es.task_id
        WHERE NOT ut.is_deleted
          AND ut.user_id IN (
              SELECT id
              FROM users
              WHERE tenant_id = $1
                AND NOT is_deleted
          )
        ORDER BY total_executions DESC
        LIMIT 50
        """,
        tenant_id,
    )
    return [dict(row) for row in rows]


async def get_accounts(pool: Pool, tenant_id: int) -> list[dict[str, Any]]:
    rows = await pool.fetch(
        f"""
        WITH account_te_agg AS (
            SELECT
                te.user_id AS account_id,
                COUNT(*)::bigint AS exec_count,
                COUNT(*) FILTER (WHERE {_success_filter_sql('te')})::bigint AS success_count,
                COALESCE(SUM(EXTRACT(EPOCH FROM (te.finished_at - te.started_at))), 0)::float / 3600 AS duration_hours
            FROM task_execution te
            JOIN users u ON u.id = te.user_id
            WHERE u.tenant_id = $1
              AND NOT te.is_deleted
              AND NOT u.is_deleted
            GROUP BY te.user_id
        ),
        account_credit_agg AS (
            SELECT
                te.user_id AS account_id,
                COALESCE(SUM(ur.credits_used), 0)::bigint AS total_credits
            FROM task_execution te
            JOIN users u ON u.id = te.user_id
            LEFT JOIN usage_record ur
                -- schema mismatch: usage_record.task_id is varchar while task_execution.id is int; a future migration should align these column types.
                ON ur.task_id = te.id::varchar
            WHERE u.tenant_id = $1
              AND NOT te.is_deleted
              AND NOT u.is_deleted
            GROUP BY te.user_id
        )
        SELECT
            u.id,
            u.name AS username,
            COALESCE(account_te_agg.exec_count, 0)::bigint AS exec_count,
            COALESCE(account_te_agg.success_count, 0)::bigint AS success_count,
            COALESCE(account_te_agg.duration_hours, 0)::float AS runtime_h,
            COALESCE(account_credit_agg.total_credits, 0)::float AS total_credits
        FROM users u
        LEFT JOIN account_te_agg ON account_te_agg.account_id = u.id
        LEFT JOIN account_credit_agg ON account_credit_agg.account_id = u.id
        WHERE NOT u.is_deleted AND u.tenant_id = $1
        ORDER BY COALESCE(account_te_agg.exec_count, 0) DESC, u.id
        """,
        tenant_id,
    )
    result = []
    for row in rows:
        item = dict(row)
        item["runtime_h"] = round(float(item.get("runtime_h") or 0), 1)
        result.append(item)
    return result


async def get_account_week_summary(pool: Pool, account_id: int, tenant_id: int) -> dict[str, Any]:
    now = datetime.now(CN_TZ)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    cur_start = today_start - timedelta(days=6)
    end_exclusive = today_start + timedelta(days=1)

    account_row, summary_row, series_rows = await asyncio.gather(
        pool.fetchrow(
            """
            SELECT
                u.id,
                u.name,
                u.role,
                COALESCE(platforms.platforms, ARRAY[]::text[]) AS platforms
            FROM users u
            LEFT JOIN LATERAL (
                SELECT ARRAY_AGG(DISTINCT platform_key ORDER BY platform_key) AS platforms
                FROM (
                    SELECT CASE p.platform::text
                        WHEN 'XIAOHONGSHU' THEN 'xhs'
                        WHEN 'DOUYIN' THEN 'douyin'
                        WHEN 'KUAISHOU' THEN 'kuaishou'
                        WHEN 'WECHAT' THEN 'wechat'
                        WHEN 'LARK' THEN 'lark'
                        WHEN 'ZOOM' THEN 'zoom'
                        WHEN 'LINKEDIN' THEN 'linkedin'
                        WHEN 'INSTAGRAM' THEN 'instagram'
                        WHEN 'TIKTOK' THEN 'tiktok'
                        WHEN 'X' THEN 'x'
                        WHEN 'REDDIT' THEN 'reddit'
                        WHEN 'PINTEREST' THEN 'pinterest'
                        WHEN 'GENERAL_APP' THEN 'general_app'
                        ELSE LOWER(p.platform::text)
                    END AS platform_key
                    FROM user_task ut
                    CROSS JOIN LATERAL UNNEST(COALESCE(ut.related_platforms, ARRAY[]::platformtype[])) AS p(platform)
                    WHERE ut.user_id = u.id AND NOT ut.is_deleted
                ) platform_rows
            ) platforms ON TRUE
            WHERE u.id = $1 AND u.tenant_id = $2 AND NOT u.is_deleted
            """,
            account_id,
            tenant_id,
        ),
        pool.fetchrow(
            f"""
            WITH te_summary AS (
                SELECT
                    COUNT(te.id) FILTER (WHERE {_success_filter_sql('te')})::bigint AS success_count,
                    COALESCE(SUM(EXTRACT(EPOCH FROM (te.finished_at - te.started_at))), 0)::float / 3600 AS runtime_h,
                    COALESCE(SUM(ebs.unique_reach), 0)::bigint AS reach,
                    COALESCE(SUM(ebs.comment_count), 0)::bigint AS comments,
                    COALESCE(SUM(ebs.like_count), 0)::bigint AS likes,
                    COALESCE(SUM(ebs.collect_count), 0)::bigint AS saves,
                    COALESCE(SUM(ebs.dm_count), 0)::bigint AS dms
                FROM task_execution te
                LEFT JOIN execution_behavior_stat ebs ON ebs.execution_id = te.id
                JOIN users u ON u.id = te.user_id
                WHERE u.id = $1
                  AND u.tenant_id = $2
                  AND COALESCE(te.finished_at, te.started_at) >= $3
                  AND COALESCE(te.finished_at, te.started_at) < $4
                  AND NOT te.is_deleted
                  AND NOT u.is_deleted
            ),
            credit_summary AS (
                SELECT
                    COALESCE(SUM(ABS(cf.change_amount)) FILTER (WHERE cf.change_type = 'CONSUME'), 0)::bigint AS credits
                FROM usage_record ur
                JOIN users u ON u.id = ur.user_id
                LEFT JOIN credit_flow cf ON cf.ref_type = 'usage'
                                         AND cf.ref_id ~ '^[0-9]+$'
                                         -- schema mismatch: credit_flow.ref_id is varchar while usage_record.id is int; a future migration should align these column types.
                                         AND CASE WHEN cf.ref_id ~ '^[0-9]+$' THEN cf.ref_id::int END = ur.id
                                         AND cf.change_type = 'CONSUME'
                WHERE u.id = $1
                  AND u.tenant_id = $2
                  AND COALESCE(ur.end_time, ur.start_time, ur.created_at) >= $3
                  AND COALESCE(ur.end_time, ur.start_time, ur.created_at) < $4
                  AND NOT u.is_deleted
            )
            SELECT
                COALESCE(te_summary.success_count, 0)::bigint AS success_count,
                COALESCE(credit_summary.credits, 0)::bigint AS total_credits,
                COALESCE(te_summary.runtime_h, 0)::float AS runtime_h,
                COALESCE(te_summary.reach, 0)::bigint AS reach,
                COALESCE(te_summary.comments, 0)::bigint AS comments,
                COALESCE(te_summary.likes, 0)::bigint AS likes,
                COALESCE(te_summary.saves, 0)::bigint AS saves,
                COALESCE(te_summary.dms, 0)::bigint AS dms
            FROM te_summary
            CROSS JOIN credit_summary
            """,
            account_id,
            tenant_id,
            cur_start,
            end_exclusive,
        ),
        pool.fetch(
            f"""
            WITH series AS (
                SELECT generate_series(
                    DATE_TRUNC('day', $3::timestamptz AT TIME ZONE 'Asia/Shanghai'),
                    DATE_TRUNC('day', (($4::timestamptz AT TIME ZONE 'Asia/Shanghai') - INTERVAL '1 microsecond')),
                    INTERVAL '1 day'
                ) AS bucket
            ),
            agg AS (
                SELECT
                    DATE_TRUNC('day', COALESCE(te.finished_at, te.started_at) AT TIME ZONE 'Asia/Shanghai') AS bucket,
                    COUNT(*) FILTER (WHERE {_success_filter_sql('te')})::bigint AS success
                FROM task_execution te
                JOIN users u ON u.id = te.user_id
                WHERE u.id = $1
                  AND u.tenant_id = $2
                  AND COALESCE(te.finished_at, te.started_at) >= $3
                  AND COALESCE(te.finished_at, te.started_at) < $4
                  AND NOT te.is_deleted
                  AND NOT u.is_deleted
                GROUP BY bucket
            )
            SELECT s.bucket, COALESCE(a.success, 0)::bigint AS success
            FROM series s
            LEFT JOIN agg a ON a.bucket = s.bucket
            ORDER BY s.bucket
            """,
            account_id,
            tenant_id,
            cur_start,
            end_exclusive,
        ),
    )

    if not account_row:
        raise ValueError("account not found")

    summary = dict(summary_row or {})
    return {
        "account": {
            "id": str(account_row["id"]),
            "name": account_row["name"] or f"user-{account_row['id']}",
            "role": account_row["role"] or "",
            "platforms": list(account_row["platforms"] or []),
        },
        "summary": {
            "success_count": int(summary.get("success_count") or 0),
            "total_credits": int(summary.get("total_credits") or 0),
            "runtime_h": round(float(summary.get("runtime_h") or 0), 1),
            "reach": int(summary.get("reach") or 0),
            "comments": int(summary.get("comments") or 0),
            "likes": int(summary.get("likes") or 0),
            "saves": int(summary.get("saves") or 0),
            "dms": int(summary.get("dms") or 0),
        },
        "success": [int(row["success"] or 0) for row in series_rows],
    }


async def get_task_week_summary(pool: Pool, task_id: int, tenant_id: int) -> dict[str, Any]:
    now = datetime.now(CN_TZ)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    cur_start = today_start - timedelta(days=6)
    end_exclusive = today_start + timedelta(days=1)

    task_row, summary_row, series_rows = await asyncio.gather(
        pool.fetchrow(
            """
            SELECT
                ut.id,
                ut.task_name AS name,
                ut.created_at,
                COALESCE(platforms.platforms, ARRAY[]::text[]) AS platforms
            FROM user_task ut
            JOIN users u ON u.id = ut.user_id
            LEFT JOIN LATERAL (
                SELECT ARRAY_AGG(DISTINCT platform_key ORDER BY platform_key) AS platforms
                FROM (
                    SELECT CASE p.platform::text
                        WHEN 'XIAOHONGSHU' THEN 'xhs'
                        WHEN 'DOUYIN' THEN 'douyin'
                        WHEN 'KUAISHOU' THEN 'kuaishou'
                        WHEN 'WECHAT' THEN 'wechat'
                        WHEN 'LARK' THEN 'lark'
                        WHEN 'ZOOM' THEN 'zoom'
                        WHEN 'LINKEDIN' THEN 'linkedin'
                        WHEN 'INSTAGRAM' THEN 'instagram'
                        WHEN 'TIKTOK' THEN 'tiktok'
                        WHEN 'X' THEN 'x'
                        WHEN 'REDDIT' THEN 'reddit'
                        WHEN 'PINTEREST' THEN 'pinterest'
                        WHEN 'GENERAL_APP' THEN 'general_app'
                        ELSE LOWER(p.platform::text)
                    END AS platform_key
                    FROM UNNEST(COALESCE(ut.related_platforms, ARRAY[]::platformtype[])) AS p(platform)
                ) platform_rows
            ) platforms ON TRUE
            WHERE ut.id = $1
              AND u.tenant_id = $2
              AND NOT ut.is_deleted
              AND NOT u.is_deleted
            """,
            task_id,
            tenant_id,
        ),
        pool.fetchrow(
            f"""
            WITH task_te_agg AS (
                SELECT
                    COUNT(te.id) FILTER (WHERE {_success_filter_sql('te')})::bigint AS success_count,
                    COALESCE(SUM(EXTRACT(EPOCH FROM (te.finished_at - te.started_at))), 0)::float / 3600 AS runtime_h,
                    COALESCE(SUM(ebs.unique_reach), 0)::bigint AS reach,
                    COALESCE(SUM(ebs.comment_count), 0)::bigint AS comments,
                    COALESCE(SUM(ebs.like_count), 0)::bigint AS likes,
                    COALESCE(SUM(ebs.collect_count), 0)::bigint AS saves,
                    COALESCE(SUM(ebs.dm_count), 0)::bigint AS dms,
                    BOOL_OR(
                        COALESCE(ebs.unique_reach, 0) > 0
                        OR COALESCE(ebs.comment_count, 0) > 0
                        OR COALESCE(ebs.like_count, 0) > 0
                        OR COALESCE(ebs.collect_count, 0) > 0
                        OR COALESCE(ebs.dm_count, 0) > 0
                    ) AS has_engagement
                FROM task_execution te
                JOIN user_task ut ON ut.id = te.task_id
                JOIN users u ON u.id = te.user_id
                LEFT JOIN execution_behavior_stat ebs ON ebs.execution_id = te.id
                WHERE te.task_id = $1
                  AND u.tenant_id = $2
                  AND COALESCE(te.finished_at, te.started_at) >= $3
                  AND COALESCE(te.finished_at, te.started_at) < $4
                  AND NOT ut.is_deleted
                  AND NOT te.is_deleted
                  AND NOT u.is_deleted
            ),
            task_credit_agg AS (
                SELECT
                    COALESCE(SUM(ur.credits_used), 0)::bigint AS credits
                FROM task_execution te
                JOIN user_task ut ON ut.id = te.task_id
                JOIN users u ON u.id = te.user_id
                LEFT JOIN usage_record ur
                    -- schema mismatch: usage_record.task_id is varchar while task_execution.id is int; a future migration should align these column types.
                    ON ur.task_id = te.id::varchar
                WHERE te.task_id = $1
                  AND u.tenant_id = $2
                  AND COALESCE(ur.end_time, ur.start_time, ur.created_at) >= $3
                  AND COALESCE(ur.end_time, ur.start_time, ur.created_at) < $4
                  AND NOT ut.is_deleted
                  AND NOT te.is_deleted
                  AND NOT u.is_deleted
            )
            SELECT
                COALESCE(task_te_agg.success_count, 0)::bigint AS success_count,
                COALESCE(task_credit_agg.credits, 0)::bigint AS total_credits,
                COALESCE(task_te_agg.runtime_h, 0)::float AS runtime_h,
                COALESCE(task_te_agg.reach, 0)::bigint AS reach,
                COALESCE(task_te_agg.comments, 0)::bigint AS comments,
                COALESCE(task_te_agg.likes, 0)::bigint AS likes,
                COALESCE(task_te_agg.saves, 0)::bigint AS saves,
                COALESCE(task_te_agg.dms, 0)::bigint AS dms,
                COALESCE(task_te_agg.has_engagement, FALSE) AS has_engagement
            FROM task_te_agg
            CROSS JOIN task_credit_agg
            """,
            task_id,
            tenant_id,
            cur_start,
            end_exclusive,
        ),
        pool.fetch(
            f"""
            WITH date_buckets AS (
                SELECT generate_series(
                    DATE_TRUNC('day', $3::timestamptz AT TIME ZONE 'Asia/Shanghai'),
                    DATE_TRUNC('day', (($4::timestamptz AT TIME ZONE 'Asia/Shanghai') - INTERVAL '1 microsecond')),
                    INTERVAL '1 day'
                ) AS bucket
            ),
            task_te_agg AS (
                SELECT
                    DATE_TRUNC('day', COALESCE(te.finished_at, te.started_at) AT TIME ZONE 'Asia/Shanghai') AS bucket,
                    COUNT(*) FILTER (WHERE {_success_filter_sql('te')})::bigint AS success
                FROM task_execution te
                JOIN user_task ut ON ut.id = te.task_id
                JOIN users u ON u.id = te.user_id
                WHERE te.task_id = $1
                  AND u.tenant_id = $2
                  AND COALESCE(te.finished_at, te.started_at) >= $3
                  AND COALESCE(te.finished_at, te.started_at) < $4
                  AND NOT ut.is_deleted
                  AND NOT te.is_deleted
                  AND NOT u.is_deleted
                GROUP BY bucket
            )
            SELECT d.bucket, COALESCE(a.success, 0)::bigint AS success
            FROM date_buckets d
            LEFT JOIN task_te_agg a ON a.bucket = d.bucket
            ORDER BY d.bucket
            """,
            task_id,
            tenant_id,
            cur_start,
            end_exclusive,
        ),
    )

    if not task_row:
        raise ValueError("task not found")

    summary = dict(summary_row or {})
    created_at_value = task_row["created_at"]
    created_at = created_at_value.isoformat() if created_at_value else ""
    return {
        "task_info": {
            "id": int(task_row["id"]),
            "name": task_row["name"] or f"task-{task_row['id']}",
            "category": "acquire" if summary.get("has_engagement") else "ops",
            "created_at": created_at,
            "platforms": list(task_row["platforms"] or []),
        },
        "summary": {
            "success_count": int(summary.get("success_count") or 0),
            "total_credits": int(summary.get("total_credits") or 0),
            "runtime_h": round(float(summary.get("runtime_h") or 0), 1),
            "reach": int(summary.get("reach") or 0),
        },
        "success": [int(row["success"] or 0) for row in series_rows],
    }


async def _actual_get_audit_log(
    pool: Pool,
    tenant_id: int,
    page: int = 1,
    page_size: int = 20,
    member_id: int | None = None,
    action: str | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    keyword: str | None = None,
) -> dict[str, Any]:
    offset = (page - 1) * page_size
    where_clause, query_args = _build_audit_log_where_clause(
        tenant_id, member_id, action, start_date, end_date, keyword,
    )
    total = await pool.fetchval(
        f"SELECT COUNT(*)::bigint FROM enterprise_audit_log {where_clause}",
        *query_args,
    )
    limit_index = len(query_args) + 1
    offset_index = len(query_args) + 2
    rows = await pool.fetch(
        """SELECT id, operator_id, operator_name, action, target_user_id, target_user_name,
                  credits_amount, before_snapshot, after_snapshot, remark, created_at
           FROM enterprise_audit_log {where_clause}
           ORDER BY created_at DESC LIMIT {limit_param} OFFSET {offset_param}""".format(
            where_clause=where_clause,
            limit_param=f"${limit_index}",
            offset_param=f"${offset_index}",
        ),
        *query_args, page_size, offset,
    )
    items = []
    for row in rows:
        item = dict(row)
        if item.get("created_at"):
            item["created_at"] = item["created_at"].isoformat()
        items.append(item)
    return {"items": items, "total": total}


async def get_audit_log(
    pool,
    tenant_id,
    page=1,
    page_size=20,
    member_id=None,
    action=None,
    start_date=None,
    end_date=None,
    keyword=None,
):
    cache_key = (
        tenant_id,
        page,
        page_size,
        member_id,
        action,
        start_date,
        end_date,
        keyword,
    )
    cached_audit_log = _oplog_cache.get(cache_key, _CACHE_MISS)
    if cached_audit_log is not _CACHE_MISS:
        return cached_audit_log

    async with _oplog_cache_lock:
        cached_audit_log = _oplog_cache.get(cache_key, _CACHE_MISS)
        if cached_audit_log is not _CACHE_MISS:
            return cached_audit_log

        audit_log = await _actual_get_audit_log(
            pool,
            tenant_id,
            page,
            page_size,
            member_id,
            action,
            start_date,
            end_date,
            keyword,
        )
        _oplog_cache[cache_key] = audit_log
        return audit_log


async def distribute_credits(pool: Pool, operator_id: int, target_user_id: int, amount: int, remark: str, api_tenant_id: int) -> None:
    async with pool.acquire() as conn:
        async with conn.transaction():
            op_user = await conn.fetchrow(
                'SELECT id, name, tenant_id, "phoneNumber" FROM users WHERE id = $1 AND tenant_id = $2 AND NOT is_deleted',
                operator_id, api_tenant_id,
            )
            if not op_user:
                raise ValueError("operator not found")

            tgt_user = await conn.fetchrow(
                'SELECT id, name, tenant_id, "phoneNumber" FROM users WHERE id = $1 AND tenant_id = $2 AND NOT is_deleted',
                target_user_id, api_tenant_id,
            )
            if not tgt_user:
                raise ValueError("target user not found")

            if op_user["tenant_id"] != tgt_user["tenant_id"]:
                raise ValueError("operator and target must belong to the same tenant")

            tenant_id = op_user["tenant_id"]

            balance_row = await conn.fetchrow(
                'SELECT remaining, version FROM user_balance WHERE user_id = $1',
                operator_id,
            )
            if not balance_row:
                raise ValueError("operator has no balance record")

            if balance_row["remaining"] < amount:
                raise ValueError("insufficient balance")

            version = balance_row["version"]
            updated = await conn.fetchval(
                'UPDATE user_balance SET remaining = remaining - $1, version = version + 1 WHERE user_id = $2 AND version = $3 RETURNING id',
                amount, operator_id, version,
            )
            if not updated:
                raise ValueError("concurrent modification detected, please retry")

            tgt_updated = await conn.fetchval(
                'UPDATE user_balance SET remaining = remaining + $1, version = version + 1 WHERE user_id = $2 RETURNING id',
                amount, target_user_id,
            )
            if not tgt_updated:
                raise ValueError("target user has no balance record")

            op_balance_after = await conn.fetchval(
                'SELECT remaining FROM user_balance WHERE user_id = $1',
                operator_id,
            )
            tgt_balance_after = await conn.fetchval(
                'SELECT remaining FROM user_balance WHERE user_id = $1',
                target_user_id,
            )

            await conn.execute(
                """
                INSERT INTO credit_flow (user_id, change_type, change_amount, balance_after, remark)
                VALUES ($1, 'DISTRIBUTE', $2, $3, $4)
                """,
                operator_id, -amount, op_balance_after, remark or f"分发给 {tgt_user['name']}",
            )
            await conn.execute(
                """
                INSERT INTO credit_flow (user_id, change_type, change_amount, balance_after, remark)
                VALUES ($1, 'DISTRIBUTE', $2, $3, $4)
                """,
                target_user_id, amount, tgt_balance_after, remark or f"来自 {op_user['name']} 的分发",
            )

            await conn.execute(
                """
                INSERT INTO enterprise_audit_log
                    (operator_id, operator_name, tenant_id, action, target_user_id, target_user_name, credits_amount, remark)
                VALUES ($1, $2, $3, 'TRANSFER_CREDITS', $4, $5, $6, $7)
                """,
                operator_id, op_user["name"], tenant_id,
                target_user_id, tgt_user["name"], amount, remark,
            )

            await conn.execute(
                """
                INSERT INTO enterprise_recharge_record
                    (operator_id, operator_name, target_user_id, target_user_phone, target_user_name, target_tenant_id, credits_amount, remark)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                """,
                operator_id, op_user["name"],
                target_user_id,
                tgt_user["phoneNumber"],
                tgt_user["name"],
                tenant_id, amount, remark,
            )
    _snapshot_cache.clear()
    _tx_cache.clear()
    _oplog_cache.clear()


async def update_member(pool: Pool, user_id: int, tenant_id: int, name: str | None, phone_number: str | None, role: str | None) -> None:
    async with pool.acquire() as conn:
        async with conn.transaction():
            before = await conn.fetchrow(
                'SELECT id, name, "phoneNumber", role FROM users WHERE id = $1 AND tenant_id = $2 AND NOT is_deleted',
                user_id, tenant_id,
            )
            if not before:
                raise ValueError("user not found")

            await conn.execute(
                """
                UPDATE users
                SET name = COALESCE($1, name),
                    "phoneNumber" = COALESCE($2, "phoneNumber"),
                    role = COALESCE($3, role)
                WHERE id = $4 AND tenant_id = $5 AND NOT is_deleted
                """,
                name, phone_number, role, user_id, tenant_id,
            )

            after = await conn.fetchrow(
                'SELECT id, name, "phoneNumber", role FROM users WHERE id = $1',
                user_id,
            )

            await conn.execute(
                """
                INSERT INTO enterprise_audit_log
                    (operator_id, operator_name, tenant_id, action, target_user_id, target_user_name, before_snapshot, after_snapshot)
                VALUES ($1, $2, $3, 'MEMBER_UPDATE', $4, $5, $6, $7)
                """,
                user_id, before["name"], tenant_id,
                user_id, after["name"],
                json.dumps(dict(before), default=str),
                json.dumps(dict(after), default=str),
            )
    _snapshot_cache.clear()
    _tx_cache.clear()
    _oplog_cache.clear()


async def delete_member(pool: Pool, user_id: int, tenant_id: int) -> None:
    async with pool.acquire() as conn:
        async with conn.transaction():
            user = await conn.fetchrow(
                'SELECT id, name FROM users WHERE id = $1 AND tenant_id = $2 AND NOT is_deleted',
                user_id, tenant_id,
            )
            if not user:
                raise ValueError("user not found")

            await conn.execute(
                'UPDATE users SET is_deleted = true, is_active = false WHERE id = $1 AND tenant_id = $2',
                user_id, tenant_id,
            )

            await conn.execute(
                """
                INSERT INTO enterprise_audit_log
                    (operator_id, operator_name, tenant_id, action, target_user_id, target_user_name)
                VALUES ($1, $2, $3, 'REMOVE_MEMBER', $4, $5)
                """,
                user_id, user["name"], tenant_id, user_id, user["name"],
            )
    _snapshot_cache.clear()
    _tx_cache.clear()
    _oplog_cache.clear()


async def add_member(pool: Pool, name: str, phone_number: str, role: str | None, initial_balance: int, tenant_id: int) -> int:
    async with pool.acquire() as conn:
        async with conn.transaction():
            role_value = role or "member"
            new_id = await conn.fetchval(
                """
                INSERT INTO users (name, email, "emailVerified", "phoneNumber", role, tenant_id,
                                   is_deleted, is_active, "createdAt", "updatedAt")
                VALUES ($1, $2, false, $3, $4, $5, false, true, NOW(), NOW())
                RETURNING id
                """,
                name, f"{phone_number}+{int(__import__('time').time())}@placeholder.local", phone_number, role_value, tenant_id,
            )

            await conn.execute(
                'INSERT INTO user_balance (user_id, remaining) VALUES ($1, $2)',
                new_id, initial_balance,
            )

            if initial_balance > 0:
                await conn.execute(
                    """
                    INSERT INTO credit_flow (user_id, change_type, change_amount, balance_after, remark)
                    VALUES ($1, 'RECHARGE', $2, $3, '新成员初始余额')
                    """,
                    new_id, initial_balance, initial_balance,
                )

            await conn.execute(
                """
                INSERT INTO enterprise_audit_log
                    (operator_id, operator_name, tenant_id, action, target_user_id, target_user_name, credits_amount)
                VALUES ($1, $2, $3, 'ADD_MEMBER', $4, $5, $6)
                """,
                new_id, name, tenant_id, new_id, name, initial_balance,
            )
    _snapshot_cache.clear()
    _tx_cache.clear()
    _oplog_cache.clear()
    return new_id
