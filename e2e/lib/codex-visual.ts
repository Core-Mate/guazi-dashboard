/**
 * `codex --help | grep -iE 'image|attach|photo'` output:
 *   -i, --image <FILE>...
 *           Optional image(s) to attach to the initial prompt
 *
 * The local CLI exposes `-i/--image` but does not advertise a dedicated `--effort` flag,
 * so `effort` is preserved as prompt guidance instead of being passed as a CLI option.
 */
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export interface CodexVerdict {
  pass: boolean;
  reason: string;
  [key: string]: any;
}

function parseVerdict(raw: string): CodexVerdict {
  const trimmed = raw.trim();
  const candidates = [trimmed];
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) {
    candidates.push(fenced[1].trim());
  }

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    try {
      const parsed = JSON.parse(candidate) as CodexVerdict;
      if (parsed && typeof parsed === "object") {
        return {
          ...parsed,
          pass: Boolean(parsed.pass),
          reason: typeof parsed.reason === "string" && parsed.reason.trim()
            ? parsed.reason
            : (parsed.pass ? "Visual check passed" : "Visual check failed"),
        };
      }
    } catch {
      continue;
    }
  }

  throw new Error("Codex visual call returned non-JSON");
}

export async function askCodexVisual(opts: {
  image: string;
  prompt: string;
  schema?: string;
  model?: string;
  effort?: string;
}): Promise<CodexVerdict> {
  const { image, prompt, schema, model = "gpt-5.4", effort = "medium" } = opts;
  if (!fs.existsSync(image)) {
    throw new Error(`Screenshot not found: ${image}`);
  }

  const fullPrompt = [
    prompt.trim(),
    schema ? `Return valid JSON matching: ${schema}` : "Return valid JSON only.",
    `Reasoning effort preference: ${effort}.`,
  ].join("\n\n");

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-codex-visual-"));
  const outputPath = path.join(tempDir, "last-message.json");

  try {
    execFileSync(
      "codex",
      [
        "exec",
        "--sandbox",
        "danger-full-access",
        "--ephemeral",
        "--model",
        model,
        "--image",
        image,
        "-o",
        outputPath,
        fullPrompt,
      ],
      { encoding: "utf8", timeout: 60000, maxBuffer: 20 * 1024 * 1024 },
    );

    const raw = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : "";
    return parseVerdict(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { pass: false, reason: `Codex visual call failed: ${message}` };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function askCodexVisualRetry(
  opts: Parameters<typeof askCodexVisual>[0],
  retries = 1,
): Promise<CodexVerdict> {
  for (let i = 0; i <= retries; i++) {
    const v = await askCodexVisual(opts);
    if (v.pass || i === retries) {
      return v;
    }
  }
  return { pass: false, reason: "all retries exhausted" };
}
