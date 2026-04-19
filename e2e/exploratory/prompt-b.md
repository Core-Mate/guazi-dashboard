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
1. Navigate to $FRONTEND_URL and wait until the main dashboard content is fully visible.
2. Inspect the `平台触达` donut chart and confirm slices are rendered before starting hover checks.
3. Hover each visible slice in `平台触达`, and verify the hovered slice highlights while a tooltip appears with matching segment information.
4. Inspect the `互动类型` donut chart and repeat the hover verification for each visible slice.
5. Record any case where hover does not show a tooltip, highlights the wrong slice, or leaves stale highlight state behind.
6. Locate the ridgeline chart and verify that multiple stacked area curves are rendered rather than a single collapsed shape or blank panel.
7. Check whether the ridgeline layers appear distinct enough to compare visually, and note any clipping, overlap, or missing labels.
8. Inspect the `运维详情` table and determine whether it shows mostly `暂无`, all-zero values, or other signs of a mock-data gap.
9. Verify any empty-state or placeholder behavior in tables or panels that have no data, and confirm whether the copy and layout remain reasonable.
10. Cross-check whether placeholder rows, skeletons, or zero states are visually differentiated from populated data.
11. Check the console for JavaScript errors during donut hover, ridgeline rendering, and table state changes.
12. Write findings to `$REPORT_DIR/exploratory.md` grouped by donut charts, ridgeline chart, 运维详情 table, and empty-state behavior.

## 异步动作等待策略

某些按钮点击是异步流程（后端 fetch / html2canvas 截图 / 文件下载），需要更长的等待才能判定结果。

点击以下类型的 trigger 时，先等待到对应副作用出现，再决定是否记为 bug：

### Popout / Tooltip 类
- 适用对象：donut chart hover、说明型悬浮提示
- 预期副作用：body 层出现 tooltip / popover / overlay，且对应 slice 进入高亮态
- 等待策略：hover 后最多等待 1 秒，轮询常见浮层 selector 或 class 变化，例如 `[role=\"tooltip\"]`、`.tooltip`、`.popover`、`.tippy-box`

### 图表渲染类
- 适用对象：ridgeline chart、donut chart 首屏渲染
- 预期副作用：SVG / canvas / chart layer 中出现多个可见 series 或 slice
- 等待策略：进入区域后最多等待 2 秒，避免把异步绘制中的中间态误判为空数据

### 表格空态类
- 适用对象：`运维详情` 和其他 table placeholder / empty state
- 预期副作用：出现明确的空态文案、占位行、或已知 mock 数据展示
- 等待策略：切换到对应区域后等待 500ms，再检查是否是稳定空态还是迟到的数据加载

## 判定无反应的准则（升级）
1. 先识别交互类型（hover / 图表渲染 / table 空态）。
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
