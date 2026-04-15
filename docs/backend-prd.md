# Dashboard 后端 API 需求文档 (PRD)

## 1. 背景

Dashboard（企业管理后台）目前使用纯前端 mock 数据。本文档基于对 `coremate-source` 后端的分析，列出已有可复用的 API 和需要新增的接口。

**后端技术栈**：NestJS 11 + PostgreSQL + Prisma 7 + Better-Auth（手机号 OTP）

---

## 2. 现有后端能力摘要

后端已有 **102+ 个端点**，覆盖 19 个模块：

| 模块 | 端点前缀 | 可复用程度 |
|------|----------|-----------|
| 任务管理 | `/tasks` | 高 — 任务 CRUD、执行历史、统计同步 |
| 执行管理 | `/executions` | 高 — 执行详情、取消/暂停/恢复 |
| 积分系统 | `/user/balance`, `/usage/*`, `/admin/credits/*` | 高 — 余额查询、流水、管理员操作 |
| 充值系统 | `/recharge/*`, `/admin/recharge/*` | 高 — 套餐、订单、微信/支付宝回调 |
| 认证 | `/user-auth/*` | 直接复用 — OTP 登录、session |
| 技能管理 | `/agent/skills` | 中 — Skill CRUD，缺聚合统计 |
| 设备日志 | `/device-logs` | 中 — 日志查询，缺设备状态聚合 |
| 租户管理 | `/tenant/subscription` | 低 — 仅订阅状态 |
| 用户管理 | `/users/*` | 低 — 仅 onboarding，缺企业成员管理 |

---

## 3. Dashboard 四大模块 → API 映射

### 3.1 运营看板

| 数据需求 | 现有 API | 状态 |
|----------|----------|------|
| 基础指标（触达/完成/评论/私信/运行时长） | `task_execution` 表有原始数据 | **需新增聚合 API** |
| 平台触达分布 | `user_task.related_platforms` | **需新增统计 API** |
| 互动类型分布（评论/点赞/收藏/私信） | `task_execution_feedback` | **需新增统计 API** |
| 趋势折线图（多维时间序列） | 无 | **需新增** |
| 成就徽章 | 无 | **需新增（含数据库表）** |
| 指令集产出（每个 skill 的完成数） | `skill` + `task_execution` | **需新增关联查询** |
| AI 洞察文案 | 无 | **P2 — 可后期加** |

### 3.2 企业管理

| 数据需求 | 现有 API | 状态 |
|----------|----------|------|
| 钱包余额/总充值/已消耗/成员数 | `user_balance` + `recharge_order` + `credit_flow` | **需新增聚合 API** |
| 近期交易列表 | `credit_flow` + `enterprise_recharge_record` | **需新增整合 API** |
| 成员 CRUD | `/users` 仅有 onboarding | **需新增完整 CRUD** |
| 积分分发 | `/admin/credits/add` 存在 | **可复用，需调权限** |
| 充值 | `/recharge/*` 存在 | **直接复用** |

### 3.3 操作记录

| 数据需求 | 现有 API | 状态 |
|----------|----------|------|
| 交易历史（分页+日期筛选） | `credit_flow` 表存在 | **需新增查询 API** |
| 操作日志（分页+类型筛选） | `enterprise_audit_log` 表存在 | **需新增查询 API** |
| 执行记录（分页+平台/设备筛选） | `task_execution` + `skill` | **需新增关联查询** |
| CSV 导出 | 无 | **需新增批量导出** |

### 3.4 周报/月报

| 数据需求 | 现有 API | 状态 |
|----------|----------|------|
| 周报数据聚合 | 无 | **P2 — 基于上述统计 API 组合** |

---

## 4. 需新增的 API 清单

### P0 — 核心（Dashboard 基本可用）

#### 4.1 运营看板统计
```
GET /dashboard/stats
Query: timeRange (today | 7d | 30d | custom)
       customStart? (ISO date)
       customEnd? (ISO date)
Response: {
  reach: number,
  completedTasks: number,
  comments: number,
  likes: number,
  favorites: number,
  messages: number,
  runtime: number,       // 分钟
  successRate: number    // %
}
```

