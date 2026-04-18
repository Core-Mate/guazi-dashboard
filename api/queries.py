from __future__ import annotations

import asyncio
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from asyncpg import Pool

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

CATEGORY_META = {
    "acquire": {"label": "🎯 获客触达", "emoji": "🎯", "color": "#ff6900"},
    "research": {"label": "📊 内容调研", "emoji": "📊", "color": "#4caf50"},
    "ops": {"label": "🛠️ 运营协作", "emoji": "🛠️", "color": "#2196f3"},
}

# 把 user_task.category (DB enum: taskcategory) 映射到 dashboard 三大组
# DB enum 实际值: CONTENT_PUBLISH, SOCIAL_INTERACT, AUTO_REPLY, DATA_COLLECT, CUSTOM
CATEGORY_GROUP = {
    "CONTENT_PUBLISH": "acquire",
    "SOCIAL_INTERACT": "acquire",
    "AUTO_REPLY": "acquire",
    "DATA_COLLECT": "ops",
    "CUSTOM": "ops",
}

TASK_GROUP_LABEL = {
    "acquire": "获客触达",
    "research": "内容调研",
    "ops": "运营协作",
}

ACQUIRE_TASK_PATTERN = re.compile(r"SOCIAL_INTERACT|AUTO_REPLY|CONTENT_PUBLISH", re.IGNORECASE)
OPS_TASK_PATTERN = re.compile(r"发布|群发|自动回复|回复|发帖")


def _infer_task_group(category: Any, task_name: Any) -> str:
    category_key = str(category or "").strip().upper()
    if category_key:
        return CATEGORY_GROUP.get(category_key, "research")

    name = str(task_name or "")
    if ACQUIRE_TASK_PATTERN.search(name):
        return "acquire"
    if OPS_TASK_PATTERN.search(name):
        return "ops"
    return CATEGORY_GROUP.get(category_key, "research")


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
        end_is_date_only = "T" not in end and ":" not in end
        if cur_start.tzinfo is None:
            cur_start = cur_start.replace(tzinfo=CN_TZ)
        if cur_end.tzinfo is None:
            cur_end = cur_end.replace(tzinfo=CN_TZ)
        if end_is_date_only:
            cur_end = cur_end + timedelta(days=1)
        length = cur_end - cur_start
        prev_end = cur_start
        prev_start = cur_start - length
        days = max(1, length.days or 1)
        return (cur_start, cur_end, prev_start, prev_end, "较前期", "day", days)

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
        agg AS (
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
            LEFT JOIN execution_behavior_stat ebs ON ebs.execution_id = te.id
            JOIN users u ON u.id = te.user_id
            WHERE u.tenant_id = $1
              AND COALESCE(te.finished_at, te.started_at) >= $2
              AND COALESCE(te.finished_at, te.started_at) < $3
              AND NOT te.is_deleted
              AND NOT u.is_deleted
            GROUP BY bucket
        )
        SELECT s.bucket,
               COALESCE(a.executions, 0)::bigint AS executions,
               COALESCE(a.successes, 0)::bigint AS successes,
               COALESCE(a.comments, 0)::bigint AS comments,
               COALESCE(a.likes, 0)::bigint AS likes,
               COALESCE(a.saves, 0)::bigint AS saves,
               COALESCE(a.dms, 0)::bigint AS dms,
               COALESCE(a.reach, 0)::bigint AS reach
        FROM series s
        LEFT JOIN agg a ON a.bucket = s.bucket
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
        SELECT
            COUNT(*)::bigint AS executions,
            COUNT(*) FILTER (WHERE {_success_filter_sql('te')})::bigint AS successes,
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


