# Dashboard 研发交接 Runbook

> 目标读者：会跑 Python / Node / bash 的研发同学。  
> 目标范围：不依赖 Codex CLI / Claude Code / agent-browser，只完成 4 件事：
> 1. 改 env，把 backend 切到自己的 prod DB + tenant。
> 2. 起 backend + frontend。
> 3. 跑 L1 `api-smoke`。
> 4. 读 report，判断 pass / fail。

本文只基于当前仓库实码回源整理，不靠口头约定补猜。

本次回源的真实文件：

- `dashboard/api/main.py`
- `dashboard/api/auth.py`
- `dashboard/api/requirements.txt`
- `dashboard/api/.env.example`
- `dashboard/e2e/`
- `dashboard/e2e/api-smoke.sh`
- `dashboard/e2e/run.sh`
- `dashboard/e2e/env.sh`
- `dashboard/package.json`
- 最近 5 个 commit：`ebc65ab` / `e2bea77` / `e46c9e7` / `ffacf33` / `9b9b46b`

先看 4 个“请确认”：

- `dashboard/frontend/package.json` 当前仓库里不存在；实际前端 Node 项目根在 `dashboard/package.json`。请确认交接口径以后统一写 `dashboard/package.json`。
- `dashboard/e2e/l1_api_smoke.py` 当前仓库里不存在；真实 L1 入口是 `dashboard/e2e/api-smoke.sh`，dispatcher 是 `dashboard/e2e/run.sh`。请确认交接口径以后统一写 shell 入口。
- `QUERY_TIMEOUT_SECONDS` 是本次交接要求里的 env 名，但当前代码没有读取它；`dashboard/api/queries.py` 里仍然是硬编码 `QUERY_TIMEOUT_SECONDS = 30.0`。请确认后续是否要补成真实 env。
- `dashboard/e2e/PLAYWRIGHT.md` 当前仓库里不存在；文末仍按要求保留“建设中”占位。请确认后续谁来补这个文件。

---

## 1. 架构简介

- 后端是 `FastAPI + asyncpg`，监听 `:8403`，入口在 `dashboard/api/main.py`，启动脚本在 `dashboard/api/start.sh`。
- 前端是 `Vite` 开发服务，监听 `:8402`，真实脚本来自 `dashboard/package.json`，端口配置在 `dashboard/vite.config.ts`。
- 两个服务必须独立启动，没有 monorepo 一键 orchestrator；前端只是在 dev 模式下把 `/api` 代理到 `http://localhost:8403`。
- 数据源不是 mock 文件；backend 直接连 PostgreSQL，`asyncpg.create_pool()` 使用 `DATABASE_URL` 建连接池。
- 这份 runbook 的默认 handoff 场景是：本机启动前后端，但 backend 连接你们自己的 prod DB / test tenant。

对应关系：

```text
dashboard/api/main.py      -> FastAPI backend on :8403
dashboard/package.json     -> Vite frontend scripts
dashboard/vite.config.ts   -> server.port = 8402, /api proxy -> :8403
dashboard/e2e/api-smoke.sh -> L1 API smoke，不依赖 Codex / agent-browser
```

两服务的职责边界：

- backend 负责鉴权、tenant 解析、DB 查询、写操作接口、`/health`。
- frontend 负责页面壳和本地 dev 代理，不直接连数据库。
- `api-smoke` 直接打 backend API；即使是本机联调，也必须先保证 backend 配好真实 DB 和 tenant。

---

## 2. 环境变量 checklist

这一节只写研发接手必须先看懂的 env。

### 2.1 Backend 必填 / 必看

当前 backend 代码里，`dashboard/api/db.py` 和 `dashboard/api/auth.py` 都会读取 `dashboard/api/.env`。

建议优先级：

1. 最稳妥：在当前 shell 里直接 `export` 环境变量，再启动 backend。
2. 次优：复制 `dashboard/api/.env.example` 为 `dashboard/api/.env` 并编辑。

Backend checklist：

| 变量名 | 是否必填 | 当前代码是否消费 | 说明 |
| --- | --- | --- | --- |
| `DATABASE_URL` | 是 | 是 | PostgreSQL DSN，`asyncpg.create_pool()` 直接使用。必须是 `postgresql://...` 或 `postgres://...`，不要填 `postgresql+asyncpg://...`。 |
| `TENANT_ID` | 强烈建议填 | 是 | 单租户 fallback 和 startup self-check 都会用到；必须是真实 tenant 的整型主键。 |
| `DASHBOARD_API_KEYS` | 强烈建议填 | 是 | 推荐写成单条 `api_key:tenant_id` 映射，便于 backend 和 E2E 用同一个 key。 |
| `DASHBOARD_ENV=prod` | 是 | 是 | `startup_self_check()` 只会在 `prod/production` 模式下把错误当 hard fail。 |
| `QUERY_TIMEOUT_SECONDS` | 按交接口径保留 | 否 | 当前仓库未接线；真实查询超时仍写死在 `dashboard/api/queries.py:117` 的 `30.0`。请确认。 |

