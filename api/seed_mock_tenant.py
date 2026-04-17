import asyncio
import os
import random
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

import asyncpg
from dotenv import load_dotenv


load_dotenv(Path(__file__).parent / ".env")
random.seed(42)


TENANT_CODE = "MOCK01"
TENANT_NAME = "Mock测试租户"
CN_TZ = timezone(timedelta(hours=8))

USER_SPECS = [
    {
        "name": "陈明",
        "phone": "13800000001",
        "role": "admin",
        "remaining": 10000,
        "total_purchased": 15000,
        "total_used": 5000,
        "free_credits": 0,
    },
    {
        "name": "王小红",
        "phone": "13800000002",
        "role": "user",
        "remaining": 3000,
        "total_purchased": 5000,
        "total_used": 2000,
        "free_credits": 0,
    },
    {
        "name": "张伟",
        "phone": "13800000003",
        "role": "user",
        "remaining": 2500,
        "total_purchased": 4000,
        "total_used": 1500,
        "free_credits": 0,
    },
    {
        "name": "李丽",
        "phone": "13800000004",
        "role": "user",
        "remaining": 1800,
        "total_purchased": 3000,
        "total_used": 1200,
        "free_credits": 0,
    },
    {
        "name": "赵强",
        "phone": "13800000005",
        "role": "user",
        "remaining": 500,
        "total_purchased": 2000,
        "total_used": 1500,
        "free_credits": 0,
    },
    {
        "name": "刘芳",
        "phone": "13800000006",
        "role": "user",
        "remaining": 200,
        "total_purchased": 500,
        "total_used": 300,
        "free_credits": 0,
    },
]

TASK_SPECS = [
    {
        "task_name": "小红书互动获客",
        "user": "王小红",
        "category": "SOCIAL_INTERACT",
        "platforms": ["XIAOHONGSHU"],
        "description": "自动评论+私信目标用户，每日触达50人",
    },
    {
        "task_name": "抖音内容调研",
        "user": "张伟",
        "category": "DATA_COLLECT",
        "platforms": ["DOUYIN"],
        "description": "采集竞品账号近30天爆款视频数据",
    },
    {
        "task_name": "小红书内容发布",
        "user": "李丽",
        "category": "CONTENT_PUBLISH",
        "platforms": ["XIAOHONGSHU"],
        "description": "批量发布产品种草笔记",
    },
    {
        "task_name": "微信客户回复",
        "user": "赵强",
        "category": "AUTO_REPLY",
        "platforms": ["WECHAT"],
        "description": "自动回复微信客户咨询消息",
    },
    {
        "task_name": "快手评论获客",
        "user": "王小红",
        "category": "SOCIAL_INTERACT",
        "platforms": ["KUAISHOU"],
        "description": "快手评论区精准获客",
    },
]

SUCCESS_USER_QUOTAS = {
    "陈明": 9,
    "王小红": 8,
    "张伟": 6,
    "李丽": 5,
    "赵强": 6,
    "刘芳": 1,
}

NON_SUCCESS_USER_QUOTAS = {
    "陈明": 1,
    "王小红": 2,
    "张伟": 3,
    "李丽": 3,
    "赵强": 2,
    "刘芳": 4,
}

# Note:
# The prompt's balance-related constraints are internally inconsistent:
# - 35 SUCCEED executions with credits_used in [50, 200] can at most contribute 7000 credits.
# - The requested purchased/remaining numbers imply 11500 credits of net outflow.
# - The requested DISTRIBUTE records further alter balances beyond user_balance.total_used.
# To keep the seed runnable and the final remaining balances correct, the script inserts:
# 1) the required usage-linked CONSUME rows for every SUCCEED execution, and
# 2) a small set of additional historical CONSUME adjustment rows to reconcile balances.


def now_cn() -> datetime:
    return datetime.now(timezone.utc).astimezone(CN_TZ).replace(microsecond=0)


def build_day_counts() -> list[int]:
    counts = [1] * 30
    extra = 20
    while extra > 0:
        candidates = [idx for idx, count in enumerate(counts) if count < 3]
        idx = random.choice(candidates)
        counts[idx] += 1
        extra -= 1
    assert sum(counts) == 50
    assert all(1 <= count <= 3 for count in counts)
    return counts


