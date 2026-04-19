BEGIN;

-- Dashboard deployment bootstrap SQL.
-- Assumes the application tables already exist in the target schema selected by the current session/search_path.
-- Note: the original task prompt mentioned user_task.tenant_id, but the actual code scopes tasks through user_task.user_id -> users.tenant_id.

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

CREATE INDEX IF NOT EXISTS mutation_idempotency_created_idx
    ON mutation_idempotency (created_at);

-- Back up orphaned credit_flow rows before deletion.
CREATE TABLE IF NOT EXISTS _orphan_credit_flow_backup (
    LIKE credit_flow INCLUDING DEFAULTS INCLUDING GENERATED INCLUDING IDENTITY
);

ALTER TABLE _orphan_credit_flow_backup
    ADD COLUMN IF NOT EXISTS original_credit_flow_id BIGINT;

ALTER TABLE _orphan_credit_flow_backup
    ADD COLUMN IF NOT EXISTS backup_reason TEXT;

ALTER TABLE _orphan_credit_flow_backup
    ADD COLUMN IF NOT EXISTS backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS orphan_credit_flow_backup_original_credit_flow_id_idx
    ON _orphan_credit_flow_backup (original_credit_flow_id);

DO $$
DECLARE
    src_columns text;
    dst_columns text;
BEGIN
    SELECT string_agg(format('cf.%I', a.attname), ', ' ORDER BY a.attnum)
      INTO src_columns
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    WHERE c.relname = 'credit_flow'
      AND a.attnum > 0
      AND NOT a.attisdropped;

    SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum)
      INTO dst_columns
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    WHERE c.relname = '_orphan_credit_flow_backup'
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND a.attname NOT IN ('original_credit_flow_id', 'backup_reason', 'backed_up_at');

    EXECUTE format(
        'INSERT INTO _orphan_credit_flow_backup (%s, original_credit_flow_id, backup_reason, backed_up_at)
         SELECT %s, cf.id, %L, NOW()
         FROM credit_flow cf
         LEFT JOIN users u ON u.id = cf.user_id
         WHERE u.id IS NULL
         ON CONFLICT (original_credit_flow_id) DO NOTHING',
        dst_columns,
        src_columns,
        'credit_flow.user_id points to a missing users.id'
    );
END $$;

DELETE FROM credit_flow cf
USING (
    SELECT cf_inner.id
    FROM credit_flow cf_inner
    LEFT JOIN users u ON u.id = cf_inner.user_id
    WHERE u.id IS NULL
) AS orphan_rows
WHERE cf.id = orphan_rows.id;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class src ON src.oid = c.conrelid
        JOIN pg_class ref ON ref.oid = c.confrelid
        JOIN LATERAL unnest(c.conkey) AS key_attnum(attnum) ON TRUE
        JOIN pg_attribute a
          ON a.attrelid = src.oid
         AND a.attnum = key_attnum.attnum
        WHERE c.contype = 'f'
          AND src.relname = 'credit_flow'
          AND ref.relname = 'users'
          AND a.attname = 'user_id'
    ) THEN
        ALTER TABLE credit_flow
            ADD CONSTRAINT credit_flow_user_id_fkey
            FOREIGN KEY (user_id)
            REFERENCES users(id)
            ON UPDATE CASCADE
            ON DELETE RESTRICT;
    END IF;
END $$;

-- Core lookup indexes used by dashboard queries.
CREATE INDEX IF NOT EXISTS users_tenant_id_active_idx
    ON users (tenant_id, id)
    WHERE NOT is_deleted;

CREATE INDEX IF NOT EXISTS user_task_user_id_active_idx
    ON user_task (user_id, id)
    WHERE NOT is_deleted;

CREATE INDEX IF NOT EXISTS user_task_user_id_created_at_idx
    ON user_task (user_id, created_at DESC)
    WHERE NOT is_deleted;

CREATE INDEX IF NOT EXISTS task_execution_user_id_effective_ts_idx
    ON task_execution (user_id, (COALESCE(finished_at, started_at)) DESC)
    WHERE NOT is_deleted;

CREATE INDEX IF NOT EXISTS task_execution_task_id_effective_ts_idx
    ON task_execution (task_id, (COALESCE(finished_at, started_at)) DESC)
    WHERE NOT is_deleted;

CREATE INDEX IF NOT EXISTS task_execution_started_at_idx
    ON task_execution (started_at DESC)
    WHERE NOT is_deleted;

CREATE INDEX IF NOT EXISTS usage_record_user_id_effective_ts_idx
    ON usage_record (user_id, (COALESCE(end_time, start_time, created_at)) DESC);

CREATE INDEX IF NOT EXISTS usage_record_task_id_idx
    ON usage_record (task_id);

CREATE INDEX IF NOT EXISTS execution_behavior_stat_execution_id_idx
    ON execution_behavior_stat (execution_id);

CREATE INDEX IF NOT EXISTS credit_flow_user_id_created_at_idx
    ON credit_flow (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS credit_flow_change_type_created_at_idx
    ON credit_flow (change_type, created_at DESC);

CREATE INDEX IF NOT EXISTS credit_flow_ref_type_ref_id_idx
    ON credit_flow (ref_type, ref_id);

CREATE INDEX IF NOT EXISTS enterprise_audit_log_tenant_id_created_at_idx
    ON enterprise_audit_log (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS enterprise_audit_log_tenant_id_action_created_at_idx
    ON enterprise_audit_log (tenant_id, action, created_at DESC);

COMMIT;

SELECT
    'mutation_idempotency_exists' AS check_name,
    to_regclass('mutation_idempotency') IS NOT NULL AS ok;

SELECT
    'credit_flow_orphans_remaining' AS check_name,
    COUNT(*)::bigint AS remaining_count
FROM credit_flow cf
LEFT JOIN users u ON u.id = cf.user_id
WHERE u.id IS NULL;

SELECT
    'orphan_backup_rows' AS check_name,
    COUNT(*)::bigint AS backup_count
FROM _orphan_credit_flow_backup;

SELECT
    'credit_flow_user_fk_present' AS check_name,
    EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class src ON src.oid = c.conrelid
        JOIN pg_class ref ON ref.oid = c.confrelid
        JOIN LATERAL unnest(c.conkey) AS key_attnum(attnum) ON TRUE
        JOIN pg_attribute a
          ON a.attrelid = src.oid
         AND a.attnum = key_attnum.attnum
        WHERE c.contype = 'f'
          AND src.relname = 'credit_flow'
          AND ref.relname = 'users'
          AND a.attname = 'user_id'
    ) AS ok;

SELECT
    tablename,
    indexname
FROM pg_indexes
WHERE schemaname = current_schema()
  AND indexname IN (
      'mutation_idempotency_created_idx',
      'users_tenant_id_active_idx',
      'user_task_user_id_active_idx',
      'user_task_user_id_created_at_idx',
      'task_execution_user_id_effective_ts_idx',
      'task_execution_task_id_effective_ts_idx',
      'task_execution_started_at_idx',
      'usage_record_user_id_effective_ts_idx',
      'usage_record_task_id_idx',
      'execution_behavior_stat_execution_id_idx',
      'credit_flow_user_id_created_at_idx',
      'credit_flow_change_type_created_at_idx',
      'credit_flow_ref_type_ref_id_idx',
      'enterprise_audit_log_tenant_id_created_at_idx',
      'enterprise_audit_log_tenant_id_action_created_at_idx'
  )
ORDER BY tablename, indexname;