本次交接最小推荐配置：

```dotenv
DATABASE_URL=postgresql://dashboard_rw:REDACTED@db.example.com:5432/coremate?sslmode=require
TENANT_ID=101
DASHBOARD_API_KEYS=handoff-key-20260419:101
DASHBOARD_ENV=prod
QUERY_TIMEOUT_SECONDS=30
```

关于 `DASHBOARD_API_KEYS` 的格式：

```dotenv
# 单租户也建议这么写，格式固定是 key:tenant_id
DASHBOARD_API_KEYS=handoff-key-20260419:101
```

如果你们更偏好单租户 fallback，也可以改用：

```dotenv
API_KEY=handoff-key-20260419
TENANT_ID=101
```

但这份文档统一推荐 `DASHBOARD_API_KEYS`，原因是：

- `auth.py` 本来就优先读 `DASHBOARD_API_KEYS`。
- `api-smoke` 只需要知道最终的 `E2E_API_KEY`，直接复用同一个 key 最省事。
- `startup_self_check()` 在 `DASHBOARD_ENV=prod` 下会检查 `DASHBOARD_API_KEYS` 或真实 `TENANT_ID` 是否存在。

### 2.2 最重要的 tenant 约束

`TENANT_ID` 必须是数据库里的整型主键，不是字符串 code。

这是硬约束，不是建议。

`dashboard/api/auth.py` 的关键逻辑：

- 第 29 行：`API_KEYS[key] = int(tid.strip())`
- 第 33 行：`API_KEYS[dev_key] = int(os.getenv("TENANT_ID", "1").strip())`

这意味着：

- `DASHBOARD_API_KEYS=some-key:8N88Z8` 会因为 `int("8N88Z8")` 失败，那个 key 条目会被直接丢弃。
- `API_KEY=some-key` 且 `TENANT_ID=8N88Z8` 会在 import 阶段直接因为 `int("8N88Z8")` 失败而启动异常。
- 你们手里如果只有 tenant code，例如 `8N88Z8`，不能直接填；必须先换成 DB 里的整数 `tenant.id`。

错误示例：

```dotenv
TENANT_ID=8N88Z8
DASHBOARD_API_KEYS=handoff-key:8N88Z8
```

正确示例：

```dotenv
TENANT_ID=101
DASHBOARD_API_KEYS=handoff-key:101
```

### 2.3 Backend 相关但非本次最低要求的 env

这些不是你们接手第一天必须改的，但知道一下能省很多排障时间：

| 变量名 | 当前代码状态 | 说明 |
| --- | --- | --- |
| `DB_POOL_MIN_SIZE` | 已接线 | `db.py` 里最小连接数，默认 `5`。 |
| `DB_POOL_MAX_SIZE` | 已接线 | `db.py` 里最大连接数，默认 `25`。 |
| `DB_COMMAND_TIMEOUT` | 已接线 | `asyncpg` command timeout，默认 `30.0`。 |
| `DB_STATEMENT_CACHE_SIZE` | 已接线 | statement cache，默认 `100`。 |
| `LOG_LEVEL` | 已接线 | root logger 级别。 |
| `DASHBOARD_WARMUP_TENANT_IDS` | 已接线 | 启动预热租户列表；默认从 `DASHBOARD_API_KEYS` 推导。 |

### 2.4 E2E 必填 / 必看

当前 `dashboard/e2e/env.sh` 的行为是：

- `TEST_ENV=local` 时，会自动回落到本地默认值：
  - `E2E_API_BASE=http://localhost:8403`
  - `E2E_FRONTEND_URL=http://localhost:8402`
  - `E2E_API_KEY=dev-key-guazi-2026`
  - `E2E_TENANT_ID=1`
- `TEST_ENV=staging` 或 `TEST_ENV=prod` 时，4 个 E2E 变量都必须显式设置。

这意味着：  
即使你只是本机启动服务，但 backend 已经切到了你们自己的 prod DB + tenant，也建议把 `TEST_ENV` 设成 `prod`，强制你显式声明所有 E2E 输入，避免误用 demo 默认值。

E2E checklist：

| 变量名 | 是否必填 | 当前代码是否消费 | 说明 |
| --- | --- | --- | --- |
| `E2E_API_BASE` | 是 | 是 | `api-smoke.sh` 实际请求的 backend base URL。 |
| `E2E_FRONTEND_URL` | 是 | `api-smoke.sh` 不直接用，但 `env.sh` 在 `TEST_ENV=prod` 下强制要求 | 推荐仍填 `http://localhost:8402`，否则 env loader 直接报错。 |
| `E2E_API_KEY` | 是 | 是 | 透传到请求头 `X-API-Key`。 |
| `E2E_TENANT_ID` | 是 | 报告展示 + 其他脚本会消费 | 报告头会写入它；`repro_delete_member_race.py` 也会把它按 `int()` 解析。 |

