# Dashboard 部署手册

## 一、系统要求
- Python 3.11+
- Node.js 20+ (build only)
- PostgreSQL 14+ (recommended: RDS / cloud-managed)
- Minimum hardware: 2 vCPU / 2GB RAM / 10GB disk

补充说明：

- `dashboard-api` 当前依赖 `asyncpg`，`DATABASE_URL` 必须使用 `postgresql://...` / `postgres://...` 形式的 DSN，不要填 SQLAlchemy 风格的 `postgresql+asyncpg://...`。
- 前端是静态站点，运行时不依赖 Node.js；Node.js 只用于构建 `docs/dashboard/` 产物。
- 生产环境建议把所有环境变量交给 systemd / Docker / Kubernetes 注入，不要依赖本地 `.env` 相对路径。

## 二、架构组件

```text
Browser
  |
  v
Nginx / ALB / Reverse Proxy
  |- Host: customer-a.example.com
  |    |- /                -> serve static files from docs/dashboard/
  |    |- /api/*           -> dashboard-api:8403
  |    \- inject X-API-Key -> key mapped from Host
  |
  \- Host: llm.example.com
       \- /*               -> llm-gateway:8000

dashboard-api (FastAPI, :8403)
  \- asyncpg connection pool
     \- PostgreSQL (:5432)

llm-gateway (FastAPI, :8000)
  \- DashScope-compatible OpenAI client
```

- `dashboard-api` (FastAPI) 默认端口 `8403`
- `llm-gateway` (FastAPI) 默认端口 `8000`
- PostgreSQL 数据库
- Nginx 反向代理（推荐）：按 Host 路由，并为 `dashboard-api` 注入 `X-API-Key`

实际代码补充：

- 前端 Vite 构建产物输出到 `docs/dashboard/`，由 Nginx 直接静态托管。
- 前端默认请求 `/api/*`；如果是分域部署，需要构建时设置 `VITE_API_BASE`。
- `llm-gateway` 不是数据库客户端，不直接连接 PostgreSQL。

## 三、环境变量配置

### dashboard/api/.env (backend required)

| Variable | Required | Description | Example |
|---|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL DSN，供 `dashboard/api/db.py` 用于 `asyncpg.create_pool()`。必须是 `postgresql://...`，不是 `postgresql+asyncpg://...`。 | `postgresql://dashboard:strong-password@db.example.com:5432/dashboard?sslmode=require` |
| `API_KEY` | Conditional | 单租户模式的静态 API Key。若不使用 `DASHBOARD_API_KEYS`，至少要配置它。 | `0123456789abcdef0123456789abcdef` |
| `DASHBOARD_API_KEYS` | Conditional | 多租户模式的 `key:tenant_id` 映射，英文逗号分隔。 | `a1b2...:101,c3d4...:102` |
| `TENANT_ID` | Conditional | 单租户模式下的真实租户整数 ID。若只配置 `API_KEY` 而未配 `DASHBOARD_API_KEYS`，这里不能保留默认 `1`。 | `101` |
| `DB_SCHEMA` | No | PostgreSQL `search_path`，默认 `public`。 | `public` |
| `DB_POOL_MIN_SIZE` | No | 连接池最小连接数，默认 `1`。 | `2` |
| `DB_POOL_MAX_SIZE` | No | 连接池最大连接数，默认 `10`。 | `20` |
| `DB_COMMAND_TIMEOUT` | No | `asyncpg` 命令超时秒数，默认 `30`。 | `30` |
| `DB_STATEMENT_CACHE_SIZE` | No | `asyncpg` statement cache 大小，默认 `100`。 | `100` |
| `LOG_LEVEL` | No | `dashboard-api` 日志级别，默认 `INFO`。 | `INFO` |
| `ENABLE_EXPLORE` | No | 是否开放 `/api/explore/*` 调试端点；默认关闭，生产必须保持关闭。 | `0` |
| `DASHBOARD_WARMUP_TENANT_IDS` | No | 启动预热和 60 秒热缓存刷新的租户列表。默认按 `DASHBOARD_API_KEYS` 推导，否则退回 `TENANT_ID`。 | `101,102` |
| `CORS_ORIGINS` | No, currently unused | 需求说明里提到此变量，但当前 `dashboard/api/main.py` 并未读取它；当前代码直接 `allow_origins=["*"]`。 | `https://customer-a.example.com` |

