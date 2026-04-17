# Dashboard 写操作接口清单

> 读取接口不影响数据库，此文档只记录**写操作**。所有写接口均需 `X-API-Key` header 鉴权。

---

## 鉴权

| 项 | 说明 |
|----|------|
| 中间件 | `api/auth.py` — `require_api_key()` |
| 机制 | 请求带 `X-API-Key` header → 映射到 `tenant_id`，所有写操作基于此做租户隔离 |
| 当前 | 开发用静态 key（`.env` 配置），后续升级 JWT |

---

## 1. 成员管理

### `POST /api/members` — 新增成员

| 参数 | 类型 | 说明 |
|------|------|------|
| name | string | 姓名 |
| phone_number | string | 手机号 |
| role | string | `member` / `admin`，默认 `member` |
| initial_balance | int | 初始算力豆，默认 0 |

写入：`users` + `user_balance` + `credit_flow`（初始余额>0时） + `enterprise_audit_log`

### `PUT /api/members/{user_id}` — 编辑成员

| 参数 | 类型 | 说明 |
|------|------|------|
| name | string? | 姓名 |
| phone_number | string? | 手机号 |
| role | string? | 角色 |

写入：`users` + `enterprise_audit_log`（含 before/after 快照）

### `DELETE /api/members/{user_id}` — 删除成员（软删）

写入：`users.is_deleted = true` + `enterprise_audit_log`

---

## 2. 算力豆分发

> 无外部充值。管理员余额由系统直接写库，再通过分发接口分配给成员。

### `POST /api/credits/distribute` — 分发算力豆

| 参数 | 类型 | 说明 |
|------|------|------|
| operator_id | int | 操作人（管理员）user_id |
| target_user_id | int | 目标成员 user_id |
| amount | int | 分发数量（正整数） |
| remark | string? | 备注 |

流程：管理员 `user_balance -= amount` → 成员 `user_balance += amount`（乐观锁）

写入：`user_balance`×2 + `credit_flow`×2（DISTRIBUTE 类型，一正一负） + `enterprise_audit_log` + `enterprise_recharge_record`

校验：同租户、管理员余额充足、并发版本号

---

## 3. 未实现

| 需求 | 说明 |
|------|------|
| 回收算力豆 | 从成员回收到管理员账户，分发的逆操作 |
| 审计日志查询 | `GET /api/audit-log`，`enterprise_audit_log` 表已有数据（写操作自动记录），缺读取端点 |
| 租户初始化 | `tenants` 表当前 0 行，需插入企业记录（名称、成员上限、有效期） |
| 租户信息查询 | `GET /api/tenant`，供前端替代硬编码的企业名称等 |

---

## 4. 待确认

- [ ] 管理员初始余额的写库方式是否需要做成接口（当前手动 SQL）
- [ ] 回收算力豆的业务流程
- [ ] 正式环境 API Key 更换
- [ ] `enterprise_recharge_record` 表是否还需要保留（当前分发时写入，但表名暗示"充值"，语义不准）