#### 4.2 平台分布
```
GET /dashboard/platform-distribution
Query: timeRange, customStart?, customEnd?
Response: [
  { platform: "xiaohongshu", count: 162, percentage: 60.9 },
  ...
]
```

#### 4.3 互动分布
```
GET /dashboard/interaction-breakdown
Query: timeRange, customStart?, customEnd?
Response: [
  { type: "comment", count: 232, percentage: 40.1 },
  { type: "like", count: 155, percentage: 26.8 },
  { type: "favorite", count: 160, percentage: 27.7 },
  { type: "message", count: 31, percentage: 5.4 }
]
```

#### 4.4 趋势时间序列
```
GET /dashboard/trends
Query: timeRange, customStart?, customEnd?
       metrics[] (completedTasks | comments | likes | messages | reach | runtime)
Response: {
  labels: string[],
  datasets: [
    { name: "completedTasks", data: number[] },
    ...
  ]
}
```

#### 4.5 企业钱包聚合
```
GET /enterprise/wallet
Response: {
  balance: number,
  totalRecharge: number,
  totalDeduct: number,
  memberCount: number,
  memberLimit: number
}
```

#### 4.6 企业成员 CRUD
```
GET    /enterprise/members?page=1&pageSize=10&search=keyword
POST   /enterprise/members        { name, phone, role }
PUT    /enterprise/members/:id    { name, phone, role }
DELETE /enterprise/members/:id

Response item: { id, name, phone, role, balance, joinDate }
```

### P1 — 重要（完整功能）

#### 4.7 交易历史
```
GET /enterprise/records/transactions
Query: page, pageSize, startDate?, endDate?, member?, type?
Response: {
  data: [{ date, member, type, description, delta, balance }],
  pagination: { page, pageSize, total, totalPages }
}
```

#### 4.8 操作日志
```
GET /enterprise/records/operations
Query: page, pageSize, startDate?, endDate?, type?
       type: 成员变更 | 积分操作 | 设备管理 | 指令集配置
Response: {
  data: [{ date, operator, operationType, target, result }],
  pagination: { ... }
}
```

#### 4.9 执行记录
```
GET /enterprise/records/executions
Query: page, pageSize, startDate?, endDate?, platform?, device?
Response: {
  data: [{ date, taskName, skill, platform, device, duration, credits, status, reach }],
  pagination: { ... }
}
```

#### 4.10 指令集产出统计
```
GET /dashboard/skill-output
Query: timeRange, customStart?, customEnd?
Response: [
  { skillId, skillName, successCount, extraMetrics: { comments, likes, favorites, dms, uniqueReach } }
]
```

#### 4.11 成就徽章
```
GET  /dashboard/achievements
Response: [{ id, name, icon, description, progress, unlocked, reward }]

POST /dashboard/achievements/:id/claim
```

**需新增数据库表：**
```sql
CREATE TABLE achievements (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  icon_url VARCHAR(500),
  condition JSONB,
  badge_level VARCHAR(20),  -- bronze/silver/gold/platinum
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE user_achievements (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  achievement_id INT REFERENCES achievements(id),
  unlocked_at TIMESTAMP,
  is_claimed BOOLEAN DEFAULT FALSE,
  claimed_at TIMESTAMP,
  reward_credits INT DEFAULT 0,
  UNIQUE(user_id, achievement_id)
);
```

### P2 — 增强

#### 4.12 AI 洞察
```
GET /dashboard/insights
Query: timeRange
Response: {
  metrics: [{ label, value, changePercent }],
  summary: string
}
```

#### 4.13 周报/月报数据
```
GET /enterprise/reports/weekly?weekStart=2026-04-07
GET /enterprise/reports/monthly?month=2026-04
Response: { period, stats, chartData, insights }
```

#### 4.14 批量导出
```
POST /enterprise/export
Body: { recordType: "transactions" | "operations" | "executions", format: "csv", dateRange }
Response: { downloadUrl, expiresAt }
```

---

## 5. 与 CoreMate 已有接口的兼容性

### 可直接复用的接口