def build_user_name_pool(quota_map: dict[str, int]) -> list[str]:
    pool: list[str] = []
    for name, count in quota_map.items():
        pool.extend([name] * count)
    random.shuffle(pool)
    return pool


def build_execution_plan(task_map: dict[str, dict], user_map: dict[str, int], base_now: datetime) -> list[dict]:
    counts_by_day = build_day_counts()
    success_users = build_user_name_pool(SUCCESS_USER_QUOTAS)
    non_success_users = build_user_name_pool(NON_SUCCESS_USER_QUOTAS)

    results = ["SUCCEED"] * 35 + ["FAILED"] * 10 + ["CANCELLED"] * 5
    random.shuffle(results)

    exec_days = [base_now.date() - timedelta(days=30 - idx) for idx in range(30)]
    executions: list[dict] = []

    for day, count in zip(exec_days, counts_by_day):
        for _ in range(count):
            started_at = datetime(
                year=day.year,
                month=day.month,
                day=day.day,
                hour=random.randint(8, 22),
                minute=random.randint(0, 59),
                second=random.randint(0, 59),
                tzinfo=CN_TZ,
            )
            finished_at = started_at + timedelta(minutes=random.randint(5, 30))
            executions.append(
                {
                    "started_at": started_at,
                    "finished_at": finished_at,
                }
            )

    executions.sort(key=lambda item: item["started_at"])
    assert len(executions) == 50

    for idx, execution in enumerate(executions):
        result = results[idx]
        if result == "SUCCEED":
            user_name = success_users.pop()
        else:
            user_name = non_success_users.pop()

        task_spec = random.choice(TASK_SPECS)
        task_meta = task_map[task_spec["task_name"]]
        execution.update(
            {
                "task_name": task_spec["task_name"],
                "task_id": task_meta["id"],
                "user_name": user_name,
                "user_id": user_map[user_name],
                "execution_mode": "IMMEDIATE",
                "execution_status": "FINISHED",
                "execution_result": result,
                "recovery_status": "NONE",
                "recovery_epoch": 0,
            }
        )

    assert not success_users
    assert not non_success_users
    assert sum(1 for item in executions if item["execution_result"] == "SUCCEED") == 35
    assert sum(1 for item in executions if item["execution_result"] == "FAILED") == 10
    assert sum(1 for item in executions if item["execution_result"] == "CANCELLED") == 5
    return executions


def build_distribute_specs(base_now: datetime) -> list[dict]:
    distribute_at = (base_now - timedelta(days=15)).replace(hour=14, minute=0, second=0)
    return [
        {
            "from_user": "陈明",
            "to_user": "王小红",
            "amount": 500,
            "out_created_at": distribute_at,
            "in_created_at": distribute_at + timedelta(seconds=30),
        },
        {
            "from_user": "陈明",
            "to_user": "赵强",
            "amount": 300,
            "out_created_at": distribute_at + timedelta(minutes=1),
            "in_created_at": distribute_at + timedelta(minutes=1, seconds=30),
        },
    ]