重要说明：

- `db.py` 会自动读取 `dashboard/api/.env`。
- `auth.py` 当前却是读取 `dashboard/.env`，不是 `dashboard/api/.env`。
- 因此生产环境不要依赖这两个相对路径文件自动加载；推荐在 systemd / Docker / K8s 里统一注入 `DATABASE_URL`、`API_KEY`、`DASHBOARD_API_KEYS`、`TENANT_ID` 等变量。
- 如果你坚持用 `.env` 文件启动，请保证 `dashboard/.env` 与 `dashboard/api/.env` 中的鉴权变量保持一致。

### llm-gateway/.env

| Variable | Required | Description | Example |
|---|---|---|---|
| `DASHSCOPE_API_KEY` | Yes | 阿里云 DashScope Key，`llm-gateway` 实际调用模型时使用。 | `sk-xxxxxxxxxxxxxxxx` |
| `LLM_API_KEY` | Yes | `llm-gateway` 对外鉴权用的静态 API Key，请求需带 `X-API-Key`。 | `llm-gateway-prod-key` |
| `LLM_TIMEOUT` | No, currently unused | 需求说明里要求列出，但当前 `llm-gateway/main.py` 没有读取该变量；超时没有做成 env 配置。 | `8` |
| `MAX_ATTEMPTS` | No, currently unused | 需求说明里要求列出，但当前 `llm-gateway/main.py` 把重试次数写死为代码常量 `4`，不是环境变量。 | `4` |

补充说明：

- 当前仓库里的 `llm-gateway/.env.example` 只给了 `DASHSCOPE_API_KEY`，但代码实际还强制要求 `LLM_API_KEY`。
- `llm-gateway` 当前 `/health` 无鉴权，`/chat`、`/agent/chat`、`/chat/stream` 需要 `X-API-Key`。

### Frontend build vars (dev only)

- `VITE_API_KEY`
  - 仅开发环境读取；生产环境前端不会主动带 `X-API-Key`。
  - 生产推荐：不要把租户 key 注入前端构建产物，由反向代理按 Host 注入。
- `VITE_API_BASE`
  - 默认值来自前端代码：`/api`
  - 如果前端和 `dashboard-api` 分域部署，构建前设置成完整后端地址，例如 `https://dashboard-api.example.com/api`

## 四、首次启动步骤

1. 克隆代码到目标服务器。

   ```bash
   git clone <repo-url> /srv/mi
   cd /srv/mi
   ```

2. 初始化部署 SQL。

   ```bash
   psql "$DATABASE_URL" -f dashboard/db/init.sql
   ```

3. 创建首个租户和首个管理员。

   实际表结构来自当前代码：租户在 `tenants`，管理员用户在 `users`，余额在 `user_balance`。需求说明里写“在 tenants 表创建 admin user”并不符合当前 schema。

   最小 SQL 示例：

   ```sql
   BEGIN;

   WITH new_tenant AS (
       INSERT INTO tenants (
           tenant_id,
           tenant_name,
           is_active,
           is_deleted,
           member_limit,
           created_at,
           updated_at
       )
       VALUES (
           'ACME01',
           'Acme Corp',
           true,
           false,
           50,
           NOW(),
           NOW()
       )
       RETURNING id
   ),
   new_admin AS (
       INSERT INTO users (
           name,
           email,
           "emailVerified",
           "phoneNumber",
           role,
           tenant_id,
           is_deleted,
           is_active,
           "createdAt",
           "updatedAt"
       )
       SELECT
           'Acme Admin',
           'admin@acme.example',
           false,
           '13800000000',
           'admin',
           id,
           false,
           true,
           NOW(),
           NOW()
       FROM new_tenant
       RETURNING id
   )
   INSERT INTO user_balance (
       user_id,
       remaining,
       version,
       created_at,
       updated_at
   )
   SELECT id, 0, 1, NOW(), NOW()
   FROM new_admin;

   COMMIT;
   ```

   如果只是做演示租户，也可以参考 `dashboard/api/seed_mock_tenant.py` 的写法，但该脚本文件头已明确标注 `DO NOT run in production`，生产环境不要直接运行它。

