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
6. Under 390px, 430px, and 800px viewports, perform horizontal-scroll reachability validation: use `getComputedStyle` to inspect whether `document.body` or the primary dashboard scroll container exposes `overflow-x: auto` or `overflow-x: scroll`; simulate horizontal scrolling with `window.scrollTo(2000, 0)` or a large `scrollLeft` on the active scroll container; verify that previously clipped right-side content becomes reachable (such as rightmost table columns, trailing KPI card content, or the chart right edge); capture `viewport-390-scrolled-right.png`, `viewport-430-scrolled-right.png`, and `viewport-800-scrolled-right.png`.
7. Switch the viewport to 1440px width, and optionally 1920px if time budget allows, to perform desktop no-regression validation: verify that 1440px does not show a horizontal scrollbar, KPI rows do not wrap, and charts are not compressed; capture `viewport-1440-no-regression.png`.
8. Read the dashboard main container `min-width` value (expect approximately 1280px or the intended design width), then validate min-width reasonableness by confirming that a 1280px viewport does not trigger horizontal scrolling while a 1200px viewport may legitimately do so; capture `viewport-1280-edge.png`.
9. Apply the responsive verdict criteria explicitly: mark `🔴 bug` if a viewport narrower than the container `min-width` cannot horizontally reach all content; mark `🟢 ok` if narrower viewports can horizontally reach all content and desktop widths at or above 1440px show no regression; mark `🟡 warning` if horizontal scrolling exists but feels visually awkward (for example misplaced scrollbar position or abnormal scrollbar height).
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
- 适用对象：390px / 430px / 800px / 1200px / 1280px / 1440px（可选 1920px）viewport 切换，以及横向滚动可达性检查
- 预期副作用：布局重排、横向滚动行为、`min-width` 边界表现、控件可达性变化
- 等待策略：每次切换 viewport 后等待 500ms，再检查 overflow、裁切、重叠和触达性；触发横向滚动后再等待 300ms，再确认右侧内容是否真正可见并截图

### 权限阈值 / 状态展示类
- 适用对象：permission thresholds 或 permission-gated indicators（如果页面存在）
- 预期副作用：阈值文本、状态 badge、告警提示在不同 viewport 下仍清晰可见
- 等待策略：仅在该区域实际存在时检查，避免为不存在的模块误报

## 判定无反应的准则（升级）
- 先识别交互类型（pagination / search / viewport / permission threshold）。
- 应用上面的等待策略。
- 超时后仍无预期副作用，再判 bug。
- 在 report 里写明：等待了多少秒、检查了什么副作用、最终为什么仍判定失败；不要只写“没反应”。

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