async def cleanup_existing_seed(conn: asyncpg.Connection) -> None:
    tenant_rows = await conn.fetch(
        "SELECT id FROM tenants WHERE tenant_id = $1",
        TENANT_CODE,
    )
    existing_tenant_ids = [row["id"] for row in tenant_rows]
    if not existing_tenant_ids:
        return

    user_rows = await conn.fetch(
        "SELECT id FROM users WHERE tenant_id = ANY($1::int[])",
        existing_tenant_ids,
    )
    existing_user_ids = [row["id"] for row in user_rows]

    task_rows = await conn.fetch(
        "SELECT id FROM user_task WHERE user_id = ANY($1::int[])",
        existing_user_ids,
    )
    existing_task_ids = [row["id"] for row in task_rows]

    execution_rows = await conn.fetch(
        """
        SELECT id
        FROM task_execution
        WHERE user_id = ANY($1::int[])
           OR task_id = ANY($2::int[])
        """,
        existing_user_ids,
        existing_task_ids,
    )
    existing_execution_ids = [str(row["id"]) for row in execution_rows]

    await conn.execute(
        """
        DELETE FROM enterprise_audit_log
        WHERE tenant_id = ANY($1::int[])
           OR operator_id = ANY($2::int[])
           OR target_user_id = ANY($2::int[])
        """,
        existing_tenant_ids,
        existing_user_ids,
    )
    await conn.execute(
        "DELETE FROM credit_flow WHERE user_id = ANY($1::int[])",
        existing_user_ids,
    )
    await conn.execute(
        """
        DELETE FROM usage_record
        WHERE user_id = ANY($1::int[])
           OR task_id = ANY($2::varchar[])
        """,
        existing_user_ids,
        existing_execution_ids,
    )
    await conn.execute(
        """
        DELETE FROM task_execution
        WHERE user_id = ANY($1::int[])
           OR task_id = ANY($2::int[])
        """,
        existing_user_ids,
        existing_task_ids,
    )
    await conn.execute(
        "DELETE FROM user_task WHERE user_id = ANY($1::int[])",
        existing_user_ids,
    )
    await conn.execute(
        "DELETE FROM user_balance WHERE user_id = ANY($1::int[])",
        existing_user_ids,
    )
    await conn.execute(
        """
        DELETE FROM users
        WHERE tenant_id = ANY($1::int[])
           OR id = ANY($2::int[])
        """,
        existing_tenant_ids,
        existing_user_ids,
    )
    await conn.execute(
        "DELETE FROM tenants WHERE tenant_id = $1 OR id = ANY($2::int[])",
        TENANT_CODE,
        existing_tenant_ids,
    )


async def insert_tenant(conn: asyncpg.Connection, base_now: datetime) -> int:
    return await conn.fetchval(
        """
        INSERT INTO tenants (
            tenant_id, tenant_name, is_active, is_deleted, member_limit, created_at, updated_at
        )
        VALUES ($1, $2, true, false, 30, $3, $3)
        RETURNING id
        """,
        TENANT_CODE,
        TENANT_NAME,
        base_now,
    )


async def insert_users(
    conn: asyncpg.Connection,
    tenant_int_id: int,
    base_now: datetime,
) -> tuple[dict[str, int], list[int]]:
    user_map: dict[str, int] = {}
    user_ids: list[int] = []

    created_base = (base_now - timedelta(days=30)).replace(hour=8, minute=30, second=0)
    for idx, user in enumerate(USER_SPECS):
        created_at = created_base + timedelta(minutes=idx * 3)
        user_id = await conn.fetchval(
            """
            INSERT INTO users (
                name, email, "emailVerified", "phoneNumber", role, tenant_id,
                is_deleted, is_active, "createdAt", "updatedAt"
            )
            VALUES ($1, $2, false, $3, $4, $5, false, true, $6, $6)
            RETURNING id
            """,
            user["name"],
            f"{user['phone']}@mock.local",
            user["phone"],
            user["role"],
            tenant_int_id,
            created_at,
        )
        user_map[user["name"]] = user_id
        user_ids.append(user_id)

    return user_map, user_ids


async def insert_user_balances(conn: asyncpg.Connection, user_map: dict[str, int], base_now: datetime) -> None:
    balance_created_at = (base_now - timedelta(days=30)).replace(hour=8, minute=45, second=0)
    for idx, user in enumerate(USER_SPECS):
        ts = balance_created_at + timedelta(minutes=idx * 2)
        await conn.execute(
            """
            INSERT INTO user_balance (
                user_id, remaining, total_purchased, total_used, free_credits,
                version, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, 1, $6, $6)
            """,
            user_map[user["name"]],
            user["remaining"],
            user["total_purchased"],
            user["total_used"],
            user["free_credits"],
            ts,
        )