推荐的 `dashboard/e2e/.env`：

```dotenv
TEST_ENV=prod
E2E_API_BASE=http://localhost:8403
E2E_FRONTEND_URL=http://localhost:8402
E2E_API_KEY=handoff-key-20260419
E2E_TENANT_ID=101
```

### 2.5 建议的 env 配置策略

如果你们只是交接验证，不打算立刻做 systemd / Docker：

```bash
cp dashboard/api/.env.example dashboard/api/.env
# 用你熟悉的编辑器修改 dashboard/api/.env
cp dashboard/e2e/.env.example dashboard/e2e/.env
# 用你熟悉的编辑器修改 dashboard/e2e/.env
```

如果你们已经有统一的 shell / CI 注入环境变量方式，更推荐这样启动：

```bash
export DATABASE_URL='postgresql://dashboard_rw:REDACTED@db.example.com:5432/coremate?sslmode=require'
export TENANT_ID='101'
export DASHBOARD_API_KEYS='handoff-key-20260419:101'
export DASHBOARD_ENV='prod'
export QUERY_TIMEOUT_SECONDS='30'

export TEST_ENV='prod'
export E2E_API_BASE='http://localhost:8403'
export E2E_FRONTEND_URL='http://localhost:8402'
export E2E_API_KEY='handoff-key-20260419'
export E2E_TENANT_ID='101'
```

---

## 3. 网络前提

把 backend 切到你们自己的 prod DB + tenant 前，先确认网络路径。

必须满足：

- 当前执行 backend 的机器能访问 prod DB。
- 如果 prod DB 在 VPC / 内网，需要先挂 VPN、跳板机或白名单。
- backend 到 DB 的 TCP `5432` 出站必须通。
- 如果 DSN 带 `sslmode=require`，本机 / 容器要能完成 TLS 握手。

最小检查项：

```bash
# 先确认 DNS / host 可达
nc -vz db.example.com 5432
```

如果机器上没有 `nc`，用 Python 做一个最小 TCP 探测：

```bash
python3 - <<'PY'
import socket
host = "db.example.com"
port = 5432
sock = socket.socket()
sock.settimeout(5)
try:
    sock.connect((host, port))
    print(f"tcp ok: {host}:{port}")
finally:
    sock.close()
PY
```

如果本机装了 `psql`，再补一个真正的 DB 握手：

```bash
psql 'postgresql://dashboard_rw:REDACTED@db.example.com:5432/coremate?sslmode=require' -c 'select 1;'
```

常见事实：

- frontend 不需要连 DB。
- `api-smoke` 不需要直接连 DB，但它会通过 backend 间接打到 DB。
- 如果 `/health` 返回 `503 DB not responsive`，优先先看 DB 网络 / 权限，而不是先怀疑前端。

---

## 4. 依赖安装

### 4.1 Backend 依赖

真实 Python 依赖来自 `dashboard/api/requirements.txt`：

- `fastapi==0.136.0`
- `uvicorn==0.34.0`
- `asyncpg==0.30.0`
- `python-dotenv==1.0.1`
- `cachetools>=5.0`
- `slowapi==0.1.9`

建议在 repo 内单独建 venv：

```bash
cd /Users/lishehao/Desktop/Project/Yihang/Mi
python3 -m venv dashboard/.venv
source dashboard/.venv/bin/activate
pip install --upgrade pip
pip install -r dashboard/api/requirements.txt
```

### 4.2 Frontend 依赖

真实 Node 项目根是 `dashboard/`，不是 `dashboard/frontend/`。

安装命令：

```bash
cd /Users/lishehao/Desktop/Project/Yihang/Mi/dashboard
npm install
```

如果你想顺手验证 TypeScript / build 没坏：

```bash
cd /Users/lishehao/Desktop/Project/Yihang/Mi/dashboard
npm run build
```

真实脚本来自 `dashboard/package.json`：

```text
dev          -> vite
build        -> tsc --noEmit && vite build
preview      -> vite preview
e2e:api      -> bash e2e/run.sh api-smoke
e2e:ui       -> bash e2e/run.sh ui-smoke
e2e:visual   -> bash e2e/run.sh visual
```

### 4.3 `api-smoke` 额外依赖

`dashboard/e2e/api-smoke.sh` 启动时会显式检查这 3 个命令：

- `curl`
- `jq`
- `python3`

因此在开跑前先确认：

```bash
command -v curl
command -v jq
command -v python3
```

如果 `jq` 没装，`api-smoke.sh` 会直接退出，不会生成有效报告。

---

## 5. 启动命令 + 验证

这一节按“两个终端”写，方便直接 copy-paste。

### 5.1 终端 A：起 backend

第一次接手建议先用 `start.sh`，因为仓库已经给了脚本：

```bash
cd /Users/lishehao/Desktop/Project/Yihang/Mi
source dashboard/.venv/bin/activate
cp -n dashboard/api/.env.example dashboard/api/.env
# 用你熟悉的编辑器修改 dashboard/api/.env
cd dashboard/api
./start.sh
```

