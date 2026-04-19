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