async def insert_tasks(conn: asyncpg.Connection, user_map: dict[str, int], base_now: datetime) -> dict[str, dict]:
    task_map: dict[str, dict] = {}
    task_created_at = (base_now - timedelta(days=29)).replace(hour=10, minute=0, second=0)

    for idx, task in enumerate(TASK_SPECS):
        ts = task_created_at + timedelta(minutes=idx * 7)
        task_id = await conn.fetchval(
            """
            INSERT INTO user_task (
                user_id, task_name, task_description, category, is_template,
                total_executions, success_count, fail_count, created_at, updated_at,
                is_deleted, related_platforms, is_example, is_pinned, is_eval_task
            )
            VALUES (
                $1, $2, $3, $4, false,
                0, 0, 0, $5, $5,
                false, $6::platformtype[], false, false, false
            )
            RETURNING id
            """,
            user_map[task["user"]],
            task["task_name"],
            task["description"],
            task["category"],
            ts,
            task["platforms"],
        )
        task_map[task["task_name"]] = {
            "id": task_id,
            "user_id": user_map[task["user"]],
            "task_name": task["task_name"],
        }

    return task_map


async def insert_executions(conn: asyncpg.Connection, executions: list[dict]) -> list[dict]:
    inserted: list[dict] = []
    for execution in executions:
        execution_id = await conn.fetchval(
            """
            INSERT INTO task_execution (
                task_id, user_id, execution_mode, execution_status, execution_result,
                started_at, finished_at, created_at, updated_at, is_deleted,
                recovery_status, recovery_epoch
            )
            VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $6, $7, false,
                $8, $9
            )
            RETURNING id
            """,
            execution["task_id"],
            execution["user_id"],
            execution["execution_mode"],
            execution["execution_status"],
            execution["execution_result"],
            execution["started_at"],
            execution["finished_at"],
            execution["recovery_status"],
            execution["recovery_epoch"],
        )
        inserted.append(
            {
                **execution,
                "id": execution_id,
            }
        )

    return inserted


async def insert_usage_records(
    conn: asyncpg.Connection,
    executions: list[dict],
    user_map: dict[str, int],
) -> tuple[list[dict], dict[int, int]]:
    usage_records: list[dict] = []
    usage_sum_by_user: dict[int, int] = defaultdict(int)

    for execution in executions:
        if execution["execution_result"] != "SUCCEED":
            continue

        credits_used = random.randint(50, 200)
        usage_id = await conn.fetchval(
            """
            INSERT INTO usage_record (
                user_id, task_id, task_title, credits_used, start_time, end_time, created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $6)
            RETURNING id
            """,
            execution["user_id"],
            str(execution["id"]),
            execution["task_name"],
            credits_used,
            execution["started_at"],
            execution["finished_at"],
        )
        usage_records.append(
            {
                "id": usage_id,
                "execution_id": execution["id"],
                "user_id": execution["user_id"],
                "task_name": execution["task_name"],
                "credits_used": credits_used,
                "start_time": execution["started_at"],
                "end_time": execution["finished_at"],
            }
        )
        usage_sum_by_user[execution["user_id"]] += credits_used

    assert len(usage_records) == 35
    return usage_records, usage_sum_by_user


def compute_required_consume_by_user(user_map: dict[str, int], distribute_specs: list[dict]) -> dict[int, int]:
    net_distribution_by_user: dict[str, int] = defaultdict(int)
    for spec in distribute_specs:
        net_distribution_by_user[spec["from_user"]] -= spec["amount"]
        net_distribution_by_user[spec["to_user"]] += spec["amount"]

    required_consume_by_user: dict[int, int] = {}
    for user in USER_SPECS:
        required_consume = (
            user["total_purchased"]
            + net_distribution_by_user[user["name"]]
            - user["remaining"]
        )
        required_consume_by_user[user_map[user["name"]]] = required_consume
    return required_consume_by_user