4. 配置 `dashboard-api` 与 `llm-gateway` 环境变量。

   推荐方式：由 systemd / Docker / K8s 直接注入。

   如果用文件：

   - `dashboard/api/.env`：放数据库变量和后端运行变量
   - `dashboard/.env`：当前 `auth.py` 读这里；至少要同步 `API_KEY` / `TENANT_ID` / `DASHBOARD_API_KEYS`
   - `llm-gateway/.env`：放 `DASHSCOPE_API_KEY` / `LLM_API_KEY`

5. 启动 `dashboard-api`。

   ```bash
   cd dashboard/api
   uvicorn main:app --host 0.0.0.0 --port 8403
   ```

6. 启动 `llm-gateway`。

   ```bash
   cd llm-gateway
   uvicorn main:app --host 0.0.0.0 --port 8000
   ```

7. 构建前端。

   ```bash
   cd dashboard
   npm ci
   npm run build
   ```

   实际构建产物输出目录来自 `dashboard/vite.config.ts`：

   ```text
   docs/dashboard/
   ```

8. 配置 Nginx（见下一节），然后执行烟雾测试。

   ```bash
   API_KEY='<dashboard-api-key>' LLM_API_KEY='<llm-gateway-key>' ./dashboard/smoke.sh
   ```

## 五、Nginx 配置模板

下面的模板体现了当前项目推荐部署方式：

- 一个 Host 负责静态前端 + `dashboard-api`
- 另一个 Host 负责 `llm-gateway`
- `dashboard-api` 的 `X-API-Key` 由 Nginx 按 Host 注入，浏览器不直接持有生产 key

```nginx
upstream dashboard_api {
    server 127.0.0.1:8403;
    keepalive 32;
}

upstream llm_gateway {
    server 127.0.0.1:8000;
    keepalive 16;
}

map $host $dashboard_api_key {
    default "";
    customer-a.example.com "replace-with-customer-a-dashboard-key";
    customer-b.example.com "replace-with-customer-b-dashboard-key";
}

map $host $llm_gateway_api_key {
    default "";
    llm.example.com "replace-with-llm-gateway-key";
}

server {
    listen 80;
    server_name customer-a.example.com customer-b.example.com;

    root /srv/mi/docs/dashboard;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        if ($dashboard_api_key = "") {
            return 403;
        }

        proxy_pass http://dashboard_api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-API-Key $dashboard_api_key;
        proxy_connect_timeout 5s;
        proxy_send_timeout 30s;
        proxy_read_timeout 60s;
    }
}

server {
    listen 80;
    server_name llm.example.com;

    location / {
        if ($llm_gateway_api_key = "") {
            return 403;
        }

        proxy_pass http://llm_gateway;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-API-Key $llm_gateway_api_key;
        proxy_connect_timeout 5s;
        proxy_send_timeout 30s;
        proxy_read_timeout 120s;
    }
}
```

如果是 HTTPS / ALB / Ingress：

- TLS 终止可以放在 ALB / Ingress 层
- 只要保留 Host 路由和 `X-API-Key` 注入逻辑即可
- 如果前端与 API 分域，构建前设置 `VITE_API_BASE=https://dashboard-api.example.com/api`

## 六、健康检查

