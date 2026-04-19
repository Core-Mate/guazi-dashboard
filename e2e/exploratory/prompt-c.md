You are running an autonomous exploratory pass against a dashboard UI that is already reachable in a browser automation environment.

Target URL: $FRONTEND_URL
Maximum steps: 10-12
Read-only mode: NO write operations (no POST /api/members, no DELETE), read-only exploration only
Write report to: $REPORT_DIR/exploratory.md
Severity markers:
- `🔴 bug`
- `🟡 warning`
- `🟢 ok`

Task:
1. Navigate to $FRONTEND_URL and wait for the dashboard shell to finish its initial render.
2. Locate the main data table and identify the current pagination state before interacting.
3. Switch pagination forward and backward, and verify the table rows update consistently with the page indicator.
4. Use the search box to filter table rows, and verify that the visible results change in a way that matches the query.
5. Clear or adjust the search query and confirm the table resets cleanly without stale filtered rows.
6. Switch the viewport to 390px width and evaluate whether the content area remains usable; explicitly note if the previous 404px-too-tight risk still appears.
7. Switch the viewport to 430px width and compare whether layout density, clipping, and horizontal overflow improve or regress.
8. Switch the viewport to 800px width and verify the iPad-sized layout preserves table usability, chart readability, and basic interaction access.
9. Switch the viewport to 1440px width and verify the desktop layout does not leave broken spacing, oversized gaps, or clipped controls.
10. If permission thresholds or permission-gated indicators are visible in the dashboard, verify whether threshold states render clearly and consistently across the tested viewports.
11. Check the console for JavaScript errors triggered by pagination, search filtering, or viewport changes.
12. Write findings to `$REPORT_DIR/exploratory.md` grouped by pagination, search, responsive behavior, and permission-threshold behavior if present.

## 异步动作等待策略

某些按钮点击是异步流程（后端 fetch / html2canvas 截图 / 文件下载），需要更长的等待才能判定结果。

点击以下类型的 trigger 时，先等待到对应副作用出现，再决定是否记为 bug：

### 普通分页 / 搜索类
- 适用对象：pagination、search filter
- 预期副作用：表格行内容、分页器状态、结果数量发生变化
- 等待策略：点击或输入后先等待 500ms，再检查 DOM 是否稳定；如有 loading 态，可延长到 2 秒确认是否只是异步刷新

### 响应式切换类
- 适用对象：390px / 430px / 800px / 1440px viewport 切换
- 预期副作用：布局重排、滚动行为、控件可达性变化
- 等待策略：每次切换 viewport 后等待 500ms，再检查 overflow、裁切、重叠和触达性

### 权限阈值 / 状态展示类
- 适用对象：permission thresholds 或 permission-gated indicators（如果页面存在）
- 预期副作用：阈值文本、状态 badge、告警提示在不同 viewport 下仍清晰可见
- 等待策略：仅在该区域实际存在时检查，避免为不存在的模块误报

## 判定无反应的准则（升级）
1. 先识别交互类型（pagination / search / viewport / permission threshold）。
2. 应用上面的等待策略。
3. 超时后仍无预期副作用，再判 bug。
4. 在 report 里写明：等待了多少秒、检查了什么副作用、最终为什么仍判定失败；不要只写“没反应”。

Output requirements:
- Create or overwrite `$REPORT_DIR/exploratory.md`.
- Keep the report concise and structured by interaction area.
- Include screenshot file paths for any finding worth reviewing.
- If no issues are found in an area, record an `🟢 ok` item rather than skipping it.

Operational constraints:
- Stay browser-first. Do not inspect repository source files, README files, or package metadata unless the browser session is unusable.
- Reuse the existing `agent-browser` connection instead of inventing a new harness.
- Seed `localStorage.dashboardApiKey` and `localStorage.dashboardTenantId` if needed, then reload once and continue.
- Do not perform write operations against the app or backend. Keep the pass strictly read-only.
- When you are done, write the markdown report file and exit immediately.