async def insert_credit_flows(
    conn: asyncpg.Connection,
    user_map: dict[str, int],
    usage_records: list[dict],
    usage_sum_by_user: dict[int, int],
    distribute_specs: list[dict],
    base_now: datetime,
) -> None:
    running_balance = {user_map[user["name"]]: 0 for user in USER_SPECS}
    desired_remaining = {
        user_map[user["name"]]: user["remaining"]
        for user in USER_SPECS
    }
    required_consume_by_user = compute_required_consume_by_user(user_map, distribute_specs)

    flow_events: list[dict] = []
    recharge_base = (base_now - timedelta(days=30)).replace(hour=7, minute=30, second=0)
    for idx, user in enumerate(USER_SPECS):
        user_id = user_map[user["name"]]
        flow_events.append(
            {
                "kind": "RECHARGE",
                "user_id": user_id,
                "change_type": "RECHARGE",
                "change_amount": user["total_purchased"],
                "ref_type": "tenant_seed",
                "ref_id": TENANT_CODE,
                "remark": "系统初始化充值",
                "created_at": recharge_base + timedelta(minutes=idx),
            }
        )

    usage_records_sorted = sorted(usage_records, key=lambda item: item["end_time"])
    last_credit_time_by_user: dict[int, datetime] = {}
    for usage in usage_records_sorted:
        flow_events.append(
            {
                "kind": "USAGE_CONSUME",
                "user_id": usage["user_id"],
                "change_type": "CONSUME",
                "change_amount": -usage["credits_used"],
                "ref_type": "usage",
                "ref_id": str(usage["id"]),
                "remark": usage["task_name"],
                "created_at": usage["end_time"],
            }
        )
        last_credit_time_by_user[usage["user_id"]] = usage["end_time"]

    for spec in distribute_specs:
        from_user_id = user_map[spec["from_user"]]
        to_user_id = user_map[spec["to_user"]]
        flow_events.append(
            {
                "kind": "DISTRIBUTE_OUT",
                "user_id": from_user_id,
                "change_type": "DISTRIBUTE",
                "change_amount": -spec["amount"],
                "ref_type": "user",
                "ref_id": str(to_user_id),
                "remark": f"分发给 {spec['to_user']}",
                "created_at": spec["out_created_at"],
            }
        )
        flow_events.append(
            {
                "kind": "DISTRIBUTE_IN",
                "user_id": to_user_id,
                "change_type": "DISTRIBUTE",
                "change_amount": spec["amount"],
                "ref_type": "user",
                "ref_id": str(from_user_id),
                "remark": f"来自 {spec['from_user']} 的分发",
                "created_at": spec["in_created_at"],
            }
        )
        last_credit_time_by_user[from_user_id] = max(
            last_credit_time_by_user.get(from_user_id, spec["out_created_at"]),
            spec["out_created_at"],
        )
        last_credit_time_by_user[to_user_id] = max(
            last_credit_time_by_user.get(to_user_id, spec["in_created_at"]),
            spec["in_created_at"],
        )

    adjustment_base = base_now - timedelta(minutes=5)
    for idx, user in enumerate(USER_SPECS):
        user_id = user_map[user["name"]]
        used_via_usage = usage_sum_by_user.get(user_id, 0)
        adjustment_amount = required_consume_by_user[user_id] - used_via_usage
        if adjustment_amount < 0:
            raise AssertionError(
                f"user {user['name']} usage-based consume exceeds required total: "
                f"usage={used_via_usage}, required={required_consume_by_user[user_id]}"
            )
        if adjustment_amount == 0:
            continue

        base_time = max(
            adjustment_base + timedelta(seconds=idx),
            last_credit_time_by_user.get(user_id, adjustment_base) + timedelta(seconds=1),
        )
        flow_events.append(
            {
                "kind": "ADJUST_CONSUME",
                "user_id": user_id,
                "change_type": "CONSUME",
                "change_amount": -adjustment_amount,
                "ref_type": "seed_adjustment",
                "ref_id": f"{TENANT_CODE}:{user_id}",
                "remark": "历史消耗归档补齐",
                "created_at": base_time,
            }
        )

    flow_events.sort(key=lambda item: (item["created_at"], item["user_id"], item["kind"]))

    for event in flow_events:
        user_id = event["user_id"]
        running_balance[user_id] += event["change_amount"]
        await conn.execute(
            """
            INSERT INTO credit_flow (
                user_id, change_type, change_amount, balance_after,
                ref_type, ref_id, remark, created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            """,
            user_id,
            event["change_type"],
            event["change_amount"],
            running_balance[user_id],
            event["ref_type"],
            event["ref_id"],
            event["remark"],
            event["created_at"],
        )

    mismatches = []
    for user in USER_SPECS:
        user_id = user_map[user["name"]]
        expected = desired_remaining[user_id]
        actual = running_balance[user_id]
        if actual != expected:
            mismatches.append(
                f"{user['name']}: expected remaining {expected}, actual {actual}"
            )

    if mismatches:
        raise AssertionError("credit_flow balance mismatch:\n" + "\n".join(mismatches))


