import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

export interface Ref {
  ref: string;
  role: string;
  label: string;
}

export interface CodexVerdict {
  pass: boolean;
  reason: string;
  [key: string]: any;
}

export interface StepResult {
  name: string;
  ok: boolean;
  screenshot: string;
  durationMs: number;
  startedAt: string;
  endedAt: string;
  error?: string;
  visual?: CodexVerdict;
}

const FIND_PREFIX = "find:";
const TEXT_ONLY_ROLES = new Set(["StaticText", "LabelText"]);
const DEFAULT_VISUAL_MODEL = "gpt-5.4-mini";

let codexImageFlagCache: "--image" | "-i" | null | undefined;

export async function ab(...args: string[]): Promise<string> {
  try {
    return execFileSync("agent-browser", args, { encoding: "utf8" });
  } catch (error) {
    const stdout = typeof error === "object" && error && "stdout" in error ? String(error.stdout ?? "") : "";
    const stderr = typeof error === "object" && error && "stderr" in error ? String(error.stderr ?? "") : "";
    const details = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
    throw new Error(details || `agent-browser ${args.join(" ")} failed`);
  }
}

function makeFindRef(locator: string, value: string): string {
  return `${FIND_PREFIX}${locator}:${encodeURIComponent(value)}`;
}

function parseFindRef(ref: string): { locator: string; value: string } | null {
  if (!ref.startsWith(FIND_PREFIX)) {
    return null;
  }

  const body = ref.slice(FIND_PREFIX.length);
  const splitAt = body.indexOf(":");

  if (splitAt < 0) {
    throw new Error(`Invalid synthetic ref: ${ref}`);
  }

  return {
    locator: body.slice(0, splitAt),
    value: decodeURIComponent(body.slice(splitAt + 1)),
  };
}

function normalizeTarget(target: string): string {
  if (target.startsWith("@")) {
    return target;
  }

  if (/^e\d+$/.test(target)) {
    return `@${target}`;
  }

  return target;
}

function parseSnapshot(raw: string): Ref[] {
  const refs: Ref[] = [];
  const seen = new Set<string>();
  const refLine = /^\s*-\s+([^\["]+?)\s+"([^"]*)"\s+\[ref=([^\]]+)\]/;
  const textLine = /^\s*-\s+([A-Za-z][\w-]*)\s+"([^"]*)"(?:\s|$)/;

  for (const line of raw.split(/\r?\n/)) {
    const refMatch = line.match(refLine);

    if (refMatch) {
      const item: Ref = {
        role: refMatch[1].trim(),
        label: refMatch[2],
        ref: `@${refMatch[3]}`,
      };
      const key = `${item.ref}|${item.role}|${item.label}`;

      if (!seen.has(key)) {
        refs.push(item);
        seen.add(key);
      }
      continue;
    }

    const textMatch = line.match(textLine);
    if (!textMatch) {
      continue;
    }

    const role = textMatch[1].trim();
    const label = textMatch[2];

    if (!label || !TEXT_ONLY_ROLES.has(role)) {
      continue;
    }

    const item: Ref = {
      role,
      label,
      ref: makeFindRef("text", label),
    };
    const key = `${item.ref}|${item.role}|${item.label}`;

    if (!seen.has(key)) {
      refs.push(item);
      seen.add(key);
    }
  }

  return refs;
}

async function runAction(action: "click" | "hover" | "fill", ref: string, text?: string): Promise<void> {
  const synthetic = parseFindRef(ref);

  if (synthetic) {
    const args = ["find", synthetic.locator, synthetic.value, action];
    if (typeof text === "string") {
      args.push(text);
    }
    await ab(...args);
    return;
  }

  const target = normalizeTarget(ref);
  if (action === "fill") {
    await ab("fill", target, text ?? "");
    return;
  }

  await ab(action, target);
}

export async function snapshot(interactive = false): Promise<{ raw: string; refs: Ref[] }> {
  const args = ["snapshot"];
  if (interactive) {
    args.push("-i");
  }

  const raw = await ab(...args);
  return {
    raw,
    refs: parseSnapshot(raw),
  };
}

export async function screenshot(relPath: string): Promise<void> {
  const absPath = resolve(process.cwd(), relPath);
  mkdirSync(dirname(absPath), { recursive: true });
  await ab("screenshot", absPath);
}

export async function evalJson<T>(script: string): Promise<T> {
  const raw = await ab("eval", script);

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`agent-browser eval returned non-JSON:\n${raw}`);
  }
}

export async function click(ref: string): Promise<void> {
  await runAction("click", ref);
}

export async function hover(ref: string): Promise<void> {
  await runAction("hover", ref);
}

export async function fill(ref: string, text: string): Promise<void> {
  await runAction("fill", ref, text);
}

export async function wait(what: string | number): Promise<void> {
  if (typeof what === "number") {
    await new Promise((resolveWait) => setTimeout(resolveWait, what));
    return;
  }

  await ab("wait", what);
}