`start.sh` 的真实行为：

- `source .env`
- 清掉 `__pycache__`
- `export PYTHONDONTWRITEBYTECODE=1`
- `uvicorn main:app --host 0.0.0.0 --port 8403 --reload`

如果你不想用 `--reload`，可以改用：

```bash
cd /Users/lishehao/Desktop/Project/Yihang/Mi
source dashboard/.venv/bin/activate
cd dashboard/api
python3 main.py
```

### 5.2 backend 健康检查

backend 起好后，先直接打 `/health`：

```bash
curl -sS http://localhost:8403/health | jq .
```

期望输出形状：

```json
{
  "ok": true,
  "pool": {
    "size": 5,
    "idle_size": 5,
    "free": 0
  }
}
```

注意：

- `size` / `idle_size` / `free` 的具体数字会随连接池状态变化，不要求和示例完全一致。
- 关键是 HTTP 200 + `"ok": true`。
- 如果返回 `503` 且 detail 是 `DB not responsive`，先查 DB 网络 / 权限 / DSN。

### 5.3 backend 鉴权 + tenant 检查

`/health` 只证明 DB 通；还要补一个带 API key 的真实业务请求：

```bash
curl -sS 'http://localhost:8403/api/dashboard/snapshot?range=7d' \
  -H 'X-API-Key: handoff-key-20260419' \
  | jq '{
      has_highlights: has("highlights"),
      has_charts: has("charts"),
      has_aggs: has("aggs"),
      has_ops_trend: has("ops_trend")
    }'
```

期望输出：

```json
{
  "has_highlights": true,
  "has_charts": true,
  "has_aggs": true,
  "has_ops_trend": true
}
```

如果这一步 401：

- 先查 `DASHBOARD_API_KEYS` 格式。
- 再查你传入的 key 是否和 `.env` 里一致。
- 再查 `tenant_id` 是否写成了字符串 code。

### 5.4 终端 B：起 frontend

另开一个终端：

```bash
cd /Users/lishehao/Desktop/Project/Yihang/Mi/dashboard
npm run dev
```

真实端口来自 `dashboard/vite.config.ts`：

```ts
server: {
  port: 8402,
  proxy: {
    '/api': { target: 'http://localhost:8403', changeOrigin: true },
  },
}
```

### 5.5 frontend 最小检查

先确认 Vite 自己起来了：

```bash
curl -sS http://localhost:8402 | sed -n '1,20p'
```

期望：

- 返回 HTML，而不是连接拒绝。
- 输出里应能看到 `<!doctype html>` 或 `<html`。

再验证前端 dev proxy 是通的：

```bash
curl -sS 'http://localhost:8402/api/dashboard/snapshot?range=7d' \
  -H 'X-API-Key: handoff-key-20260419' \
  | jq '{
      has_highlights: has("highlights"),
      has_charts: has("charts"),
      has_aggs: has("aggs"),
      has_ops_trend: has("ops_trend")
    }'
```

如果 frontend dev server 正常，且 proxy 正确，这个结果应该和直接打 `:8403` 一致。

### 5.6 一个可执行的最短联调顺序

按顺序跑，不要跳步：

1. 先起 backend。
2. `curl http://localhost:8403/health`。
3. 再打一次带 `X-API-Key` 的 `/api/dashboard/snapshot?range=7d`。
4. 再起 frontend。
5. `curl http://localhost:8402`。
6. 再打一次 `http://localhost:8402/api/dashboard/snapshot?range=7d`。

如果第 2 步不通，不用看前端。  
如果第 2 步通但第 3 步 401，先修 env。  
如果第 3 步通但第 6 步不通，才看 Vite / 代理。

---

## 6. 跑 L1 api-smoke + 看 report

先说结论：

- L1 不需要 Codex CLI。
- L1 不需要 Claude Code。
- L1 不需要 agent-browser。
- 当前真实入口不是 Python 文件，而是 `dashboard/e2e/api-smoke.sh`。

### 6.1 `dashboard/e2e/` 目录的真实布局

```text
dashboard/e2e/
├── api-smoke.sh                # L1 API smoke，纯 shell
├── run.sh                      # dispatcher，npm scripts 也是调它
├── env.sh                      # TEST_ENV / E2E_* env loader
├── ui-smoke.ts                 # L2，依赖浏览器自动化
├── visual-smoke.ts             # L3，依赖 codex-visual / agent-browser
├── exploratory/
│   ├── run.sh
│   ├── prompt.md
│   ├── prompt-a.md
│   ├── prompt-b.md
│   └── prompt-c.md
├── reports/                    # 每次 run 的输出目录
└── repro_delete_member_race.py # delete race 复现 / 回归辅助脚本
```

### 6.2 `api-smoke.sh` 实际做了什么

真实检查项包括：