- `GET /health` 返回 `200`：`dashboard-api` 进程可用，且数据库可连通
- `GET /ready` 返回 `200`：`dashboard-api` 进程已起来，立即就绪，不检查 DB
- `GET /health` on `llm-gateway` 返回 `200`：网关进程可用

推荐检查命令：

```bash
curl -fsS http://127.0.0.1:8403/ready
curl -fsS http://127.0.0.1:8403/health
curl -fsS http://127.0.0.1:8000/health
```

Kubernetes 示例：

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 8403
  initialDelaySeconds: 10
  periodSeconds: 15
  timeoutSeconds: 3
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /ready
    port: 8403
  initialDelaySeconds: 2
  periodSeconds: 5
  timeoutSeconds: 2
  failureThreshold: 3
```

`llm-gateway` 当前没有单独的 `/ready`，可直接把 `/health` 同时用于 liveness / readiness。

## 七、日志

- `dashboard-api`：stdout JSON 日志，来自 `dashboard/api/main.py` 自定义 `JsonFormatter`，可直接接入 ELK / CloudWatch / 阿里云日志服务
- `llm-gateway`：当前代码使用 `logging.basicConfig(...)`，输出为普通文本，不是 JSON
- `dashboard-api` 日志级别由 `LOG_LEVEL` 控制，默认 `INFO`
- 当前真实的 JSON 字段包括：`ts` / `level` / `logger` / `msg`
- 某些日志会通过 `extra` 带出附加字段，例如 `tenant_id` / `path` / `detail`
- 当前代码没有统一输出名为 `endpoint` 的字段；最接近的是异常日志里的 `path`

运维建议：

- 容器场景直接采 stdout/stderr，不要再写本地文件轮转
- 对 `401`、`429`、`503`、启动自检失败设置告警
- 对 `Dashboard hot cache refill failed`、`DB startup check failed`、`Invalid API key` 做关键词告警

## 八、新增客户流程

1. 生成新 API key。

   ```bash
   openssl rand -hex 32
   ```

2. 写入新租户。

   ```sql
   INSERT INTO tenants (
       tenant_id,
       tenant_name,
       is_active,
       is_deleted,
       member_limit,
       created_at,
       updated_at
   )
   VALUES (
       'NEWCUST01',
       'New Customer Ltd',
       true,
       false,
       50,
       NOW(),
       NOW()
   )
   RETURNING id;
   ```

3. 更新后端环境变量 `DASHBOARD_API_KEYS`，追加 `newkey:newtenant_id`。

   ```text
   DASHBOARD_API_KEYS=oldkey:101,newkey:102
   ```

4. 重启 `dashboard-api`，让新的 key -> tenant 映射生效。

5. 给新子域名增加 Nginx `server_name` / Host 映射，并让该 Host 注入对应的 `X-API-Key`。

6. 创建该租户的首个管理员。

   注意：管理员不在 `tenants` 表中，实际需要写 `users` + `user_balance`。

   ```sql
   WITH new_admin AS (
       INSERT INTO users (
           name,
           email,
           "emailVerified",
           "phoneNumber",
           role,
           tenant_id,
           is_deleted,
           is_active,
           "createdAt",
           "updatedAt"
       )
       VALUES (
           'New Customer Admin',
           'admin@newcustomer.example',
           false,
           '13800000001',
           'admin',
           102,
           false,
           true,
           NOW(),
           NOW()
       )
       RETURNING id
   )
   INSERT INTO user_balance (
       user_id,
       remaining,
       version,
       created_at,
       updated_at
   )
   SELECT id, 0, 1, NOW(), NOW()
   FROM new_admin;
   ```

7. 验证新租户：

   - 访问 `https://newcustomer.yourdomain.com/`
   - `curl -H "X-API-Key: <newkey>" "https://newcustomer.yourdomain.com/api/dashboard/snapshot?range=7d"`
   - 运行 `dashboard/smoke.sh`

## 九、常见报错 FAQ