def _series_stats(values: list[int]) -> dict[str, int]:
    if not values:
        return {"avg": 0, "peak": 0}
    total = sum(values)
    avg = round(total / len(values))
    peak = max(values)
    return {"avg": avg, "peak": peak}


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
    cur_start, cur_end, prev_start, prev_end, compare_label, unit, _ = _window or _resolve_window(range_param, start, end)

    bucket_rows, prev_totals = await asyncio.gather(
        _fetch_metric_buckets(pool, tenant_id, cur_start, cur_end, unit),
        _resolve_async_value(
            _prev_totals
            if _prev_totals is not None
            else _fetch_period_totals(pool, tenant_id, prev_start, prev_end)
        ),
    )

    labels = [_bucket_label(r["bucket"], unit) for r in bucket_rows]
    bucket_key_map = {"successCount": "successes"}

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
            "stats": _series_stats(values),
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

    account_rows, credit_rows, skill_rows, skill_credit_rows, device_rows, device_credit_rows, heat_rows = await asyncio.gather(
        pool.fetch(
            f"""
            SELECT u.id AS user_id,
                   u.name AS username,
                   u.role,
                   MAX(te.device_id) AS device_id,
                   COUNT(te.id)::bigint AS exec_count,
                   COUNT(te.id) FILTER (WHERE {_success_filter_sql('te')})::bigint AS success_count,
                   COALESCE(SUM(EXTRACT(EPOCH FROM (te.finished_at - te.started_at))), 0)::float AS duration_sec,
                   COALESCE(SUM(ebs.comment_count), 0)::bigint AS comments,
                   COALESCE(SUM(ebs.like_count), 0)::bigint AS likes,
                   COALESCE(SUM(ebs.collect_count), 0)::bigint AS saves,
                   COALESCE(SUM(ebs.dm_count), 0)::bigint AS dms,
                   COALESCE(SUM(ebs.unique_reach), 0)::bigint AS reach
            FROM users u
            LEFT JOIN task_execution te ON te.user_id = u.id
                AND COALESCE(te.finished_at, te.started_at) >= $2
                AND COALESCE(te.finished_at, te.started_at) < $3
                AND NOT te.is_deleted
            LEFT JOIN execution_behavior_stat ebs ON ebs.execution_id = te.id
            WHERE u.tenant_id = $1 AND NOT u.is_deleted
            GROUP BY u.id, u.name, u.role
            ORDER BY exec_count DESC
            """,
            tenant_id, cur_start, cur_end,
        ),
        pool.fetch(
            """
            SELECT cf.user_id, COALESCE(SUM(ABS(cf.change_amount)), 0)::bigint AS credits
            FROM credit_flow cf
            JOIN users u ON u.id = cf.user_id
            WHERE u.tenant_id = $1 AND cf.change_type = 'CONSUME'
              AND cf.created_at >= $2
              AND cf.created_at < $3
              AND NOT u.is_deleted
            GROUP BY cf.user_id
            """,
            tenant_id, cur_start, cur_end,
        ),
        pool.fetch(
            f"""
            SELECT ut.id AS skill_id,
                   ut.task_name AS skill_name,
                   ut.category,
                   CASE
                       WHEN (
                           COALESCE(SUM(ebs.comment_count), 0) +
                           COALESCE(SUM(ebs.like_count), 0) +
                           COALESCE(SUM(ebs.collect_count), 0) +
                           COALESCE(SUM(ebs.dm_count), 0) +
                           COALESCE(SUM(ebs.unique_reach), 0)
                       ) > 0 THEN 'acquire'
                       ELSE 'ops'
                   END AS task_group,
                   ut.related_platforms,
                   ut.task_description AS description,
                   COUNT(te.id)::bigint AS exec_count,
                   COUNT(te.id) FILTER (WHERE {_success_filter_sql('te')})::bigint AS success_count,
                   COUNT(te.id) FILTER (WHERE te.execution_result = 'FAILED')::bigint AS fail_count,
                   COALESCE(SUM(EXTRACT(EPOCH FROM (te.finished_at - te.started_at))), 0)::float AS duration_sec,
                   COALESCE(SUM(ebs.comment_count), 0)::bigint AS comments,
                   COALESCE(SUM(ebs.like_count), 0)::bigint AS likes,
                   COALESCE(SUM(ebs.collect_count), 0)::bigint AS saves,
                   COALESCE(SUM(ebs.dm_count), 0)::bigint AS dms,
                   COALESCE(SUM(ebs.unique_reach), 0)::bigint AS reach
            FROM user_task ut
            LEFT JOIN task_execution te ON te.task_id = ut.id
                AND COALESCE(te.finished_at, te.started_at) >= $2
                AND COALESCE(te.finished_at, te.started_at) < $3
                AND NOT te.is_deleted
            LEFT JOIN execution_behavior_stat ebs ON ebs.execution_id = te.id
            JOIN users u ON u.id = ut.user_id
            WHERE u.tenant_id = $1 AND NOT ut.is_deleted AND NOT u.is_deleted
            GROUP BY ut.id, ut.task_name, ut.category, ut.related_platforms, ut.task_description
            HAVING COUNT(te.id) > 0
            ORDER BY exec_count DESC
            """,
            tenant_id, cur_start, cur_end,
        ),
        pool.fetch(
            """
            SELECT te.task_id AS skill_id,
                   COALESCE(SUM(ABS(cf.change_amount)) FILTER (WHERE cf.change_type = 'CONSUME'), 0)::bigint AS total_credits
            FROM task_execution te
            JOIN users u ON u.id = te.user_id
            LEFT JOIN usage_record ur ON ur.task_id = te.id::varchar
            LEFT JOIN credit_flow cf ON cf.ref_type = 'usage'
                                     AND cf.ref_id ~ '^[0-9]+$'
                                     AND CASE WHEN cf.ref_id ~ '^[0-9]+$' THEN cf.ref_id::int END = ur.id
            WHERE u.tenant_id = $1
              AND te.task_id IS NOT NULL
              AND COALESCE(te.finished_at, te.started_at) >= $2
              AND COALESCE(te.finished_at, te.started_at) < $3
              AND NOT te.is_deleted
              AND NOT u.is_deleted
            GROUP BY te.task_id
            """,
            tenant_id, cur_start, cur_end,
        ),
        pool.fetch(
            f"""
            SELECT te.device_id,
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
              AND NOT te.is_deleted AND NOT u.is_deleted
            GROUP BY te.device_id
            ORDER BY exec_count DESC
            """,
            tenant_id, cur_start, cur_end,
        ),
        pool.fetch(
            """
            SELECT te.device_id,
                   COALESCE(SUM(ABS(cf.change_amount)) FILTER (WHERE cf.change_type = 'CONSUME'), 0)::bigint AS total_credits
            FROM task_execution te
            JOIN users u ON u.id = te.user_id
            LEFT JOIN usage_record ur ON ur.task_id = te.id::varchar
            LEFT JOIN credit_flow cf ON cf.ref_type = 'usage'
                                     AND cf.ref_id ~ '^[0-9]+$'
                                     AND CASE WHEN cf.ref_id ~ '^[0-9]+$' THEN cf.ref_id::int END = ur.id
            WHERE u.tenant_id = $1
              AND te.device_id IS NOT NULL
              AND COALESCE(te.finished_at, te.started_at) >= $2
              AND COALESCE(te.finished_at, te.started_at) < $3
              AND NOT te.is_deleted
              AND NOT u.is_deleted
            GROUP BY te.device_id
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
    credits_by_user = {r["user_id"]: int(r["credits"]) for r in credit_rows}
    skill_credits_by_id = {r["skill_id"]: int(r["total_credits"]) for r in skill_credit_rows}
    device_credits_by_id = {r["device_id"]: int(r["total_credits"]) for r in device_credit_rows}

    accounts = []
    for r in account_rows:
        accounts.append({
            "id": r["user_id"],
            "user_id": r["user_id"],
            "username": r["username"] or f"user-{r['user_id']}",
            "role": r["role"],
            "device_id": r["device_id"],
            "token_used": credits_by_user.get(r["user_id"], 0),
            "success_count": int(r["success_count"]),
            "exec_count": int(r["exec_count"]),
            "duration_sec": int(r["duration_sec"]),
            "comments": int(r["comments"]),
            "likes": int(r["likes"]),
            "saves": int(r["saves"]),
            "dms": int(r["dms"]),
            "reach": int(r["reach"]),
        })

    account_totals = {
        "accounts": len([a for a in accounts if a["exec_count"] > 0]),
        "success_count": sum(a["success_count"] for a in accounts),
        "reach": sum(a["reach"] for a in accounts),
        "dms": sum(a["dms"] for a in accounts),
        "comments": sum(a["comments"] for a in accounts),
        "credits": sum(a["token_used"] for a in accounts),
    }

    # 按 execution_behavior_stat 行为数据动态分组
    groups: dict[str, dict[str, Any]] = {}
    for k, meta in CATEGORY_META.items():
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
            "skill_id": f"S{r['skill_id']}",
            "skill_name": r["skill_name"],
            "description": r["description"] or "",
            "category": r["category"],
            "task_group": group_key,
            "exec": int(r["exec_count"]),
            "success_count": int(r["success_count"]),
            "fail": int(r["fail_count"]),
            "duration_sec": int(r["duration_sec"]),
            "comments": int(r["comments"]),
            "likes": int(r["likes"]),
            "saves": int(r["saves"]),
            "dms": int(r["dms"]),
            "reach": int(r["reach"]),
            "total_credits": skill_credits_by_id.get(r["skill_id"], 0),
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
            "duration_sec": int(r["duration_sec"]),
            "token_usage": 0,  # 算力豆按 user 算，device 维度暂不归属
            "comments": int(r["comments"]),
            "likes": int(r["likes"]),
            "saves": int(r["saves"]),
            "dms": int(r["dms"]),
            "reach": int(r["reach"]),
            "total_credits": device_credits_by_id.get(r["device_id"], 0),
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

    platform_rows, cur_totals, cur_credits, duration_row, prev_totals, prev_credits, prev_duration_row = await asyncio.gather(
        pool.fetch(
            """
            SELECT COALESCE(ebs.platform::text, 'OTHER') AS platform,
                   COALESCE(SUM(ebs.unique_reach), 0)::bigint AS reach
            FROM task_execution te
            LEFT JOIN execution_behavior_stat ebs ON ebs.execution_id = te.id
            JOIN users u ON u.id = te.user_id
            WHERE u.tenant_id = $1
              AND COALESCE(te.finished_at, te.started_at) >= $2
              AND COALESCE(te.finished_at, te.started_at) < $3
              AND NOT te.is_deleted AND NOT u.is_deleted
            GROUP BY ebs.platform
            HAVING COALESCE(SUM(ebs.unique_reach), 0) > 0
            ORDER BY reach DESC
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

    interaction_breakdown = [
        {"key": k, "name": label, "value": int(cur_totals.get(k, 0)), "color": color}
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
        "runtime": f"{runtime_h}h",
        "runtime_raw": runtime_h,
        "runtime_prev": prev_runtime_h,
        "runtime_sec": runtime_sec,
        "runtime_prev_sec": runtime_prev_sec,
        "cost": f"{cur_credits:,}",
        "cost_raw": cur_credits,
        "cost_prev": prev_credits,
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

async def aggregate_snapshot(
    pool: Pool,
    tenant_id: int,
    range_param: str,
    start: Optional[str] = None,
    end: Optional[str] = None,
) -> dict[str, Any]:
    window = _resolve_window(range_param, start, end)
    cur_start, cur_end, prev_start, prev_end, _, _, _ = window
    cur_totals_task = asyncio.create_task(_fetch_period_totals(pool, tenant_id, cur_start, cur_end))
    prev_totals_task = asyncio.create_task(_fetch_period_totals(pool, tenant_id, prev_start, prev_end))
    cur_credits_task = asyncio.create_task(_fetch_period_credits(pool, tenant_id, cur_start, cur_end))
    prev_credits_task = asyncio.create_task(_fetch_period_credits(pool, tenant_id, prev_start, prev_end))

    highlights, achievements, aggs, charts = await asyncio.gather(
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
    )
    return {
        "range": range_param,
        "highlights": highlights,
        "achievements": achievements,
        "aggs": aggs,
        "charts": charts,
    }


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

    execution_row = await pool.fetchrow(
        f"""
        SELECT
            COUNT(*)::bigint AS total_executions,
            COUNT(*) FILTER (WHERE {_success_filter_sql('te')})::bigint AS success_count,
            COUNT(*) FILTER (WHERE te.execution_result = 'FAILED')::bigint AS fail_count,
            COUNT(DISTINCT te.user_id)::bigint AS active_users,
            COALESCE(SUM(EXTRACT(EPOCH FROM (te.finished_at - te.started_at)))/3600, 0)::float AS total_duration_hours
        FROM task_execution te
        JOIN users u ON u.id = te.user_id
        WHERE te.started_at > NOW() - INTERVAL '{interval_literal}'
          AND u.tenant_id = $1
          AND NOT u.is_deleted
        """,
        tenant_id,
    )
    credit_row = await pool.fetchrow(
        f"""
        SELECT COALESCE(SUM(cf.change_amount), 0) AS total_credits_consumed
        FROM credit_flow cf
        JOIN users u ON u.id = cf.user_id
        WHERE cf.change_type = 'CONSUME'
          AND cf.created_at > NOW() - INTERVAL '{interval_literal}'
          AND u.tenant_id = $1
          AND NOT u.is_deleted
        """,
        tenant_id,
    )

    return {
        "total_executions": execution_row["total_executions"],
        "success_count": execution_row["success_count"],
        "fail_count": execution_row["fail_count"],
        "total_credits_consumed": float(credit_row["total_credits_consumed"]),
        "active_users": execution_row["active_users"],
        "total_duration_hours": float(execution_row["total_duration_hours"]),
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
        "runtime": [round(float(row["runtime_h"] or 0), 1) for row in rows],
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
            ut.category,
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
                COUNT(*) FILTER (WHERE te.execution_result = 'FAILED')::bigint AS fail_count
            FROM task_execution te
            JOIN users u ON u.id = te.user_id
            WHERE u.tenant_id = $1 AND NOT u.is_deleted
            GROUP BY te.task_id
        ) AS exec_stats
            ON exec_stats.task_id = ut.id
        WHERE NOT ut.is_deleted
        ORDER BY total_executions DESC, ut.task_name
        LIMIT 50
        """,
        tenant_id,
    )

    items: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        raw_task_name = item.get("task_name")
        group_key = _infer_task_group(item.get("category"), raw_task_name)
        item["task_detail_name"] = raw_task_name
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


async def get_transactions(pool: Pool, page: int, page_size: int, tenant_id: int) -> dict[str, Any]:
    offset = (page - 1) * page_size

    union_cte = """
        SELECT
            'CONSUME'::text AS change_type,
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
        LEFT JOIN usage_record ur
            ON cf.ref_type = 'usage'
            AND cf.ref_id ~ '^[0-9]+$'
            AND CASE WHEN cf.ref_id ~ '^[0-9]+$' THEN cf.ref_id::int END = ur.id
        LEFT JOIN task_execution te ON ur.task_id = te.id::varchar
        LEFT JOIN user_task ut ON te.task_id = ut.id
        WHERE cf.change_type = 'CONSUME'
          AND u.tenant_id = $1
          AND NOT u.is_deleted
        GROUP BY te.id, ut.task_name, u.name

        UNION ALL

        SELECT
            cf.change_type::text,
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
        f"SELECT COUNT(*)::bigint AS total FROM ({union_cte}) sub",
        tenant_id,
    )

    rows = await pool.fetch(
        f"""
        SELECT * FROM ({union_cte}) sub
        ORDER BY ended_at DESC NULLS LAST
        LIMIT $2 OFFSET $3
        """,
        tenant_id,
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
            WHERE u.tenant_id = $1 AND NOT u.is_deleted
            GROUP BY te.task_id
        ) es ON ut.id = es.task_id
        WHERE NOT ut.is_deleted
        ORDER BY total_executions DESC
        LIMIT 50
        """,
        tenant_id,
    )
    return [dict(row) for row in rows]


async def get_accounts(pool: Pool, tenant_id: int) -> list[dict[str, Any]]:
    rows = await pool.fetch(
        f"""
        SELECT u.id, u.name AS username,
               COALESCE(es.exec_count, 0)::bigint AS exec_count,
               COALESCE(es.success_count, 0)::bigint AS success_count,
               COALESCE(es.duration_hours, 0)::float AS duration_hours,
               COALESCE(cs.total_credits, 0)::float AS total_credits
        FROM users u
        LEFT JOIN (
            SELECT te.user_id,
                   COUNT(*)::bigint AS exec_count,
                   COUNT(*) FILTER (WHERE {_success_filter_sql('te')})::bigint AS success_count,
                   SUM(EXTRACT(EPOCH FROM (te.finished_at - te.started_at)))/3600 AS duration_hours
            FROM task_execution te
            GROUP BY te.user_id
        ) es ON u.id = es.user_id
        LEFT JOIN (
            SELECT te.user_id,
                   COALESCE(SUM(ABS(cf.change_amount)), 0) AS total_credits
            FROM task_execution te
            LEFT JOIN usage_record ur ON ur.task_id = te.id::varchar
            LEFT JOIN credit_flow cf ON cf.ref_type = 'usage'
                                     AND cf.ref_id ~ '^[0-9]+$'
                                     AND CASE WHEN cf.ref_id ~ '^[0-9]+$' THEN cf.ref_id::int END = ur.id
                                     AND cf.change_type = 'CONSUME'
            GROUP BY te.user_id
        ) cs ON u.id = cs.user_id
        WHERE NOT u.is_deleted AND u.tenant_id = $1
        ORDER BY exec_count DESC
        """,
        tenant_id,
    )
    result = []
    for row in rows:
        item = dict(row)
        hours = item.pop("duration_hours", 0) or 0
        item["duration"] = f"{hours:.1f}h"
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
                    COUNT(te.id) FILTER (WHERE {_success_filter_sql('te')})::bigint AS complete,
                    COALESCE(SUM(EXTRACT(EPOCH FROM (te.finished_at - te.started_at))), 0)::float / 3600 AS runtime_h,
                    COALESCE(SUM(ebs.unique_reach), 0)::bigint AS reach,
                    COALESCE(SUM(ebs.comment_count), 0)::bigint AS comment,
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
                                         AND CASE WHEN cf.ref_id ~ '^[0-9]+$' THEN cf.ref_id::int END = ur.id
                                         AND cf.change_type = 'CONSUME'
                WHERE u.id = $1
                  AND u.tenant_id = $2
                  AND COALESCE(ur.end_time, ur.start_time, ur.created_at) >= $3
                  AND COALESCE(ur.end_time, ur.start_time, ur.created_at) < $4
                  AND NOT u.is_deleted
            )
            SELECT
                COALESCE(te_summary.complete, 0)::bigint AS complete,
                COALESCE(credit_summary.credits, 0)::bigint AS credits,
                COALESCE(te_summary.runtime_h, 0)::float AS runtime_h,
                COALESCE(te_summary.reach, 0)::bigint AS reach,
                COALESCE(te_summary.comment, 0)::bigint AS comment,
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
                    COUNT(*) FILTER (WHERE {_success_filter_sql('te')})::bigint AS complete
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
            SELECT s.bucket, COALESCE(a.complete, 0)::bigint AS complete
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
            "dept": "",
            "platforms": list(account_row["platforms"] or []),
        },
        "summary": {
            "complete": int(summary.get("complete") or 0),
            "credits": int(summary.get("credits") or 0),
            "runtime_h": round(float(summary.get("runtime_h") or 0), 1),
            "reach": int(summary.get("reach") or 0),
            "comment": int(summary.get("comment") or 0),
            "likes": int(summary.get("likes") or 0),
            "saves": int(summary.get("saves") or 0),
            "dms": int(summary.get("dms") or 0),
        },
        "complete_series": [int(row["complete"] or 0) for row in series_rows],
    }


async def get_audit_log(pool: Pool, tenant_id: int, page: int = 1, page_size: int = 20) -> dict[str, Any]:
    offset = (page - 1) * page_size
    total = await pool.fetchval(
        'SELECT COUNT(*) FROM enterprise_audit_log WHERE tenant_id = $1', tenant_id,
    )
    rows = await pool.fetch(
        """SELECT id, operator_id, operator_name, action, target_user_id, target_user_name,
                  credits_amount, before_snapshot, after_snapshot, remark, created_at
           FROM enterprise_audit_log WHERE tenant_id = $1
           ORDER BY created_at DESC LIMIT $2 OFFSET $3""",
        tenant_id, page_size, offset,
    )
    items = []
    for row in rows:
        item = dict(row)
        if item.get("created_at"):
            item["created_at"] = item["created_at"].isoformat()
        items.append(item)
    return {"items": items, "total": total}


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


async def add_member(pool: Pool, name: str, phone_number: str, role: str, initial_balance: int, tenant_id: int) -> int:
    async with pool.acquire() as conn:
        async with conn.transaction():
            new_id = await conn.fetchval(
                """
                INSERT INTO users (name, email, "emailVerified", "phoneNumber", role, tenant_id,
                                   is_deleted, is_active, "createdAt", "updatedAt")
                VALUES ($1, $2, false, $3, $4, $5, false, true, NOW(), NOW())
                RETURNING id
                """,
                name, f"{phone_number}+{int(__import__('time').time())}@placeholder.local", phone_number, role, tenant_id,
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

            return new_id