- `GET /api/dashboard/snapshot?range=today`
- `GET /api/dashboard/snapshot?range=yesterday`
- `GET /api/dashboard/snapshot?range=7d`
- `GET /api/dashboard/snapshot?range=30d`
- `GET /api/dashboard/highlights?range=7d`
- `GET /api/dashboard/charts?range=7d`
- `GET /api/dashboard/aggs?range=7d`
- `GET /api/dashboard/ops_trend?range=7d`
- `GET /api/transactions?page=1&page_size=10`
- `GET /api/audit-log?page=1&page_size=10`
- `POST /api/members` 两次相同 `Idempotency-Key`，校验返回体一致
- cleanup `DELETE /api/members/{id}`
- 二次 `snapshot?range=7d`，看 cache hit timing

它生成报告的真实变量：

```bash
RUN_ID="${RUN_ID:-$(date -u +'%Y%m%dT%H%M%SZ')}"
REPORT_DIR="dashboard/e2e/reports/$RUN_ID"
REPORT="$REPORT_DIR/api-smoke.md"
```

### 6.3 直接跑脚本

最直接、最少抽象的一种跑法：

```bash
cd /Users/lishehao/Desktop/Project/Yihang/Mi
RUN_ID="handoff-$(date -u +'%Y%m%dT%H%M%SZ')" \
TEST_ENV=prod \
E2E_API_BASE='http://localhost:8403' \
E2E_FRONTEND_URL='http://localhost:8402' \
E2E_API_KEY='handoff-key-20260419' \
E2E_TENANT_ID='101' \
bash dashboard/e2e/api-smoke.sh
```

注意：

- 即使 `api-smoke.sh` 本身不直接打 frontend，`TEST_ENV=prod` 时 `dashboard/e2e/env.sh` 仍然要求 `E2E_FRONTEND_URL` 必填。
- 如果你忘了 `E2E_FRONTEND_URL`，脚本会在 env loader 阶段直接报错。

### 6.4 通过 npm script 跑

如果你更想沿着 package script 跑：

```bash
cd /Users/lishehao/Desktop/Project/Yihang/Mi/dashboard
RUN_ID="handoff-$(date -u +'%Y%m%dT%H%M%SZ')" \
TEST_ENV=prod \
E2E_API_BASE='http://localhost:8403' \
E2E_FRONTEND_URL='http://localhost:8402' \
E2E_API_KEY='handoff-key-20260419' \
E2E_TENANT_ID='101' \
npm run e2e:api
```

`npm run e2e:api` 的真实展开是：

```bash
bash e2e/run.sh api-smoke
```

而 `dashboard/e2e/run.sh` 最终会调用：

```bash
bash dashboard/e2e/api-smoke.sh
```

### 6.5 report 去哪里看

默认 report 路径：

```text
dashboard/e2e/reports/{RUN_ID}/api-smoke.md
```

建议跑之前自己显式设置 `RUN_ID`，否则目录名是 UTC 时间戳，排查时不如自定义前缀直观。

比如：

```bash
REPORT_DIR='dashboard/e2e/reports/handoff-20260419T090000Z'
sed -n '1,120p' "$REPORT_DIR/api-smoke.md"
```

### 6.6 一个真实 report 长什么样

仓库里现有报告示例节选：

```md
# API Smoke

- Run ID: `manual-20260419T092747Z`
- Generated: `2026-04-19T09:45:11Z`
- API Base: `http://127.0.0.1:8000`
- Tenant: `1`

| Check | Result | Detail |
| --- | --- | --- |
| GET /api/dashboard/snapshot?range=today | ✅ | status=200 success metric present (0.797321s) |
| GET /api/dashboard/snapshot?range=yesterday | ✅ | status=200 success metric present (7.970302s) |
| GET /api/dashboard/snapshot?range=7d | ✅ | status=200 success metric present (6.754568s) |
| GET /api/dashboard/snapshot?range=30d | ✅ | status=200 success metric present (9.365941s) |
| GET /api/dashboard/highlights?range=7d | ✅ | status=200 (0.001947s) |
| ... | ... | ... |
| POST /api/members idempotency | ✅ | identical responses (4.142146s, 0.876336s) |
| Cleanup DELETE /api/members/19980293 | ✅ | deleted in 2.595228s |
| Cache hit timing snapshot?range=7d | ✅ | warm=8.840242s cached=0.005766s (5ms) |
```

### 6.7 如何判断 pass / fail

这里有一个非常重要的实现细节：

- `api-smoke.sh` 只会在 transport error 时把 `INFRA_ERROR=1` 并 `exit 1`。
- 某个业务检查项即使写出 `❌`，脚本也不一定非零退出。
- 所以不能只看 shell exit code；必须同时看 report 内容。

推荐判定规则：

1. shell exit code 非 0：直接 `FAIL`。
2. report 里存在任意 `❌`：`FAIL`。
3. report 里没有 `❌`，但有任意 `⚠️`：`NOT CLEAN PASS`，需要人工确认。
4. report 全是 `✅`：`PASS`。

推荐的最小判定命令：

```bash
REPORT_DIR='dashboard/e2e/reports/handoff-20260419T090000Z'
REPORT_FILE="$REPORT_DIR/api-smoke.md"