| Error | Possible Cause | Solution |
|---|---|---|
| `Must set DASHBOARD_API_KEYS (key:tenant,...) or TENANT_ID to a real tenant id (not default 1)` | 启动自检失败；既没配 `DASHBOARD_API_KEYS`，又把 `TENANT_ID` 留成空或默认 `1` | 设置真实租户 ID，或改成多租户 key 映射后重启 |
| `No API key configured. Set DASHBOARD_API_KEYS or API_KEY env var.` | 鉴权变量没注入成功；或者只写到了 `dashboard/api/.env`，但 `auth.py` 实际读的是 `dashboard/.env` | 生产环境改用系统环境变量；如果用文件，保证两个 `.env` 一致 |
| `401 Invalid API key` | 反代未注入 `X-API-Key`，或者 `.env` 中 key 与 Nginx 注入值不一致 | 先检查 Nginx `proxy_set_header X-API-Key ...`，再检查 `DASHBOARD_API_KEYS` / `API_KEY` |
| `401 Missing X-API-Key header` | 直接访问 `/api/*` 时没带 header，且没有经过反向代理注入 | 通过 Nginx 入口访问，或手工 `curl -H "X-API-Key: ..."` |
| `/health` 返回 `503` | PostgreSQL 不可达，或连接池初始化失败 | 检查数据库连通性、账号密码、SSL 参数；连接池空闲连接最长 300 秒自动回收，恢复后可重试，必要时重启进程 |
| `429 Too Many Requests` | 写接口超出 `60/minute` 限流；只作用于 `POST /api/credits/distribute`、`POST /api/members`、`PUT /api/members/{id}`、`DELETE /api/members/{id}` | 降低写入频率，或在上游队列中串行化；不要让前端/脚本瞬时重放写请求 |
| `DATABASE_URL environment variable is required` | 后端没拿到数据库 DSN | 注入 `DATABASE_URL`，格式使用 `postgresql://...` |
| `psql: could not connect to server` | 安全组 / VPC / 白名单 / 密码 / SSL 参数错误 | 先在应用机上用同一 DSN 做 `psql` 连通测试，再启动应用 |

## 十、回滚 / 应急

- 代码回滚：`git revert <bad-commit> && redeploy`
- 数据库回滚：从云数据库快照 / PITR 恢复到指定时间点
- 紧急关闭调试接口：把 `ENABLE_EXPLORE=0` 后重启 `dashboard-api`
- 紧急下线某客户：
  - 从 Nginx 删除对应 Host 映射或返回 `503`
  - 从 `DASHBOARD_API_KEYS` 移除该 key
  - 重启 `dashboard-api`
- 如果只是租户 key 配错，优先修正 `DASHBOARD_API_KEYS` 和 Nginx，不要先回滚代码

## 十一、上线 checklist（交付必跑）

- [ ] `psql "$DATABASE_URL" -f dashboard/db/init.sql` 已成功执行
- [ ] `tenants` / `users` / `user_balance` 已创建首个正式租户与管理员
- [ ] `dashboard-api` 已能返回 `GET /ready = 200`
- [ ] `dashboard-api` 已能返回 `GET /health = 200`
- [ ] `llm-gateway` 已能返回 `GET /health = 200`
- [ ] Nginx 已按 Host 注入正确的 `X-API-Key`
- [ ] 前端已完成 `npm ci && npm run build`，且 `docs/dashboard/` 已被静态托管
- [ ] `curl -H "X-API-Key: <key>" "http://127.0.0.1:8403/api/dashboard/snapshot?range=7d"` 返回 200
- [ ] `API_KEY='<dashboard-key>' LLM_API_KEY='<llm-key>' ./dashboard/smoke.sh` 通过
- [ ] 写接口幂等测试通过：同一个 `Idempotency-Key` 重试不会重复创建成员
- [ ] 观察日志 5 分钟，无持续 `401` / `429` / `503` / 启动自检失败