async def insert_audit_logs(
    conn: asyncpg.Connection,
    tenant_int_id: int,
    user_map: dict[str, int],
    base_now: datetime,
) -> None:
    operator_id = user_map["陈明"]
    add_member_base = (base_now - timedelta(days=30)).replace(hour=9, minute=15, second=0)
    for idx, user in enumerate(USER_SPECS):
        if user["role"] == "admin":
            continue
        await conn.execute(
            """
            INSERT INTO enterprise_audit_log (
                operator_id, operator_name, tenant_id, action,
                target_user_id, target_user_name, credits_amount, remark, created_at
            )
            VALUES ($1, $2, $3, 'ADD_MEMBER', $4, $5, NULL, $6, $7)
            """,
            operator_id,
            "陈明",
            tenant_int_id,
            user_map[user["name"]],
            user["name"],
            "初始化导入成员",
            add_member_base + timedelta(minutes=idx),
        )

    transfer_base = (base_now - timedelta(days=15)).replace(hour=14, minute=0, second=0)
    transfer_logs = [
        {
            "operator_name": "陈明",
            "operator_id": user_map["陈明"],
            "target_name": "王小红",
            "target_id": user_map["王小红"],
            "amount": 500,
            "remark": "分发给 王小红",
            "created_at": transfer_base,
        },
        {
            "operator_name": "王小红",
            "operator_id": user_map["王小红"],
            "target_name": "陈明",
            "target_id": user_map["陈明"],
            "amount": 500,
            "remark": "来自 陈明 的分发",
            "created_at": transfer_base + timedelta(seconds=30),
        },
        {
            "operator_name": "陈明",
            "operator_id": user_map["陈明"],
            "target_name": "赵强",
            "target_id": user_map["赵强"],
            "amount": 300,
            "remark": "分发给 赵强",
            "created_at": transfer_base + timedelta(minutes=1),
        },
        {
            "operator_name": "赵强",
            "operator_id": user_map["赵强"],
            "target_name": "陈明",
            "target_id": user_map["陈明"],
            "amount": 300,
            "remark": "来自 陈明 的分发",
            "created_at": transfer_base + timedelta(minutes=1, seconds=30),
        },
    ]
    for log in transfer_logs:
        await conn.execute(
            """
            INSERT INTO enterprise_audit_log (
                operator_id, operator_name, tenant_id, action,
                target_user_id, target_user_name, credits_amount, remark, created_at
            )
            VALUES ($1, $2, $3, 'TRANSFER_CREDITS', $4, $5, $6, $7, $8)
            """,
            log["operator_id"],
            log["operator_name"],
            tenant_int_id,
            log["target_id"],
            log["target_name"],
            log["amount"],
            log["remark"],
            log["created_at"],
        )


async def main() -> None:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is not set in dashboard/api/.env")

    conn = await asyncpg.connect(database_url)
    try:
        base_now = now_cn()

        async with conn.transaction():
            await cleanup_existing_seed(conn)

            tenant_int_id = await insert_tenant(conn, base_now)
            user_map, user_ids = await insert_users(conn, tenant_int_id, base_now)
            await insert_user_balances(conn, user_map, base_now)
            task_map = await insert_tasks(conn, user_map, base_now)

            executions = build_execution_plan(task_map, user_map, base_now)
            inserted_executions = await insert_executions(conn, executions)
            usage_records, usage_sum_by_user = await insert_usage_records(
                conn,
                inserted_executions,
                user_map,
            )
            distribute_specs = build_distribute_specs(base_now)
            await insert_credit_flows(
                conn,
                user_map,
                usage_records,
                usage_sum_by_user,
                distribute_specs,
                base_now,
            )
            await insert_audit_logs(conn, tenant_int_id, user_map, base_now)

        print("✅ Seed 完成")
        print(f"Tenant int ID: {tenant_int_id}")
        print("Users:")
        for user in USER_SPECS:
            print(f"  {user['name']} ({user['role']}): {user_map[user['name']]}")
        print(f"提示：在 auth.py 中设置 TENANT_ID={tenant_int_id}")
    finally:
        await conn.close()


asyncio.run(main())