sed -n '1,120p' "$REPORT_FILE"
grep -n '❌' "$REPORT_FILE" || true
grep -n '⚠️' "$REPORT_FILE" || true
```

如果你想把判断写得更机械一点：

```bash
REPORT_DIR='dashboard/e2e/reports/handoff-20260419T090000Z'
REPORT_FILE="$REPORT_DIR/api-smoke.md"

if grep -q '❌' "$REPORT_FILE"; then
  echo 'FAIL'
elif grep -q '⚠️' "$REPORT_FILE"; then
  echo 'REVIEW'
else
  echo 'PASS'
fi
```

### 6.8 L1 的边界

L1 `api-smoke` 只覆盖：

- backend 基础连通性
- 关键 dashboard 聚合接口
- 基本列表接口
- 一个幂等写入链路
- 一次 cache hit timing

L1 不覆盖：

- 真正的浏览器交互
- 视觉回归
- responsive 断点
- drag compare 手势细节
- 下载文件内容对比

这些属于 L2 / L3，不在本文交接最小目标里。

---

## 7. 数据污染警告

`api-smoke.sh` 不是纯只读。

必须明确告诉接手研发：

- 它会真实写库。
- 它会真实创建成员。
- 它会真实写幂等记录。
- 它会真实写 audit log。
- 它随后会做 cleanup delete，但 cleanup 本身也会再写一条 audit log。

所以：

- 只能对 test tenant / staging tenant / 专门的 handoff tenant 跑。
- 不要对真客户 tenant 跑。
- 不要对正在被业务侧观察的 tenant 跑。

`api-smoke.sh` 的写路径拆解如下：

| 步骤 | 真实写入 | 说明 |
| --- | --- | --- |
| 第一次 `POST /api/members` | `users` | 创建名为 `E2E Idempotency Sentinel` 的成员。 |
| 第一次 `POST /api/members` | `user_balance` | 插入余额记录，当前脚本里 `initial_balance=0`。 |
| 第一次 `POST /api/members` | `enterprise_audit_log` | 写入一条 `ADD_MEMBER`。 |
| 第一次 `POST /api/members` | `mutation_idempotency` | 写入一条幂等记录。 |
| 第二次同 key `POST /api/members` | 预期不新增业务写入 | 直接命中幂等返回。 |
| cleanup `DELETE /api/members/{id}` | `users` | 软删除该成员。 |
| cleanup `DELETE /api/members/{id}` | `enterprise_audit_log` | 再写一条 `REMOVE_MEMBER`。 |

因此，按应用层代码可确认的最小污染量是：

- 1 条 `ADD_MEMBER` audit
- 1 条 `REMOVE_MEMBER` audit
- 1 条 `mutation_idempotency` 记录

为什么这里仍然提醒“2-3 条 audit log 风险”：

- 从应用代码看，稳定能确认的是 2 条业务侧 audit。
- 如果你们的 prod DB 上还有额外 trigger、审计镜像、CDC、外围日志桥接，实际落盘观察可能会超过 2 条。
- 所以交接口径上仍按“2-3 条甚至更多外围审计痕迹”处理最安全。

一个建议做法：

```bash
# 建议专门开一个 handoff tenant / staging tenant
TENANT_ID=101
E2E_TENANT_ID=101
```

不要做的事：

```bash
# 不要把下面这种真客户 tenant 拿来直接跑 smoke
TENANT_ID=<生产客户正在看的 tenant>
E2E_TENANT_ID=<生产客户正在看的 tenant>
```

---

## 8. 已知 trade-offs

这一节不是“阻塞上线的问题清单”，而是交接后研发需要主动记住的行为边界。

### 8.1 snapshot 不是事务一致快照

来源：

- `ffacf33` commit message 明确写了：`snapshot 10 parallel subqueries not txn-consistent`
- 当前 `aggregate_snapshot` 也是并行 gather 多个子查询拼装结果

现状：

- 首屏 `snapshot` 是多个子查询并发拼出来的，不是单事务内的严格一致快照。
- 对 demo / dashboard 读场景通常是可接受的。

影响：

- 极端高并发、恰好撞上底层写入时，不排除不同卡片和表格来自略微不同的读时点。
- 这不是数据错乱，而是并发聚合换来的性能 trade-off。

本轮交接口径：

- demo 场景里曾有“40 并发实测 0 异常”的口头结论。
- 这个数字不在当前仓库源码里，建议你们在目标环境自己复测，不要把它当成正式 SLA。

### 8.2 `delete_member` race 已修，不再是已知 blocker

来源：

- `e2bea77` commit
- `dashboard/api/queries.py` 现在是单条 `UPDATE ... WHERE NOT is_deleted RETURNING`

现状：

- 旧实现是 `SELECT -> UPDATE`，并发双删可能都穿过检查并各写一条 `REMOVE_MEMBER` audit。
- 现实现已改为条件 `UPDATE ... RETURNING`，DB 级别原子化。

影响：

- 两个并发 DELETE 打同一个 member 时，现在预期是：
  - 两边都可能返回 200
  - 但只应落一条 `REMOVE_MEMBER` audit

交接建议：

- 这个点不用再当已知 bug 处理。
- 但如果你们后续改动了删除逻辑，建议用 `dashboard/e2e/repro_delete_member_race.py` 复跑一次。

### 8.3 CSV 导出是“全量导出优先”，不严格跟 UI 搜索视图

这一条可以直接从当前前端代码验证。

`dashboard/src/modules/accounts.ts`：

- 表格渲染走 `getVisibleAccounts()`，会受 `accountSearchQuery` 影响。
- 但 `exportAccountCSV()` 直接对 `accountList.map(...)` 全量导出，没有走 `getVisibleAccounts()`。

这意味着：

- 账号表你在 UI 里搜过关键字，不代表导出的 CSV 只会导出当前可见子集。
- 当前实现更偏“导出全量数据”，而不是“导出当前筛选视图”。

补充：

- `records.ts` 里的交易历史 / 操作日志导出会重新分页抓全量，但仍会带 member/type/date/action 这些查询参数。
- 所以“CSV 导出不跟 UI 搜索过滤走”这句话，最准确地说，当前最明确成立的是账号表搜索视图这一路。

### 8.4 Drag compare 的 `mouseup` 清空是设计，不是 bug

来源：

- `dashboard/src/modules/charts.ts` 在 `mouseup` 时会 `clearOpsRangeOverlay()` + `hideOpsRangeCompareSummary()`
- `dashboard/e2e/exploratory/prompt-a.md` 明确写了：这是 `iOS Stocks` 风格预期行为

现状：

- 鼠标按下并拖动时，要看到单段高亮 selection + bubble。
- 鼠标松开后，高亮和 summary 会清空，回到普通 hover 状态。

影响：

- 如果测试同学看到 `mouseup` 后 selection 消失，不要直接报 bug。
- 真正该报 bug 的条件是：
  - mid-drag 根本没有高亮
  - 或出现多段高亮

### 8.5 KPI count-up 对整数字段做 `Math.round`

来源：

- `ffacf33` commit message：`KPI count-up integer guard`
- `dashboard/src/modules/charts.ts` 里 `getAnimatedHighlightValue()`：
  - `Number.isInteger(from) && Number.isInteger(target)` 时返回 `Math.round(value)`

现状：

- 整数 KPI 在 count-up 动画过程中会强制取整。
- 这是故意避免动画时出现 `12.3`、`12.8` 这类 UI 噪声。

影响：

- 如果产品或设计后面希望连整数 KPI 也展示平滑小数过渡，需要显式改这段逻辑。
- 当前不要把“动画中整数值被 round”误判为 bug。

---

## 9. 常见坑 troubleshooting

这一节按“现象 -> 原因 -> 解法”写。

### 9.1 现象：所有业务 API 都 401

原因：

- 最常见是 `DASHBOARD_API_KEYS` 没配对。
- `auth.py` 只认 `key:tenant_id` 这种逗号分隔格式。
- 如果你把它写成了 JSON、写丢冒号、或者 tenant 不是 int，这个 key 可能根本不会被加载进 `API_KEYS`。

解法：

```dotenv
# 正确
DASHBOARD_API_KEYS=handoff-key-20260419:101