export async function findRef(pred: (r: Ref) => boolean): Promise<string> {
  const interactive = await snapshot(true);
  const interactiveMatch = interactive.refs.find(pred);
  if (interactiveMatch) {
    return interactiveMatch.ref;
  }

  const full = await snapshot(false);
  const fullMatch = full.refs.find(pred);
  if (fullMatch) {
    return fullMatch.ref;
  }

  const preview = full.refs
    .slice(0, 20)
    .map((r) => `${r.role} "${r.label}" -> ${r.ref}`)
    .join("\n");

  throw new Error(`No matching ref found.\n${preview}`);
}

export async function navigate(url: string): Promise<void> {
  await ab("open", url);
}

export async function mouse(action: "move" | "down" | "up" | "wheel", ...args: Array<string | number>): Promise<void> {
  await ab("mouse", action, ...args.map(String));
}

export async function setViewport(width: number, height: number): Promise<void> {
  await ab("set", "viewport", String(width), String(height));
}

function probeCodexImageFlag(): "--image" | "-i" | null {
  if (codexImageFlagCache !== undefined) {
    return codexImageFlagCache;
  }

  const help = execFileSync(process.env.SHELL || "zsh", ["-lc", "codex --help 2>&1 | head -80"], {
    encoding: "utf8",
  });

  if (/\b--image\b/.test(help)) {
    codexImageFlagCache = "--image";
  } else if (/(^|\s)-i\b/.test(help) || /\bimage\b/i.test(help) || /\battach\b/i.test(help) || /\bvision\b/i.test(help)) {
    codexImageFlagCache = "-i";
  } else {
    codexImageFlagCache = null;
  }

  return codexImageFlagCache;
}

function parseJsonObject(raw: string): Record<string, any> | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const candidates = [trimmed];
  const codeFence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (codeFence) {
    candidates.push(codeFence[1].trim());
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, any>;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function imageToDataUri(imagePath: string): string {
  const absPath = resolve(process.cwd(), imagePath);
  const bytes = readFileSync(absPath);
  const lower = absPath.toLowerCase();
  const mime = lower.endsWith(".jpg") || lower.endsWith(".jpeg")
    ? "image/jpeg"
    : lower.endsWith(".webp")
      ? "image/webp"
      : "image/png";

  return `data:${mime};base64,${bytes.toString("base64")}`;
}

export async function askCodexVisual(opts: {
  image: string;
  prompt: string;
  schema?: string;
  model?: string;
  effort?: string;
}): Promise<CodexVerdict> {
  const imageFlag = probeCodexImageFlag();
  const model = opts.model || DEFAULT_VISUAL_MODEL;
  const promptParts = [opts.prompt.trim(), "Return only valid JSON with no markdown or commentary."];

  if (opts.schema) {
    promptParts.push(`Schema hint:\n${opts.schema.trim()}`);
  }

  if (opts.effort) {
    promptParts.push(`Reasoning effort preference: ${opts.effort}.`);
  }

  const basePrompt = promptParts.join("\n\n");
  let lastReason = "Codex returned non-JSON";
  let totalResponseTimeMs = 0;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const startedAt = Date.now();
    const tempDir = mkdtempSync(resolve(tmpdir(), "dashboard-codex-visual-"));
    const outputPath = resolve(tempDir, "verdict.json");
    const args = ["exec", "--sandbox", "danger-full-access", "--ephemeral", "-o", outputPath, "-m", model];
    const imageMode = imageFlag ? "flag" : "inline";
    let finalPrompt = basePrompt;

    if (imageFlag) {
      args.push(imageFlag, resolve(process.cwd(), opts.image));
    } else {
      finalPrompt += `\n\nScreenshot data URI:\n${imageToDataUri(opts.image)}`;
    }

    args.push("--", finalPrompt);

    const result = spawnSync("codex", args, {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });

    const responseTimeMs = Date.now() - startedAt;
    totalResponseTimeMs += responseTimeMs;

    try {
      if (result.status !== 0) {
        const details = [result.stdout?.trim(), result.stderr?.trim()].filter(Boolean).join("\n");
        lastReason = details || `Codex exited with status ${result.status}`;
        if (attempt === 2) {
          return {
            pass: false,
            reason: lastReason,
            attempts: attempt,
            imageMode,
            model,
            requestedEffort: opts.effort || null,
            responseTimeMs,
            totalResponseTimeMs,
          };
        }
        continue;
      }

      const raw = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : String(result.stdout || "");
      const parsed = parseJsonObject(raw);

      if (!parsed) {
        lastReason = "Codex returned non-JSON";
        if (attempt === 2) {
          return {
            pass: false,
            reason: lastReason,
            attempts: attempt,
            imageMode,
            model,
            requestedEffort: opts.effort || null,
            responseTimeMs,
            totalResponseTimeMs,
          };
        }
        continue;
      }

      return {
        ...parsed,
        pass: Boolean(parsed.pass),
        reason: typeof parsed.reason === "string" && parsed.reason.trim() ? parsed.reason : (parsed.pass ? "Visual check passed" : "Visual check failed"),
        attempts: attempt,
        imageMode,
        model,
        requestedEffort: opts.effort || null,
        responseTimeMs,
        totalResponseTimeMs,
      };
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  return {
    pass: false,
    reason: lastReason,
    attempts: 2,
    imageMode: imageFlag ? "flag" : "inline",
    model,
    requestedEffort: opts.effort || null,
    totalResponseTimeMs,
  };
}
