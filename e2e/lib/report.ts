import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

export function initReport(runId: string, name: string): string {
  const dir = resolve(process.cwd(), "dashboard", "e2e", "reports", runId);
  const path = resolve(dir, `${name}.md`);

  mkdirSync(dir, { recursive: true });

  const title = name
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  writeFileSync(
    path,
    [
      `# ${title}`,
      "",
      `- Run ID: \`${runId}\``,
      `- Generated: \`${new Date().toISOString()}\``,
      "",
      "| Check | Result | Detail |",
      "| --- | --- | --- |",
      "",
    ].join("\n"),
    "utf8",
  );

  return path;
}

export function appendRow(path: string, check: string, result: "✅" | "❌" | "⚠️", detail: string): void {
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "| Check | Result | Detail |\n| --- | --- | --- |\n", "utf8");
  }

  appendFileSync(path, `| ${escapeCell(check)} | ${result} | ${escapeCell(detail)} |\n`, "utf8");
}

export function finalizeReport(path: string): void {
  console.log(`Report: ${path}`);
}