# 错误
DASHBOARD_API_KEYS={"handoff-key-20260419":"101"}
DASHBOARD_API_KEYS=handoff-key-20260419
DASHBOARD_API_KEYS=handoff-key-20260419:8N88Z8
```

再用这个命令复核：

```bash
curl -sS 'http://localhost:8403/api/dashboard/snapshot?range=7d' \
  -H 'X-API-Key: handoff-key-20260419' \
  | jq .
```

### 9.2 现象：tenant 配了，但启动时报错或请求 500 / 401

原因：

- 你把 `TENANT_ID` 或 `DASHBOARD_API_KEYS` 里的 tenant 写成了字符串 code，例如 `8N88Z8`。
- `auth.py` 第 29 / 33 行都会强制 `int()`。

解法：

- 必须改成数据库里的整型主键。
- 如果你手里只有业务 code，先去找平台 / DBA 换成真正的 `tenant.id`。

自查示例：

```bash
grep -n '^TENANT_ID=' dashboard/api/.env
grep -n '^DASHBOARD_API_KEYS=' dashboard/api/.env
```

### 9.3 现象：`curl 127.0.0.1:8402` 失败，但 `npm run dev` 看起来已经起来了

原因：

- Vite 在某些机器上可能只绑定到 `localhost` / IPv6 loopback。
- 这时 `127.0.0.1` 不一定通。

解法：

```bash
# 优先用 localhost
curl -sS http://localhost:8402 | sed -n '1,10p'
```

如果你非要显式 host，可以自己这样起：

```bash
cd /Users/lishehao/Desktop/Project/Yihang/Mi/dashboard
npm run dev -- --host localhost
```

### 9.4 现象：backend 跑久了以后，`snapshot` 偶发 503

原因：

- 当前已知经验里，长时间空闲后连接池可能出现 stale 连接感知不及时的情况。
- `/health` 和 `snapshot` 本质都会打 DB，最后表现成 `DB not responsive` 或 query timeout。

解法：

```bash
# 最快的现场处理办法就是重启 backend
cd /Users/lishehao/Desktop/Project/Yihang/Mi/dashboard/api
./start.sh
```

然后立刻复核：

```bash
curl -sS http://localhost:8403/health | jq .
curl -sS 'http://localhost:8403/api/dashboard/snapshot?range=7d' \
  -H 'X-API-Key: handoff-key-20260419' \
  | jq '{has_highlights: has("highlights")}'
