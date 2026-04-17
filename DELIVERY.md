# Haomai Dashboard 交付说明

## 一、客户仅需改动（2 行）

打开 `api/.env`（没有就从 `api/.env.example` 复制一份），改两行：

```
DATABASE_URL=postgresql://<user>:<pass>@<host>:<port>/<dbname>
TENANT_ID=<贵司在 coremate 的 tenant_id>
```

其他环境变量（`API_KEY` / `DB_SCHEMA`）通常保持默认即可。

## 二、目录结构

```
dashboard/
├── api/                后端 FastAPI（Python 3.10+，asyncpg）
│   ├── main.py
│   ├── queries.py
│   ├── auth.py
│   ├── db.py
│   ├── .env.example    环境变量模板（复制为 .env 后填值）
│   ├── requirements.txt
│   └── start.sh
├── src/                前端 Vite + TypeScript
│   └── ...
├── docs/dashboard/     前端构建产物（npm run build 输出）
├── .env.example        前端可选配置模板（生产通常无需改）
├── DELIVERY.md         本文档
├── package.json
└── vite.config.ts
```

## 三、启动步骤

### 后端（端口 8403）

```bash
cd api
pip install -r requirements.txt
cp .env.example .env
# 编辑 .env 填入 DATABASE_URL 和 TENANT_ID
./start.sh
```

验证：
```bash
curl http://localhost:8403/api/dashboard/snapshot?range=7d -H "X-API-Key: dev-key-guazi-2026"
```
应返回 JSON（含 highlights / aggs / charts 三个顶层 key）。

### 前端（构建产物部署）

```bash
cd dashboard  # 注意：如果已在根，就不需要 cd
npm install
npm run build
# 产物在 docs/dashboard/
```

把 `docs/dashboard/` 目录挂到任何静态服务器下即可（Nginx / Caddy / CDN）。

### 前端（本地开发，可选）

```bash
npm run dev
# Vite dev server 起在 :8402，通过 proxy 访问后端 :8403
```

## 四、Nginx 配置样例（生产部署）

```nginx
upstream dashboard_api {
    server 127.0.0.1:8403;
}

server {
    listen 80;
    server_name dashboard.example.com;

    # 前端静态
    root /var/www/haomai-dashboard/docs/dashboard;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # 后端 API 反向代理
    location /api/ {
        proxy_pass http://dashboard_api;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 30s;
    }
}
```

## 五、验收 Checklist

部署完成后，访问 dashboard，逐项核对：

- [ ] 首页加载 5 张高亮卡（评论/点赞/收藏/私信/触达），数字非 0（如果租户有业务数据）
- [ ] 切换日期范围 7d / 30d / 自定义 → 数字跟随变化
- [ ] 趋势图显示曲线（默认"完成任务"toggle）
- [ ] 切换 toggle（评论量/点赞量/私信/触达/运行时长）→ 曲线更新
- [ ] 任务表展开"获客触达"组 → 有任务明细（若该租户无此类 skill 则走 demo 兜底）
- [ ] 账号表 9 列（账号/完成数/算力豆/时长/评论/点赞/收藏/私信/触达量）
- [ ] "全部成员"下拉 → 弹搜索卡片，键入关键字可过滤
- [ ] 点底部"生成周报" → FAB loading → 报告面板滑入
- [ ] 切换日/周/月报 tab → 内容过渡平滑
- [ ] 浏览器 Console 无 JS error

## 六、故障排查

| 症状 | 排查方向 |
|---|---|
| 后端起不来，报 `TENANT_ID environment variable is required` | `api/.env` 没设 TENANT_ID |
| 后端起不来，报 `DATABASE_URL ... required` | `api/.env` 没设 DATABASE_URL |
| curl 返回 401 Unauthorized | header 没带 `X-API-Key: dev-key-guazi-2026`，或 API_KEY 改了 |
| 前端页面全是 demo 数据（不变） | 后端没起，或 Nginx `/api/` 反代没配对 |
| 累计运行时长永远"暂无对比" | 后端版本过旧，缺 `runtime_sec` 字段 —— 重新拉代码 |
| 成员下拉显示 Mock 名字 | `tryLiveMembers` 调用失败，检查 `/api/members` 接口 |

## 七、版本信息

- 前端：Vite 8 + TypeScript 6 + Chart.js
- 后端：FastAPI + asyncpg + PostgreSQL（依赖 coremate 库的 `users` / `skill` / `task_execution` / `execution_behavior_stat` / `credit_flow` 表）
- Python 要求：3.10+
- Node 要求：18+

## 八、后续扩展

- Docker 化部署（Dockerfile + docker-compose 待补）
- API Key 改 OAuth
- 离线缓存（PWA）

---

**联系方式**：遇到问题联系 Haomai 交付团队。
