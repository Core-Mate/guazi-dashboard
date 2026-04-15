import json
from collections import defaultdict
from typing import Any

from asyncpg import Pool


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


async def sample_table(pool: Pool, table_name: str, limit: int) -> list[dict[str, Any]]:
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

    rows = await pool.fetch(
        f'SELECT * FROM "{table_name}" LIMIT $1',
        limit,
    )

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
            COUNT(*) FILTER (WHERE te.execution_result = 'SUCCEED')::bigint AS success_count,
            COUNT(*) FILTER (WHERE te.execution_result = 'FAILED')::bigint AS fail_count,
            COUNT(DISTINCT te.user_id)::bigint AS active_users
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
    }


async def stats_trend(pool: Pool, days: int, tenant_id: int) -> dict[str, list[Any]]:
    interval_literal = f"{days} days"

    rows = await pool.fetch(
        f"""
        SELECT
            DATE(te.started_at) AS day,
            COUNT(*) FILTER (WHERE te.execution_result = 'SUCCEED')::bigint AS success,
            COUNT(*) FILTER (WHERE te.execution_result = 'FAILED')::bigint AS failed,
            COUNT(*)::bigint AS total
        FROM task_execution te
        JOIN users u ON u.id = te.user_id
        WHERE te.started_at > NOW() - INTERVAL '{interval_literal}'
          AND u.tenant_id = $1
          AND NOT u.is_deleted
        GROUP BY DATE(te.started_at)
        ORDER BY day
        """,
        tenant_id,
    )

    return {
        "dates": [row["day"].isoformat() for row in rows],
        "success": [row["success"] for row in rows],
        "failed": [row["failed"] for row in rows],
        "total": [row["total"] for row in rows],
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
        """
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
                COUNT(*) FILTER (WHERE te.execution_result = 'SUCCEED')::bigint AS success_count,
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

    return [dict(row) for row in rows]


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
            'CONSUME'::varchar AS change_type,
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
            AND cf.ref_id::int = ur.id
        LEFT JOIN task_execution te ON ur.task_id = te.id::varchar
        LEFT JOIN user_task ut ON te.task_id = ut.id
        WHERE cf.change_type = 'CONSUME'
          AND u.tenant_id = $1
          AND NOT u.is_deleted
        GROUP BY te.id, ut.task_name, u.name

        UNION ALL

        SELECT
            cf.change_type,
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
        """
        SELECT ut.id, ut.task_name AS skill_name, ut.task_description AS description,
               ut.related_platforms, ut.category,
               COALESCE(es.total, 0)::bigint AS total_executions,
               COALESCE(es.success, 0)::bigint AS success_count
        FROM user_task ut
        LEFT JOIN (
            SELECT te.task_id,
                   COUNT(*) AS total,
                   COUNT(*) FILTER (WHERE te.execution_result = 'SUCCEED') AS success
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
        """
        SELECT u.id, u.name AS username,
               COUNT(te.id)::bigint AS exec_count,
               COALESCE(SUM(EXTRACT(EPOCH FROM (te.finished_at - te.started_at)))/3600, 0)::float AS duration_hours,
               COALESCE(SUM(
                   CASE WHEN te.token_usage IS NOT NULL
                        THEN ((te.token_usage #>> '{}')::jsonb ->> 'total_tokens')::bigint
                        ELSE 0 END
               ), 0)::bigint AS total_tokens
        FROM users u
        LEFT JOIN task_execution te ON u.id = te.user_id
        WHERE NOT u.is_deleted AND u.tenant_id = $1
        GROUP BY u.id, u.name
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


async def distribute_credits(pool: Pool, operator_id: int, target_user_id: int, amount: int, remark: str) -> None:
    async with pool.acquire() as conn:
        async with conn.transaction():
            op_user = await conn.fetchrow(
                'SELECT id, name, tenant_id FROM users WHERE id = $1 AND NOT is_deleted',
                operator_id,
            )
            if not op_user:
                raise ValueError("operator not found")

            tgt_user = await conn.fetchrow(
                'SELECT id, name, tenant_id FROM users WHERE id = $1 AND NOT is_deleted',
                target_user_id,
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

            await conn.execute(
                'UPDATE user_balance SET remaining = remaining + $1, version = version + 1 WHERE user_id = $2',
                amount, target_user_id,
            )

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
                tgt_user.get("phoneNumber") if hasattr(tgt_user, "get") else None,
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
                'UPDATE users SET is_deleted = true WHERE id = $1 AND tenant_id = $2',
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
                INSERT INTO users (name, "phoneNumber", role, tenant_id, is_deleted, "createdAt")
                VALUES ($1, $2, $3, $4, false, NOW())
                RETURNING id
                """,
                name, phone_number, role, tenant_id,
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