| Dashboard 需求 | CoreMate 已有端点 | 备注 |
|---------------|-------------------|------|
| 用户认证 | `POST /user-auth/send-otp` + `POST /user-auth/verify-otp` | 直接复用，Dashboard 登录态走 Better-Auth session |
| 积分余额 | `GET /user/balance` | 复用，但 Dashboard 需企业级聚合（所有成员总余额），需在此基础上封装 |
| 积分分发 | `POST /admin/credits/add` | 复用，需将权限从 `admin` 扩展到 `enterprise_admin` |
| 积分退款 | `POST /admin/credits/refund` | 同上 |
| 充值套餐 | `GET /recharge/plans` + `POST /recharge/order` | 直接复用 |
| Skill 列表 | `GET /agent/skills` | 复用获取指令集名称，产出统计需新增关联查询 |
| 单任务执行历史 | `GET /tasks/:id/executions` | 复用于 Drawer 执行详情，Dashboard 列表需跨任务查询 |
| 管理员积分记录 | `GET /admin/credits/records` | 可作为交易历史的数据源之一 |
| 管理操作记录 | `GET /admin/credits/operations` | 可作为操作日志的数据源之一 |

### 需扩展的接口

| 需求 | 已有基础 | 扩展方案 |
|------|----------|----------|
| 积分流水（企业视角） | `GET /usage/records`（仅当前用户） | 新增 `/enterprise/records/transactions`，支持按 `tenant_id` 查询所有成员流水 |
| 执行记录（跨任务） | `GET /tasks/:id/executions`（单任务） | 新增 `/enterprise/records/executions`，JOIN `skill` + `user_task` 支持平台/设备筛选 |
| 操作日志 | `enterprise_audit_log` 表已存在 | 新增 `/enterprise/records/operations`，对已有表做查询封装 |
| 技能统计 | `GET /agent/skills`（仅 CRUD） | 新增 `/dashboard/skill-output`，关联 `task_execution` 做聚合 |

### 认证要求

所有 `/dashboard/*` 和 `/enterprise/*` 端点需 Better-Auth Bearer Token，并校验用户 `tenant_id` 做数据隔离。建议：
- 复用已有的 `@Roles(["admin"])` 装饰器
- 新增 `@Roles(["enterprise_admin"])` 用于企业管理者（非系统管理员）
- 所有查询自动注入 `WHERE tenant_id = :currentTenantId`

### 数据表映射

| PRD 数据需求 | CoreMate 已有表 | 关键字段 |
|-------------|----------------|----------|
| 基础执行指标 | `task_execution` | `status`, `created_at`, `duration`, 需确认是否有 `reach`/`comments` 等互动统计字段 |
| 积分流水 | `credit_flow` | `amount`, `balance_after`, `type`, `description`, `created_at` |
| 操作日志 | `enterprise_audit_log` | `action`, `operator_id`, `target`, `result`, `created_at` |
| 用户余额 | `user_balance` | `balance`, `user_id` |
| 充值记录 | `recharge_order` | `amount`, `status`, `created_at` |
| 技能定义 | `skill` | `name`, `id`, `is_active` |

> **待确认**：`task_execution` 表是否存储互动统计（评论/点赞/收藏/私信/触达数），还是这些数据在 `task_execution_feedback` 或 `executor_behavior_log` 中。这决定了看板统计和指令集产出 API 的实现方式。

---

## 6. 对现有 API 的改造建议

1. **权限分层**：新增 `enterprise_admin` 角色，区分系统管理员和企业管理者
2. **分页标准化**：统一返回 `{ data, pagination: { page, pageSize, total, totalPages } }`
3. **时间范围标准化**：所有列表 API 支持 `startDate` / `endDate` 查询参数
4. **多租户隔离**：所有企业级 API 按 `tenant_id` 隔离数据

---

## 6. 实现优先级建议

| 阶段 | API | 预估工时 |
|------|-----|---------|
| Phase 1 | 4.1-4.5（看板统计+钱包） | 3-4 天 |
| Phase 2 | 4.6-4.9（成员CRUD+记录查询） | 3-4 天 |
| Phase 3 | 4.10-4.11（指令集统计+成就） | 2-3 天 |
| Phase 4 | 4.12-4.14（洞察+报表+导出） | 2-3 天 |

总计约 **10-14 个工作日**，建议按 Phase 顺序推进，每个 Phase 完成后前端即可对接。
