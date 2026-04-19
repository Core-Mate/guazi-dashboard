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
1. Navigate to $FRONTEND_URL and wait for the main dashboard shell to stabilize.
2. Record the visible default range state and the initial KPI card values.
3. Switch the range selector across `今日` / `昨日` / `7d` / `30d` / `自定义`, and verify the KPI cards visibly respond within 500ms for each switch.
4. For any slow or unchanged KPI state, capture evidence and note whether the cards updated late, partially, or not at all.
5. In the chart area, trigger `导出CSV` and verify the downloaded file is a monthly time-series export whose column headers contain dates.
6. In the table area, trigger `导出CSV` and verify the downloaded file is an account or row-oriented export whose column headers contain fields such as account name, `算力豆`, or similar row-level attributes.
7. Assert that the two CSV exports have completely different column headers and different binary SHA1 values; if they do not, record that as a defect.
8. Drag a comparison range on the main chart and, while the mouse is still down, verify there is exactly one continuous highlighted range plus a cursor tooltip / summary bubble following the mouse; treat that as the PASS condition.
9. After `mouseup`, verify the highlighted selection clears and the chart returns to its normal hover state; this reset is the intended iOS Stocks-style behavior, not a bug. Record a bug only if mid-drag there is no highlight at all, or if multiple highlighted segments appear.
10. Check the console for JavaScript errors that appear during range switching, export, or drag comparison.
11. Write findings to `$REPORT_DIR/exploratory.md` grouped by range switching, CSV export, drag compare, and console health.

## 异步动作等待策略

某些按钮点击是异步流程（后端 fetch / html2canvas 截图 / 文件下载），需要更长的等待才能判定结果。

点击以下类型的 trigger 时，先等待到对应副作用出现，再决定是否记为 bug：

### 文件下载类
- 适用对象：图表区 / 表格区 `导出CSV` 按钮
- 预期副作用：浏览器产生新下载文件，或 Network 出现 200 的下载响应
- 等待策略：点击后最多等待 8 秒，检查浏览器下载记录、下载目录中新出现的 `*.csv` 文件，并记录文件名、大小、列头差异、SHA1 差异

### 普通 tab / range 切换
- 适用对象：`今日` / `昨日` / `7d` / `30d` / `自定义`
- 预期副作用：KPI 数值、图表、对比态发生可见变化
- 等待策略：优先观察前 500ms 是否完成响应；若 500ms 仍未完成，可继续等待到 2 秒确认是否只是慢，不要立刻误报

### 拖拽交互类
- 适用对象：图表 drag compare
- 预期副作用：按下并拖动时出现单段高亮 selection 区域，cursor tooltip / summary bubble 跟随鼠标；`mouseup` 后高亮清空并回到普通 hover 状态，这是 iOS Stocks 风格设计预期
- 等待策略：按下并拖动过程中连续观察 mid-drag 状态；结束后再额外等待 500ms，确认高亮已清空而不是残留。只有 mid-drag 无高亮，或出现多段高亮时才判 bug

## 判定无反应的准则（升级）
1. 先识别交互类型（range 切换 / 导出 / 拖拽）。
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