```

### 9.5 现象：Chrome headless crash，日志里反复出现 allocator / multiple times

原因：

- 这一般不是 L1 `api-smoke` 的问题，而是 L2 / L3 浏览器自动化残留进程的问题。
- 常见是之前的 `agent-browser-chrome-*` 没清干净。

解法：

```bash
pkill -f 'agent-browser-chrome-' || true
pkill -f 'chrome.*remote-debugging-port' || true
```

然后再重启浏览器自动化链路。  
如果你这次只做 L1 handoff，直接跳过浏览器相关测试即可。

### 9.6 现象：`api-smoke.sh` 一启动就退出

原因：

- 缺 `curl` / `jq` / `python3` 其中之一。
- 或者 `TEST_ENV=prod` 下没配全 `E2E_API_BASE` / `E2E_FRONTEND_URL` / `E2E_API_KEY` / `E2E_TENANT_ID`。

解法：

```bash
command -v curl
command -v jq
command -v python3

env | grep '^TEST_ENV='
env | grep '^E2E_API_BASE='
env | grep '^E2E_FRONTEND_URL='
env | grep '^E2E_API_KEY='
env | grep '^E2E_TENANT_ID='
```

---

## 10. Commits 回顾

下面这 5 个 commit 是这轮 handoff 最值得知道的上下文。

| Commit | 一句话总结 | 交接时为什么要知道 |
| --- | --- | --- |
| `ffacf33` | post-hardening：补了 3 个 bug fix、L3 E2E multi-instance、以及 adversarial review follow-up。 | 这里面直接影响了首屏性能、成员写接口、CSV / drag compare / KPI 动画等当前行为。 |
| `e46c9e7` | responsive fix：通过 `min-width: 1280` + 横向滚动容器修掉 390 / 430 / 800 viewport 裁切。 | 说明当前 responsive 策略不是 mobile-first 重做，而是“保桌面布局 + 允许横向滚动”。 |
| `e2bea77` | delete race fix：把 `SELECT -> UPDATE` 改成原子 `UPDATE ... RETURNING`。 | 交接后如果有人重构成员删除逻辑，这是最容易被回归掉的并发点。 |
| `ebc65ab` | `gen_metrics_doc.py` 改成项目相对路径输出，去掉作者机器绝对路径依赖。 | 说明仓库近期在做“本机可跑 / 团队可接”的便携化修正。 |
| `9b9b46b` | per-key cache locks + dev-mode startup self-check。 | 解释了为什么现在 cold miss 并发比之前稳，以及为什么 `DASHBOARD_ENV=prod` 会触发更严格的启动检查。 |

如果你只想记一句：

- `ffacf33` 看行为边界
- `e46c9e7` 看 responsive 取舍
- `e2bea77` 看并发删除
- `ebc65ab` 看工具便携性
- `9b9b46b` 看缓存锁和 prod 自检

---

交接落地时，建议你们至少保留下面这组最小命令历史，便于别人复现：

```bash
# 1. backend health
curl -sS http://localhost:8403/health | jq .

# 2. backend auth + tenant smoke
curl -sS 'http://localhost:8403/api/dashboard/snapshot?range=7d' \
  -H 'X-API-Key: handoff-key-20260419' \
  | jq '{has_highlights: has("highlights"), has_charts: has("charts")}'

# 3. frontend proxy smoke
curl -sS 'http://localhost:8402/api/dashboard/snapshot?range=7d' \
  -H 'X-API-Key: handoff-key-20260419' \
  | jq '{has_highlights: has("highlights"), has_charts: has("charts")}'

# 4. L1 api-smoke
RUN_ID="handoff-$(date -u +'%Y%m%dT%H%M%SZ')" \
TEST_ENV=prod \
E2E_API_BASE='http://localhost:8403' \
E2E_FRONTEND_URL='http://localhost:8402' \
E2E_API_KEY='handoff-key-20260419' \
E2E_TENANT_ID='101' \
bash dashboard/e2e/api-smoke.sh
```

L2/L3 Playwright 化测试另见 e2e/PLAYWRIGHT.md（建设中）
