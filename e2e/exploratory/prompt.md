You are running an autonomous exploratory pass against a dashboard UI that is already reachable in a browser automation environment.

Target URL: $FRONTEND_URL
Report output directory: $REPORT_DIR
Maximum steps: $E2E_MAX_EXPLORATORY_STEPS

Task:
1. Navigate to $FRONTEND_URL.
2. Systematically explore the dashboard with a focus on:
   - range switching
   - hover states
   - chart interactions
   - table pagination
   - export actions
   - responsive behavior
3. For each interaction:
   - take a screenshot
   - note what changed
4. Look specifically for:
   - layout breaks
   - missing data
   - JavaScript errors in the console
   - slow renders taking more than 2 seconds
   - elements that do not respond to interaction
5. Write findings to `$REPORT_DIR/exploratory.md` as a markdown checklist with severity:
   - `🔴 bug`
   - `🟡 warning`
   - `🟢 ok`
6. Stop after $E2E_MAX_EXPLORATORY_STEPS steps even if more areas remain.

## 异步动作等待策略

某些按钮点击是异步流程（后端 fetch / html2canvas 截图 / 文件下载），需要更长的等待才能判定结果。

点击以下类型的 trigger 时，先等待到对应副作用出现，再决定是否记为 bug：

### 模态框 / Overlay 类
- 适用对象：`生成周报` / `生成日报` / `生成月报` / `生成报告` 按钮
- 预期副作用：`#reportOverlay` 元素增加 `open` class
- 等待策略：点击后轮询 `#reportOverlay.open`，或检查 `document.querySelector('#reportOverlay')?.classList.contains('open')`，最多等待 6 秒；一旦出现即判通过，不要因为前 2 秒没有反馈就记为 bug

### 文件下载类
- 适用对象：导出 CSV / PNG 按钮
- 预期副作用：浏览器产生新下载文件，或 Network 出现 200 的下载响应
- 等待策略：点击后最多等待 8 秒，检查浏览器下载记录、下载目录中新出现的 `*.csv` / `*.png` 文件，或文件名包含 `dashboard` / `交易历史` / `report`

### Popout / Tooltip 类
- 适用对象：hover 高亮卡 / 技能卡 / 成就卡
- 预期副作用：body 层出现 tooltip / popover / menu / overlay 容器
- 等待策略：hover 后最多等待 1 秒，轮询常见浮层 selector 或 class 变化，例如 `[role=\"tooltip\"]`、`.tooltip`、`.popover`、`.menu`、`.tippy-box`

### 普通 tab 切换
- 一般 300-500ms 过渡
- 等待策略：固定等待 500ms 后再判定

## 判定无反应的准则（升级）
1. 先识别按钮类型（看按钮文本和上下文）。
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
- Prefer short terminal commands only when they directly help the exploration. Do not spend time reverse-engineering the codebase.
- When you are done, write the markdown report file and exit immediately.
